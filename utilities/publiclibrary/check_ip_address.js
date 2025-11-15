'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const CATEGORY_KEY = 'IPAddress';
const ENABLED_FLAG = 1;

class CheckIPAddress {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async checkIPAddress(ipAddress, userId) {
    if (!ipAddress || !userId) {
      return false;
    }

    const records = await this.prisma.ciparameter.findMany({
      where: {
        PARAMETERID: userId,
        CATEGORYKEY: CATEGORY_KEY,
        ENABLED: ENABLED_FLAG
      }
    });

    for (const record of records) {
      const parameterCode = (record.PARAMETERCODE || '').trim();
      const parameterContent = (record.PARAMETERCONTENT || '').trim();
      let match = false;

      switch (parameterCode) {
        case 'Single':
          match = this.checkSingleIPAddress(ipAddress, parameterContent);
          break;
        case 'Range':
          match = this.checkIPAddressWithRange(ipAddress, parameterContent);
          break;
        case 'Mask':
          match = this.checkIPAddressWithMask(ipAddress, parameterContent);
          break;
        default:
          break;
      }

      if (match) {
        return true;
      }
    }

    return false;
  }

  checkSingleIPAddress(ipAddress, sourceIp) {
    if (!ipAddress || !sourceIp) {
      return false;
    }
    return ipAddress.trim() === sourceIp.trim();
  }

  checkIPAddressWithRange(ipAddress, ipRange) {
    if (!ipAddress || !ipRange || !ipRange.includes('-')) {
      return false;
    }
    const [startRaw, endRaw] = ipRange.split('-').map((item) => item.trim());
    if (!startRaw || !endRaw) {
      return false;
    }

    let startIp = startRaw;
    let endIp = endRaw;
    const rangeOrder = this.compareIp(startIp, endIp);
    if (rangeOrder === -1) {
      return false;
    }
    if (rangeOrder === 2) {
      startIp = endRaw;
      endIp = startRaw;
    }

    const startCompare = this.compareIp(ipAddress, startIp);
    const endCompare = this.compareIp(ipAddress, endIp);

    if (startCompare === -1 || endCompare === -1) {
      return false;
    }

    const greaterOrEqualStart = startCompare === 1 || startCompare === 2;
    const lessOrEqualEnd = endCompare === 1 || endCompare === 0;
    return greaterOrEqualStart && lessOrEqualEnd;
  }

  compareIp(ip1, ip2) {
    const parts1 = this.parseIp(ip1);
    const parts2 = this.parseIp(ip2);
    if (!parts1 || !parts2) {
      return -1;
    }

    for (let i = 0; i < 4; i += 1) {
      if (parts1[i] > parts2[i]) {
        return 2;
      }
      if (parts1[i] < parts2[i]) {
        return 0;
      }
    }
    return 1;
  }

  checkIPAddressWithMask(ipAddress, ipWithMask) {
    const ipParts = this.parseIp(ipAddress);
    const maskParts = ipWithMask ? ipWithMask.split('.').map((part) => part.trim()) : null;

    if (!ipParts || !maskParts || maskParts.length !== 4) {
      return false;
    }

    for (let i = 0; i < 4; i += 1) {
      if (maskParts[i] === '*') {
        continue;
      }
      if (maskParts[i] !== ipParts[i].toString()) {
        return false;
      }
    }
    return true;
  }

  parseIp(ip) {
    if (!ip) {
      return null;
    }
    const parts = ip.split('.');
    if (parts.length !== 4) {
      return null;
    }
    const octets = [];
    for (const part of parts) {
      const value = Number(part);
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        return null;
      }
      octets.push(value);
    }
    return octets;
  }
}

module.exports = {
  CheckIPAddress,
  checkIPAddressService: new CheckIPAddress()
};
