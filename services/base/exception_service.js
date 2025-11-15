'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const { LogService } = require('./log_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();

class ExceptionService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  async add(entity) {
    try {
      const record = await this.prisma.ciexception.create({ data: entity });
      return {
        returnCode: StatusCode.OKAdd,
        returnMessage: FrameworkMessage.MSG0009,
        returnValue: record.ID
      };
    } catch (error) {
      console.error('[ExceptionService.add]', error);
      return {
        returnCode: StatusCode.DbError,
        returnMessage: FrameworkMessage.MSG0001,
        returnValue: null
      };
    }
  }

  getDT() {
    return this.prisma.ciexception.findMany();
  }

  async getDTByPage(pageIndex = 1, pageSize = 20, whereConditional = '', order = '') {
    const whereClause = whereConditional ? `WHERE ${whereConditional}` : '';
    const orderClause = order?.trim() ? order : 'CREATEON';
    const sql = `SELECT * FROM ciexception ${whereClause} ORDER BY ${orderClause}`;
    const rows = await this.db.executeQuery(sql);
    const total = rows.length;
    const start = (Math.max(1, pageIndex) - 1) * pageSize;
    const data = rows.slice(start, start + pageSize);
    return { recordCount: total, data };
  }

  getEntity(id) {
    return this.prisma.ciexception.findUnique({ where: { ID: id } });
  }

  getDTByValues(valueDic = {}) {
    return this.prisma.ciexception.findMany({ where: valueDic });
  }

  async delete(userInfo, ids = []) {
    if (!ids.length) {
      return 0;
    }
    await LogService.writeLog(
      userInfo,
      'ExceptionService',
      FrameworkMessage.ExceptionService || 'ExceptionService',
      'ExceptionService_Delete',
      FrameworkMessage.ExceptionService_Delete || 'Delete exception',
      ids.join(',')
    );
    const result = await this.prisma.ciexception.deleteMany({ where: { ID: { in: ids } } });
    return result.count;
  }

  batchDelete(ids = []) {
    if (!ids.length) {
      return 0;
    }
    return this.prisma.ciexception.deleteMany({ where: { ID: { in: ids } } });
  }

  truncate() {
    return this.prisma.ciexception.deleteMany({});
  }
}

module.exports = {
  ExceptionService,
  exceptionService: new ExceptionService()
};
