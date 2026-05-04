'use strict';

const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRES_SECONDS = 60 * 60 * 24 * 90; // 90 days for socket token

class SocketTokenService {
  constructor(secret) {
    this.secret = secret || process.env.SOCKET_JWT_SECRET || process.env.AUTH_JWT_SECRET || 'socket-secret';
  }

  issue(userId, terminalId, expiresInSeconds = DEFAULT_EXPIRES_SECONDS) {
    if (!userId) {
      throw new Error('userId is required to issue socket token');
    }
    const payload = {
      uid: userId,
      tid: terminalId || null
    };
    return jwt.sign(payload, this.secret, { expiresIn: expiresInSeconds });
  }

  verify(token) {
    try {
      return jwt.verify(token, this.secret);
    } catch (error) {
      return null;
    }
  }
}

module.exports = {
  SocketTokenService
};
