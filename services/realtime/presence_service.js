'use strict';

const Redis = require('ioredis');

const buildRedis = () => {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION || '';
  if (url) {
    return new Redis(url);
  }
  // fallback to localhost
  return new Redis();
};

class PresenceService {
  constructor(redisClient) {
    this.redis = redisClient || buildRedis();
  }

  async addEndpoint(userId, terminalId, socketId, info = {}) {
    if (!userId || !terminalId || !socketId) return;
    const now = Date.now();
    const keyEndpoint = `sock:terminal:${terminalId}`;
    const keyUser = `sock:endpoints:${userId}`;
    const keySocket = `sock:socket:${socketId}`;
    await this.redis.multi()
      .sadd(keyUser, terminalId)
      .hmset(keyEndpoint, {
        userId,
        socketId,
        ip: info.ip || '',
        ua: info.ua || '',
        os: info.os || '',
        loginAt: info.loginAt || now,
        lastSeen: now
      })
      .set(keySocket, terminalId)
      .exec();
  }

  async removeBySocket(socketId) {
    if (!socketId) return;
    const keySocket = `sock:socket:${socketId}`;
    const terminalId = await this.redis.get(keySocket);
    if (!terminalId) return;
    await this.removeEndpoint(terminalId);
  }

  async removeEndpoint(terminalId) {
    if (!terminalId) return;
    const keyEndpoint = `sock:terminal:${terminalId}`;
    const endpoint = await this.redis.hgetall(keyEndpoint);
    const userId = endpoint?.userId;
    const keySocket = endpoint?.socketId ? `sock:socket:${endpoint.socketId}` : null;
    const m = this.redis.multi();
    if (userId) m.srem(`sock:endpoints:${userId}`, terminalId);
    m.del(keyEndpoint);
    if (keySocket) m.del(keySocket);
    await m.exec();
  }

  async updateLastSeen(terminalId) {
    if (!terminalId) return;
    await this.redis.hset(`sock:terminal:${terminalId}`, 'lastSeen', Date.now());
  }

  async getEndpointsByUser(userId) {
    if (!userId) return [];
    const keyUser = `sock:endpoints:${userId}`;
    const terminalIds = await this.redis.smembers(keyUser);
    if (!terminalIds?.length) return [];
    const results = await Promise.all(
      terminalIds.map(async (tid) => {
        const data = await this.redis.hgetall(`sock:terminal:${tid}`);
        return Object.keys(data || {}).length
          ? { terminalId: tid, ...data }
          : null;
      })
    );
    return results.filter(Boolean);
  }

  async getEndpoint(terminalId) {
    if (!terminalId) return null;
    const data = await this.redis.hgetall(`sock:terminal:${terminalId}`);
    if (!data || !Object.keys(data).length) return null;
    return { terminalId, ...data };
  }

  async listAllEndpoints() {
    const keys = await this.redis.keys('sock:terminal:*');
    if (!keys?.length) return [];
    const results = await Promise.all(
      keys.map(async (key) => {
        const data = await this.redis.hgetall(key);
        const terminalId = key.split(':').pop();
        return Object.keys(data || {}).length ? { terminalId, ...data } : null;
      })
    );
    return results.filter(Boolean);
  }

  async listOnlineUsers() {
    const endpoints = await this.listAllEndpoints();
    const map = new Map();
    endpoints.forEach((ep) => {
      const uid = ep.userId;
      if (!uid) return;
      if (!map.has(uid)) map.set(uid, []);
      map.get(uid).push(ep);
    });
    return Array.from(map.entries()).map(([userId, eps]) => ({
      userId,
      endpoints: eps,
      count: eps.length
    }));
  }
}

module.exports = {
  PresenceService
};
