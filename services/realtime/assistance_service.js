'use strict';

const Redis = require('ioredis');
const crypto = require('node:crypto');

// Partner records have NO TTL: their lifetime is the socket.io connection
// (removed on disconnect, wiped on startup), mirroring presence. Only grants are
// short-lived one-time tokens.
const GRANT_TTL_SECONDS = 60;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FAILURE_LIMIT = 5;

const memoryState = {
  partners: new Map(),
  terminalToPartner: new Map(),
  grants: new Map(),
  failures: new Map()
};

let lastRedisErrorLog = 0;

const normalizePartnerId = (value) => String(value || '').replace(/\D/g, '').slice(0, 9);
const isPartnerId = (value) => /^[0-9]{9}$/.test(value || '');
const now = () => Date.now();

const buildRedis = () => {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION || '';
  if (!url) return null;
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  redis.on('error', (error) => {
    const ts = Date.now();
    if (ts - lastRedisErrorLog >= 30000) {
      console.error(`[assistance] Redis connection error: ${error.message}`);
      lastRedisErrorLog = ts;
    }
  });
  return redis;
};

class MemoryAssistanceStore {
  async registerPartner(record) {
    const current = record.desiredPartnerId && memoryState.partners.get(record.desiredPartnerId);
    let partnerId = record.desiredPartnerId;
    if (!isPartnerId(partnerId) || (current && current.terminalId !== record.terminalId)) {
      partnerId = await this.allocatePartnerId();
    }

    const oldPartnerId = memoryState.terminalToPartner.get(record.terminalId);
    if (oldPartnerId && oldPartnerId !== partnerId) memoryState.partners.delete(oldPartnerId);

    memoryState.partners.set(partnerId, {
      terminalId: record.terminalId,
      userId: record.userId,
      socketId: record.socketId,
      saltHex: record.saltHex,
      pwdHashHex: record.pwdHashHex,
      updatedAt: String(now())
    });
    memoryState.terminalToPartner.set(record.terminalId, partnerId);
    return { partnerId };
  }

  async allocatePartnerId() {
    for (let i = 0; i < 64; ++i) {
      const partnerId = String(crypto.randomInt(100000000, 1000000000));
      if (!memoryState.partners.has(partnerId)) return partnerId;
    }
    throw new Error('failed to allocate partner id');
  }

  async refreshPassword(terminalId, saltHex, pwdHashHex) {
    const partnerId = memoryState.terminalToPartner.get(terminalId);
    if (!partnerId) return false;
    const record = memoryState.partners.get(partnerId);
    if (!record) return false;
    record.saltHex = saltHex;
    record.pwdHashHex = pwdHashHex;
    record.updatedAt = String(now());
    return true;
  }

  async lookupPartner(partnerId) {
    return memoryState.partners.get(partnerId) || null;
  }

  async issueGrant(grant) {
    const grantToken = crypto.randomBytes(16).toString('hex');
    memoryState.grants.set(grantToken, { ...grant, createdAt: String(now()) });
    return grantToken;
  }

  async consumeGrant(grantToken) {
    const grant = memoryState.grants.get(grantToken);
    if (!grant) return null;
    memoryState.grants.delete(grantToken);
    if (now() - Number(grant.createdAt || 0) > GRANT_TTL_SECONDS * 1000) return null;
    return grant;
  }

  async removeByTerminal(terminalId, socketId) {
    const partnerId = memoryState.terminalToPartner.get(terminalId);
    const record = partnerId ? memoryState.partners.get(partnerId) : null;
    // Only drop the partner if it is still owned by the disconnecting socket: a
    // reconnect may have already re-registered this terminal under a new socket,
    // and a late disconnect from the old socket must not wipe the fresh record.
    if (record && (!socketId || record.socketId === socketId)) {
      memoryState.partners.delete(partnerId);
      memoryState.terminalToPartner.delete(terminalId);
    }
    for (const [token, grant] of memoryState.grants.entries()) {
      if (grant.hostTerminalId === terminalId || grant.controllerTerminalId === terminalId) {
        memoryState.grants.delete(token);
      }
    }
  }

