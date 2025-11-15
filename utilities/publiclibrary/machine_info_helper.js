'use strict';

const os = require('os');
const dgram = require('dgram');

class MachineInfoHelper {
  static async getIPAddress() {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      let resolved = false;

      const cleanup = (result) => {
        if (resolved) {
          return;
        }
        resolved = true;
        socket.removeAllListeners();
        try {
          socket.close();
        } catch (error) {
          // ignore if already closed
        }
        resolve(result);
      };

      socket.once('error', () => cleanup(null));
      socket.connect(80, '8.8.8.8', () => {
        const addressInfo = socket.address();
        cleanup(addressInfo.address || null);
      });
      setTimeout(() => cleanup(null), 3000);
    });
  }

  static getMacAddress() {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      if (!entries) continue;
      for (const net of entries) {
        if (net && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac.toUpperCase();
        }
      }
    }
    return null;
  }

  static getHostname() {
    return os.hostname();
  }
}

module.exports = MachineInfoHelper;
