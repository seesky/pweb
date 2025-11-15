'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const SystemInfo = require('../../utilities/publiclibrary/system_info');
const StringHelper = require('../../utilities/publiclibrary/string_helper');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const { PermissionScopeService } = require('./permission_scope_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const permissionScopeService = new PermissionScopeService(prisma);

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class LogService {
  static async add(userInfo, processName, methodName, processId, methodEngName, parameters) {
    if (!SystemInfo.EnableRecordLog) {
      return;
    }
    const now = new Date();
    await prisma.cilog.create({
      data: {
        ID: randomUUID(),
        IPADDRESS: userInfo?.IPAddress || null,
        CREATEON: now,
        CREATEUSERID: userInfo?.Id || null,
        USERREALNAME: userInfo?.RealName || null,
        PROCESSID: processId || null,
        PROCESSNAME: processName || null,
        METHODENGNAME: methodEngName || null,
        METHODNAME: methodName || null,
        PARAMETERS: parameters || null,
        CREATEBY: userInfo?.RealName || null
      }
    });
  }

  static async writeLog(userInfo, processId, processName, methodId, methodName, parameters) {
    if (!userInfo) {
      return;
    }
    await LogService.add(userInfo, processName, methodName, processId, methodId, parameters);
  }

  static async writeExit() {
    // Placeholder for future implementation.
  }

  static async getDTByDate(userInfo, beginDate, endDate, userId, moduleId) {
    let ids = null;
    if (!userId) {
      if (userInfo?.IsAdministrator) {
        ids = null;
      } else if (userInfo?.Id) {
        ids = await permissionScopeService.getUserIds(userInfo.Id, 'Resource.ManagePermission');
      }
    }
    const sql = LogService.getDTSql(userId ? [userId] : ids, 'PROCESSID', moduleId, beginDate, endDate);
    return db.executeQuery(sql);
  }

  static async getDTByModule(userInfo, processId, beginDate, endDate) {
    let ids = null;
    if (!userInfo?.IsAdministrator && userInfo?.Id) {
      ids = await permissionScopeService.getUserIds(userInfo.Id, 'Resource.ManagePermission');
    }
    const sql = LogService.getDTSql(ids, 'PROCESSID', processId, beginDate, endDate);
    return db.executeQuery(sql);
  }

  static async getDTByUser(userId, beginDate, endDate) {
    const sql = LogService.getDTSql(null, 'CREATEUSERID', userId, beginDate, endDate);
    return db.executeQuery(sql);
  }

  static async getDTByPage(pageIndex = 1, pageSize = 20, whereConditional = '', order = '') {
    const whereClause = whereConditional ? `WHERE ${whereConditional}` : '';
    const orderClause = order?.trim() ? order : 'CREATEON';
    const sql = `SELECT * FROM cilog ${whereClause} ORDER BY ${orderClause}`;
    const rows = await db.executeQuery(sql);
    const total = rows.length;
    const start = (Math.max(1, pageIndex) - 1) * pageSize;
    const page = rows.slice(start, start + pageSize);
    return { recordCount: total, data: page };
  }

  static delete(id) {
    return prisma.cilog.delete({ where: { ID: id } });
  }

  static batchDelete(ids = []) {
    return prisma.cilog.deleteMany({ where: { ID: { in: ids } } });
  }

  static truncate() {
    return prisma.cilog.deleteMany({});
  }

  static async getDTApplicationByDate(beginDate, endDate) {
    const sql = LogService.getDTSql(null, '', '', beginDate, endDate);
    return db.executeQuery(sql);
  }

  static batchDeleteApplication(ids = []) {
    return LogService.batchDelete(ids);
  }

  static truncateApplication() {
    return LogService.truncate();
  }

  static getDTSql(userIds, name, value, beginDate, endDate) {
    let sql = 'SELECT * FROM cilog WHERE 1=1';

    if (value) {
      sql += ` AND ${name} = '${value}'`;
    }

    const begin = formatDate(beginDate);
    const end = formatDate(endDate);

    if (userIds && userIds.length) {
      sql += ` AND CREATEUSERID IN (${StringHelper.objectsToList(userIds)})`;
    }

    if (begin) {
      sql += ` AND CREATEON >= '${begin}'`;
    }
    if (end) {
      sql += ` AND CREATEON <= '${end}'`;
    }

    sql += ' ORDER BY CREATEON DESC';
    return sql;
  }
}

module.exports = {
  LogService
};