  async clearAll() {
    memoryState.partners.clear();
    memoryState.terminalToPartner.clear();
    memoryState.grants.clear();
  }
}

class AssistanceService {
  constructor(redisClient) {
    this.redis = redisClient || buildRedis();
    this.memory = this.redis ? null : new MemoryAssistanceStore();
  }

  async registerPartner({ desiredPartnerId, terminalId, userId, socketId, saltHex, pwdHashHex }) {
    if (!terminalId || !userId || !saltHex || !pwdHashHex) throw new Error('missing assistance registration fields');
    const normalized = normalizePartnerId(desiredPartnerId);
    if (this.memory) {
      return this.memory.registerPartner({ desiredPartnerId: normalized, terminalId, userId, socketId, saltHex, pwdHashHex });
    }

    let partnerId = normalized;
    const existing = partnerId ? await this.redis.hgetall(`assist:partner:${partnerId}`) : null;
    if (!isPartnerId(partnerId) || (existing && Object.keys(existing).length && existing.terminalId !== terminalId)) {
      partnerId = await this.allocatePartnerId();
    }

    const oldPartnerId = await this.redis.get(`assist:terminal:${terminalId}`);
    const multi = this.redis.multi();
    if (oldPartnerId && oldPartnerId !== partnerId) multi.del(`assist:partner:${oldPartnerId}`);
    // No TTL: the partner record's lifetime is the socket.io connection, exactly
    // like presence. It is removed on `disconnect` (removeByTerminal) and wiped on
    // server startup (clearAllPartners) — never expired out from under a live host.
    multi.hmset(`assist:partner:${partnerId}`, {
      terminalId, userId, socketId, saltHex, pwdHashHex, updatedAt: now()
    });
    multi.set(`assist:terminal:${terminalId}`, partnerId);
    await multi.exec();
    return { partnerId };
  }

  async allocatePartnerId() {
    for (let i = 0; i < 64; ++i) {
      const partnerId = String(crypto.randomInt(100000000, 1000000000));
      const exists = await this.redis.exists(`assist:partner:${partnerId}`);
      if (!exists) return partnerId;
    }
    throw new Error('failed to allocate partner id');
  }

  async refreshPassword({ terminalId, saltHex, pwdHashHex }) {
    if (!terminalId || !saltHex || !pwdHashHex) return false;
    if (this.memory) return this.memory.refreshPassword(terminalId, saltHex, pwdHashHex);
    const partnerId = await this.redis.get(`assist:terminal:${terminalId}`);
    if (!partnerId) return false;
    await this.redis.hmset(`assist:partner:${partnerId}`, { saltHex, pwdHashHex, updatedAt: now() });
    return true;
  }

  async lookupPartner(partnerId) {
    const normalized = normalizePartnerId(partnerId);
    if (!isPartnerId(normalized)) return null;
    if (this.memory) return this.memory.lookupPartner(normalized);
    const data = await this.redis.hgetall(`assist:partner:${normalized}`);
    return data && Object.keys(data).length ? data : null;
  }

