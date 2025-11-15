'use strict';
const { PrismaClient } = require('@prisma/client');
const path = require('node:path');
const fs = require('node:fs');
const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const { LogService } = require('./log_service');
const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const configPath = path.resolve(__dirname, '../../utilities/config/Config.ini');
class ParameterService {
  constructor(client = prisma) {
    this.prisma = client;
  }
  async getServiceConfig(userInfo, key) {
    if (userInfo) {
      await LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_GetServiceConfig', FrameworkMessage.ParameterService_GetServiceConfig || 'Get service config', key || '');
    }
    const config = fs.readFileSync(configPath, 'utf-8');
    const match = config.match(new RegExp(`${key}=(.*)`));
    return match ? match[1] : '';
  }
  async getParameter(userInfo, categoryKey, parameterId, parameterCode) {
    await LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_GetParameter', FrameworkMessage.ParameterService_GetParameter || 'Get parameter', parameterId || '');
    const record = await this.prisma.ciparameter.findFirst({
      where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, PARAMETERCODE: parameterCode, DELETEMARK: 0 }
    });
    return record?.PARAMETERCONTENT || null;
  }
  async getEntity(userInfo, id) {
    await LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_GetEntity', FrameworkMessage.ParameterService_GetEntity || 'Get parameter entity', id || '');
    return this.prisma.ciparameter.findUnique({ where: { ID: id } });
  }
  async setParameter(userInfo, categoryKey, parameterId, parameterCode, parameterContent, allowEdit = 0, allowDelete = 0) {
    await LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_SetParameter', FrameworkMessage.ParameterService_SetParameter || 'Set parameter', parameterId || '');
    if (!parameterContent) {
      const result = await this.prisma.ciparameter.deleteMany({
        where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, PARAMETERCODE: parameterCode, DELETEMARK: 0 }
      });
      return result.count;
    }
    const updated = await this.prisma.ciparameter.updateMany({
      where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, PARAMETERCODE: parameterCode, DELETEMARK: 0 },
      data: { PARAMETERCONTENT: parameterContent }
    });
    if (!updated.count) {
      await this.prisma.ciparameter.create({
        data: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, PARAMETERCODE: parameterCode, PARAMETERCONTENT: parameterContent, ALLOWDELETE: allowDelete, ALLOWEDIT: allowEdit, CREATEON: new Date(), MODIFIEDON: new Date(), ENABLED: 1, WORKED: 0, DELETEMARK: 0 }
      });
      return 1;
    }
    return updated.count;
  }
  getDTByParameter(userInfo, categoryKey, parameterId) {
    LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_GetDTByParameter', FrameworkMessage.ParameterService_GetDTByParameter || 'Get parameter list', parameterId || '');
    return this.prisma.ciparameter.findMany({ where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, DELETEMARK: 0 } });
  }
  getListByParameter(categoryKey, parameterId) {
    return this.prisma.ciparameter.findMany({ where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, DELETEMARK: 0 } });
  }
  getDTByParameterCode(categoryKey, parameterId, parameterCode) {
    return this.prisma.ciparameter.findMany({ where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, PARAMETERCODE: parameterCode, DELETEMARK: 0 } });
  }
  getListByParameterCode(categoryKey, parameterId, parameterCode) {
    return this.getDTByParameterCode(categoryKey, parameterId, parameterCode);
  }
  async getDTByPage(userInfo, searchValue, pageSize = 50, order) {
    await LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_GetDTByPage', FrameworkMessage.ParameterService_GetDTByPage || 'Get parameter page', '');
    let sql = `SELECT * FROM ${this.tableName()} WHERE DELETEMARK = 0`;
    if (searchValue) {
      sql = `SELECT * FROM ${this.tableName()} WHERE ${searchValue} AND DELETEMARK = 0`;
    }
    if (order) {
      sql += ` ORDER BY ${order}`;
    }
    const rows = await db.executeQuery(sql);
    return [rows.length, rows.slice(0, pageSize)];
  }
  setDeleted(userInfo, id) {
    LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_SetDeleted', FrameworkMessage.ParameterService_SetDeleted || 'Set parameter deleted', id || '');
    return this.prisma.ciparameter.updateMany({ where: { ID: id }, data: { DELETEMARK: 1 } });
  }
  deleteByParameter(categoryKey, parameterId) {
    return this.prisma.ciparameter.deleteMany({ where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId } });
  }
  deleteByParameterCode(categoryKey, parameterId, parameterCode) {
    return this.prisma.ciparameter.deleteMany({ where: { CATEGORYKEY: categoryKey, PARAMETERID: parameterId, PARAMETERCODE: parameterCode } });
  }
  async delete(userInfo, id) {
    await LogService.writeLog(userInfo, 'ParameterService', FrameworkMessage.ParameterService || 'ParameterService', 'ParameterService_Add', FrameworkMessage.ParameterService_Add || 'Delete parameter', id || '');
    return this.prisma.ciparameter.delete({ where: { ID: id } });
  }
  batchDelete(ids = []) {
    if (!ids.length) {
      return 0;
    }
    return this.prisma.ciparameter.deleteMany({ where: { ID: { in: ids } } });
  }
  async exists(parameterId, categoryKey) {
    const record = await this.prisma.ciparameter.findFirst({ where: { PARAMETERID: parameterId, CATEGORYKEY: categoryKey } });
    return Boolean(record);
  }
  tableName() {
    return 'ciparameter';
  }
}

module.exports = {
  ParameterService,
  parameterService: new ParameterService()
};
