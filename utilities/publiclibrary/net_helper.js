'use strict';

class NetHelper {
  static getIpAddress(request) {
    if (!request || !request.headers) {
      return null;
    }

    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const list = forwarded.split(',').map((ip) => ip.trim()).filter(Boolean);
      if (list.length) {
        return list[0];
      }
    }

    return (
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.connection?.socket?.remoteAddress ||
      null
    );
  }
}

module.exports = NetHelper;