  verifyPassword(record, plaintext) {
    if (!record || typeof plaintext !== 'string' || !record.saltHex || !record.pwdHashHex) return false;
    const expected = Buffer.from(String(record.pwdHashHex), 'hex');
    const actual = crypto.createHmac('sha256', Buffer.from(String(record.saltHex), 'hex'))
      .update(plaintext, 'utf8')
      .digest();
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  async issueGrant({ hostTerminalId, controllerTerminalId, controllerUserId, partnerId }) {
    if (!hostTerminalId || !controllerTerminalId || !partnerId) throw new Error('missing grant fields');
    if (this.memory) return this.memory.issueGrant({ hostTerminalId, controllerTerminalId, controllerUserId, partnerId });
    const grantToken = crypto.randomBytes(16).toString('hex');
    // Index the grant under both terminals so removeByTerminal can find it without
    // an O(N) KEYS scan over every outstanding grant.
    await this.redis.multi()
      .hmset(`assist:grant:${grantToken}`, {
        hostTerminalId, controllerTerminalId, controllerUserId: controllerUserId || '', partnerId, createdAt: now()
      })
      .expire(`assist:grant:${grantToken}`, GRANT_TTL_SECONDS)
      .sadd(`assist:terminal-grants:${hostTerminalId}`, grantToken)
      .expire(`assist:terminal-grants:${hostTerminalId}`, GRANT_TTL_SECONDS)
      .sadd(`assist:terminal-grants:${controllerTerminalId}`, grantToken)
      .expire(`assist:terminal-grants:${controllerTerminalId}`, GRANT_TTL_SECONDS)
      .exec();
    return grantToken;
  }

  async consumeGrant(grantToken) {
    if (!grantToken) return null;
    if (this.memory) return this.memory.consumeGrant(grantToken);
    const key = `assist:grant:${grantToken}`;
    const data = await this.redis.hgetall(key);
    if (!data || !Object.keys(data).length) return null;
    const multi = this.redis.multi().del(key);
    if (data.hostTerminalId) multi.srem(`assist:terminal-grants:${data.hostTerminalId}`, grantToken);
    if (data.controllerTerminalId) multi.srem(`assist:terminal-grants:${data.controllerTerminalId}`, grantToken);
    await multi.exec();
    return data;
  }

  async removeByTerminal(terminalId, socketId) {
    if (!terminalId) return;
    if (this.memory) return this.memory.removeByTerminal(terminalId, socketId);
    const partnerId = await this.redis.get(`assist:terminal:${terminalId}`);
    const grantTokens = await this.redis.smembers(`assist:terminal-grants:${terminalId}`);
    const multi = this.redis.multi();
    if (partnerId) {
      // Only drop the partner if the disconnecting socket still owns it (a
      // reconnect may have re-registered under a new socket id — don't wipe it).
      const owner = socketId ? await this.redis.hget(`assist:partner:${partnerId}`, 'socketId') : null;
      if (!socketId || owner === socketId) {
        multi.del(`assist:partner:${partnerId}`);
        multi.del(`assist:terminal:${terminalId}`);
      }
    }
    multi.del(`assist:terminal-grants:${terminalId}`);
    for (const token of grantTokens) {
      multi.del(`assist:grant:${token}`);
    }
    await multi.exec();
  }

  // Wipe stale partner/terminal/grant records left over from a previous run
  // (ungraceful shutdown). Called once on server startup, mirroring
  // presence.clearAllEndpoints(). Partner records otherwise live for the whole
  // socket.io connection and are removed on `disconnect` (removeByTerminal).
  async clearAllPartners() {
    if (this.memory) return this.memory.clearAll();
    const patterns = ['assist:partner:*', 'assist:terminal:*', 'assist:terminal-grants:*', 'assist:grant:*'];
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
    }
  }

  isRateLimited(partnerId, userId) {
    const key = `${normalizePartnerId(partnerId)}:${userId || ''}`;
    const entry = memoryState.failures.get(key);
    if (!entry || now() - entry.firstAt > FAILURE_WINDOW_MS) return false;
    return entry.count >= FAILURE_LIMIT;
  }

  recordFailure(partnerId, userId) {
    const key = `${normalizePartnerId(partnerId)}:${userId || ''}`;
    const entry = memoryState.failures.get(key);
    if (!entry || now() - entry.firstAt > FAILURE_WINDOW_MS) {
      memoryState.failures.set(key, { count: 1, firstAt: now() });
      return;
    }
    entry.count += 1;
  }

  clearFailures(partnerId, userId) {
    memoryState.failures.delete(`${normalizePartnerId(partnerId)}:${userId || ''}`);
  }
}

module.exports = {
  AssistanceService,
  GRANT_TTL_SECONDS
};
