'use strict';

const crypto = require('crypto');

const AES_KEY = Buffer.from('12345678901234567890123456789012', 'utf-8');
const BLOCK_SIZE = 16;

class SecretHelper {
  static aesEncrypt(toEncrypt = '') {
    if (!toEncrypt.trim()) {
      return '';
    }
    const data = Buffer.from(toEncrypt, 'utf-8');
    const remainder = data.length % BLOCK_SIZE;
    const paddingLength = remainder === 0 ? BLOCK_SIZE : BLOCK_SIZE - remainder;
    const padded = Buffer.concat([data, Buffer.alloc(paddingLength, paddingLength)]);
    const cipher = crypto.createCipheriv('aes-256-ecb', AES_KEY, null);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString('base64');
  }

  static aesDecrypt(toDecrypt = '') {
    if (!toDecrypt.trim()) {
      return '';
    }
    const encrypted = Buffer.from(toDecrypt, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-ecb', AES_KEY, null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const paddingLength = decrypted[decrypted.length - 1];
    return decrypted.slice(0, decrypted.length - paddingLength).toString('utf-8');
  }
}

module.exports = SecretHelper;
