'use strict';

const Redis = require('ioredis');

const memoryState = {
  endpoints: new Map(),
  socketEndpoints: new Map()
};
let lastRedisErrorLog = 0;

class MemoryPresenceStore {
  async addEndpoint(userId, terminalId, socketId, info = {}) {
    const now = Date.now();
    const endpoint = {
      userId,
      terminalId,
      socketId,
      ip: info.ip || '',
      ua: info.ua || '',
      os: info.os || '',
      loginAt: String(info.loginAt || now),
      lastSeen: String(now)
    };
    memoryState.endpoints.set(`${terminalId}:${socketId}`, endpoint);
    memoryState.socketEndpoints.set(socketId, endpoint);
  }

  async removeBySocket(socketId) {
    const endpoint = memoryState.socketEndpoints.get(socketId);
    if (!endpoint) return;
    memoryState.socketEndpoints.delete(socketId);
    memoryState.endpoints.delete(`${endpoint.terminalId}:${socketId}`);
  }

  async updateLastSeen(terminalId, socketId) {
    const endpoint = memoryState.endpoints.get(`${terminalId}:${socketId}`);
    if (endpoint) endpoint.lastSeen = String(Date.now());
  }

  async getEndpointsByUser(userId) {
    return Array.from(memoryState.endpoints.values()).filter((endpoint) => endpoint.userId === userId);
  }

  async getEndpointsByTerminal(terminalId) {
    return Array.from(memoryState.endpoints.values()).filter((endpoint) => endpoint.terminalId === terminalId);
  }

  async removeEndpoint(terminalId) {
    const endpoints = await this.getEndpointsByTerminal(terminalId);
    await Promise.all(endpoints.map((endpoint) => this.removeBySocket(endpoint.socketId)));
  }

  async listAllEndpoints() {
    return Array.from(memoryState.endpoints.values());
  }

  async clearAllEndpoints() {
    memoryState.endpoints.clear();
    memoryState.socketEndpoints.clear();
  }
}

const buildRedis = () => {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION || '';
  if (!url) return null;

  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  redis.on('error', (error) => {
    const now = Date.now();
    if (now - lastRedisErrorLog >= 30000) {
      console.error(`[presence] Redis connection error: ${error.message}`);
      lastRedisErrorLog = now;
    }
  });
  return redis;
};

class PresenceService {
  constructor(redisClient) {
    this.redis = redisClient || buildRedis();
    this.memory = this.redis ? null : new MemoryPresenceStore();
  }

  async addEndpoint(userId, terminalId, socketId, info = {}) {
    if (!userId || !terminalId || !socketId) return;
    if (this.memory) return this.memory.addEndpoint(userId, terminalId, socketId, info);

    const now = Date.now();
    const endpointKey = `sock:endpoint:${terminalId}:${socketId}`;
    const keyUser = `sock:endpoints:${userId}`;
    const keySocket = `sock:socket:${socketId}`;
    const keyTerminalSockets = `sock:terminal-sockets:${terminalId}`;
    await this.redis.multi()
      .sadd(keyUser, endpointKey)
      .sadd(keyTerminalSockets, socketId)
      .hmset(endpointKey, {
        userId,
        terminalId,
        socketId,
        ip: info.ip || '',
        ua: info.ua || '',
        os: info.os || '',
        loginAt: info.loginAt || now,
        lastSeen: now
      })
      .set(keySocket, endpointKey)
      .exec();
  }

  async removeBySocket(socketId) {
    if (!socketId) return;
    if (this.memory) return this.memory.removeBySocket(socketId);

    const endpointKey = await this.redis.get(`sock:socket:${socketId}`);
    if (endpointKey) await this.removeEndpointByKey(endpointKey);
  }

  async removeEndpointByKey(endpointKey) {
    if (!endpointKey) return;
    const endpoint = await this.redis.hgetall(endpointKey);
    if (!endpoint || !Object.keys(endpoint).length) return;

    const keyUser = endpoint.userId ? `sock:endpoints:${endpoint.userId}` : null;
    const keyTerminalSockets = endpoint.terminalId ? `sock:terminal-sockets:${endpoint.terminalId}` : null;
    const keySocket = endpoint.socketId ? `sock:socket:${endpoint.socketId}` : null;
    const transaction = this.redis.multi();
    if (keyUser) transaction.srem(keyUser, endpointKey);
    if (keyTerminalSockets) transaction.srem(keyTerminalSockets, endpoint.socketId);
    transaction.del(endpointKey);
    if (keySocket) transaction.del(keySocket);
    await transaction.exec();

    if (keyTerminalSockets && await this.redis.scard(keyTerminalSockets) === 0) {
      await this.redis.del(keyTerminalSockets);
    }
  }

  async updateLastSeen(terminalId, socketId) {
    if (!terminalId || !socketId) return;
    if (this.memory) return this.memory.updateLastSeen(terminalId, socketId);
    await this.redis.hset(`sock:endpoint:${terminalId}:${socketId}`, 'lastSeen', Date.now());
  }

  async getEndpointsByUser(userId) {
    if (!userId) return [];
    if (this.memory) return this.memory.getEndpointsByUser(userId);
    return this.getEndpointsByKeys(await this.redis.smembers(`sock:endpoints:${userId}`));
  }

  async getEndpointsByTerminal(terminalId) {
    if (!terminalId) return [];
    if (this.memory) return this.memory.getEndpointsByTerminal(terminalId);

    const socketIds = await this.redis.smembers(`sock:terminal-sockets:${terminalId}`);
    return this.getEndpointsByKeys(socketIds.map((socketId) => `sock:endpoint:${terminalId}:${socketId}`));
  }

  async getEndpointsByKeys(keys = []) {
    if (!keys.length) return [];
    const results = await Promise.all(keys.map(async (key) => {
      const data = await this.redis.hgetall(key);
      return Object.keys(data || {}).length ? data : null;
    }));
    return results.filter(Boolean);
  }

  async getEndpoint(terminalId) {
    const endpoints = await this.getEndpointsByTerminal(terminalId);
    return endpoints.length ? endpoints[0] : null;
  }

  async removeEndpoint(terminalId) {
    if (!terminalId) return;
    if (this.memory) return this.memory.removeEndpoint(terminalId);

    const socketIds = await this.redis.smembers(`sock:terminal-sockets:${terminalId}`);
    for (const socketId of socketIds) {
      await this.removeEndpointByKey(`sock:endpoint:${terminalId}:${socketId}`);
    }
  }

  async listAllEndpoints() {
    if (this.memory) return this.memory.listAllEndpoints();
    return this.getEndpointsByKeys(await this.redis.keys('sock:endpoint:*'));
  }

  async listOnlineUsers() {
    const endpoints = await this.listAllEndpoints();
    const map = new Map();
    endpoints.forEach((endpoint) => {
      if (!endpoint.userId) return;
      if (!map.has(endpoint.userId)) map.set(endpoint.userId, []);
      map.get(endpoint.userId).push(endpoint);
    });
    return Array.from(map.entries()).map(([userId, endpointsForUser]) => ({
      userId,
      endpoints: endpointsForUser,
      count: endpointsForUser.length
    }));
  }

  async clearAllEndpoints() {
    if (this.memory) return this.memory.clearAllEndpoints();

    const patterns = [
      'sock:endpoint:*',
      'sock:endpoints:*',
      'sock:socket:*',
      'sock:terminal-sockets:*'
    ];
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    }
  }
}

module.exports = {
  PresenceService
};
