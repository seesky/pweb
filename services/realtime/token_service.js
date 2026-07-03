'use strict';

const jwt = require('jsonwebtoken');
const { getSecret } = require('../../middleware/security');

const DEFAULT_EXPIRES_SECONDS = 60 * 60 * 24 * 365; // 1 year for long-lived clients

class SocketTokenService {
  constructor(secret) {
    this.secret = secret || process.env.SOCKET_JWT_SECRET || getSecret('SOCKET_JWT_SECRET');
  }

  issue(userId, terminalId, expiresInSeconds = DEFAULT_EXPIRES_SECONDS, profile = {}) {
    if (!userId) {
      throw new Error('userId is required to issue socket token');
    }
    const payload = {
      uid: userId,
      tid: terminalId || null
    };
    // Embed the display profile so clients can show the account name/email
    // without an extra request — including on cached-token startup.
    if (profile.username) payload.username = profile.username;
    if (profile.email) payload.email = profile.email;
    return jwt.sign(payload, this.secret, {
      expiresIn: expiresInSeconds,
      algorithm: 'HS256',
      issuer: 'poleis-socket'
    });
  }

  // 设备身份 token：企业版被控主机 enroll 后用它连信令，无需任何用户登录。
  // payload.kind='device' 区别于用户 token；绑定设备所属企业租户。
  issueDeviceToken(deviceId, terminalId, tenantId, expiresInSeconds = 60 * 60 * 24 * 3650) {
    if (!deviceId || !terminalId) {
      throw new Error('deviceId and terminalId are required to issue device token');
    }
    const payload = {
      kind: 'device',
      did: deviceId,
      tid: terminalId,
      tenant: tenantId || null
    };
    return jwt.sign(payload, this.secret, {
      expiresIn: expiresInSeconds,
      algorithm: 'HS256',
      issuer: 'poleis-socket'
    });
  }

  verify(token) {
    try {
      return jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: 'poleis-socket'
      });
    } catch (error) {
      return null;
    }
  }
}

module.exports = {
  SocketTokenService
};
