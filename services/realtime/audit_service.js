'use strict';

const { PrismaClient } = require('@prisma/client');

class AuditService {
  constructor(client = new PrismaClient()) {
    this.prisma = client;
  }

  async log(event) {
    // Best-effort logging into existing cILog table if present; otherwise console.
    try {
      if (this.prisma.cilog) {
        await this.prisma.cilog.create({
          data: {
            ID: event.id || '',
            PROCESSID: event.processId || '',
            PROCESSNAME: event.processName || 'socket',
            METHODENGNAME: event.action || '',
            METHODNAME: event.action || '',
            PARAMETERS: JSON.stringify(event.payload || {}),
            USERREALNAME: event.userName || '',
            IPADDRESS: event.ip || '',
            WEBURL: event.url || '',
            DESCRIPTION: event.description || '',
            CREATEON: new Date(),
            CREATEUSERID: event.userId || '',
            CREATEBY: event.userName || ''
          }
        });
        return;
      }
    } catch (err) {
      // fall through to console
    }
    console.info('[SocketAudit]', event);
  }
}

module.exports = {
  AuditService
};
