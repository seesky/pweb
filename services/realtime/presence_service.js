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
    const keySocket = `sock:socket:${socketId}`;
    const endpointKey = await this.redis.get(keySocket);
    if (!endpointKey) return;
    await this.removeEndpointByKey(endpointKey);
  }

  async removeEndpointByKey(endpointKey) {
    if (!endpointKey) return;
    const endpoint = await this.redis.hgetall(endpointKey);
    if (!endpoint || !Object.keys(endpoint).length) return;
    const userId = endpoint.userId;
    const terminalId = endpoint.terminalId;
    const socketId = endpoint.socketId;
    const keyUser = userId ? `sock:endpoints:${userId}` : null;
    const keyTerminalSockets = terminalId ? `sock:terminal-sockets:${terminalId}` : null;
    const keySocket = socketId ? `sock:socket:${socketId}` : null;
    const m = this.redis.multi();
    if (keyUser) m.srem(keyUser, endpointKey);
    if (keyTerminalSockets) m.srem(keyTerminalSockets, socketId);
    m.del(endpointKey);
    if (keySocket) m.del(keySocket);
    await m.exec();

    // cleanup empty terminal set
    if (keyTerminalSockets) {
      const remaining = await this.redis.scard(keyTerminalSockets);
      if (remaining === 0) {
        await this.redis.del(keyTerminalSockets);
      }
    }
  }

  async updateLastSeen(terminalId, socketId) {
    if (!terminalId || !socketId) return;
    const endpointKey = `sock:endpoint:${terminalId}:${socketId}`;
    await this.redis.hset(endpointKey, 'lastSeen', Date.now());
  }

  async getEndpointsByUser(userId) {
    if (!userId) return [];
    const keyUser = `sock:endpoints:${userId}`;
    const endpointKeys = await this.redis.smembers(keyUser);
    if (!endpointKeys?.length) return [];
    const results = await Promise.all(
      endpointKeys.map(async (key) => {
        const data = await this.redis.hgetall(key);
        return Object.keys(data || {}).length ? data : null;
      })
    );
    return results.filter(Boolean);
  }

  async getEndpointsByTerminal(terminalId) {
    if (!terminalId) return [];
    const keyTerminalSockets = `sock:terminal-sockets:${terminalId}`;
    const socketIds = await this.redis.smembers(keyTerminalSockets);
    if (!socketIds?.length) return [];
    const results = await Promise.all(
      socketIds.map(async (sid) => {
        const data = await this.redis.hgetall(`sock:endpoint:${terminalId}:${sid}`);
        return Object.keys(data || {}).length ? data : null;
      })
    );
    return results.filter(Boolean);
  }

  async getEndpoint(terminalId) {
    // kept for backward compatibility: returns first endpoint if any
    const endpoints = await this.getEndpointsByTerminal(terminalId);
    return endpoints.length ? endpoints[0] : null;
  }

  async removeEndpoint(terminalId) {
    // 移除指定terminalId的所有终端连接
    if (!terminalId) return;
    const keyTerminalSockets = `sock:terminal-sockets:${terminalId}`;
    const socketIds = await this.redis.smembers(keyTerminalSockets);
    if (!socketIds?.length) return;

    // 移除每个socket连接
    for (const socketId of socketIds) {
      const endpointKey = `sock:endpoint:${terminalId}:${socketId}`;
      await this.removeEndpointByKey(endpointKey);
    }
  }

  async listAllEndpoints() {
    const keys = await this.redis.keys('sock:endpoint:*');
    if (!keys?.length) return [];
    const results = await Promise.all(
      keys.map(async (key) => {
        const data = await this.redis.hgetall(key);
        return Object.keys(data || {}).length ? data : null;
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

  async clearAllEndpoints() {
    // 清理所有在线状态数据，用于服务端重启时
    const patterns = [
      'sock:endpoint:*',
      'sock:endpoints:*',
      'sock:socket:*',
      'sock:terminal-sockets:*'
    ];
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys?.length) {
        await this.redis.del(...keys);
      }
    }
  }
}

module.exports = {
  PresenceService
};
