'use strict';

const { PrismaClient } = require('@prisma/client');
const { platformService } = require('../management/platform_service');

class AuditService {
  constructor(client = new PrismaClient()) {
    this.prisma = client;
  }

  async log(event) {
    try {
      let tenantId = event.tenantId || null;
      if (!tenantId && event.targetTerminalId) {
        const device = await platformService.getDeviceByTerminal(event.targetTerminalId);
        tenantId = device?.tenantId || null;
      }
      // A user's own socket lifecycle belongs to the user's personal workspace.
      // Never silently put realtime audit records in the shared legacy tenant.
      if (!tenantId && event.userId && !String(event.userId).startsWith('device:')) {
        tenantId = `u:${event.userId}`;
      }
      if (!tenantId) throw new Error('unable to resolve audit tenant');
      await platformService.forTenant(tenantId).writeAudit({
        actorId: event.userId,
        actorName: event.userName,
        category: event.category || 'session',
        action: event.action,
        target: event.description,
        ip: event.ip,
        detail: event.payload || {}
      });
      return;
    } catch (err) {
      // fall through to legacy audit
    }

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
