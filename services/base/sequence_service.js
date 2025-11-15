'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const { LogService } = require('./log_service');
const StringHelper = require('../../utilities/publiclibrary/string_helper');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();

class SequenceService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  static FillZeroPrefix = true;
  static DefaultSequence = 1000;
  static DefaultReduction = 9999999;
  static DefaultPrefix = '';
  static DefaultSeparator = '';
  static DefaultStep = 1;
  static DefaultSequenceLength = 8;
  static SequenceLength = 8;
  static UsePrefix = true;

  async add(userInfo, sequenceEntity) {
    await LogService.writeLog(
      userInfo,
      'SequenceService',
      FrameworkMessage.SequenceService || 'SequenceService',
      'SequenceService_Add',
      FrameworkMessage.SequenceService_Add || 'Add sequence',
      sequenceEntity?.ID || ''
    );

    try {
      const record = await this.prisma.cisequence.create({ data: sequenceEntity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[SequenceService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async getDT() {
    try {
      return await this.prisma.cisequence.findMany({
        where: { DELETEMARK: 0 },
        orderBy: { SORTCODE: 'asc' }
      });
    } catch (error) {
      console.error('[SequenceService.getDT]', error);
      return [];
    }
  }

  async getDTByPage(searchValue = '', pageSize = 50, order = '') {
    let sql = `SELECT * FROM cisequence WHERE DELETEMARK = 0`;
    if (searchValue) {
      sql += ` AND ${searchValue}`;
    }
    if (order) {
      sql += ` ORDER BY ${order}`;
    }
    const rows = await this.db.executeQuery(sql);
    const total = rows.length;
    return { staffCount: total, data: rows.slice(0, pageSize) };
  }

  async getEntity(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'SequenceService',
      FrameworkMessage.SequenceService || 'SequenceService',
      'SequenceService_GetEntity',
      FrameworkMessage.SequenceService_GetEntity || 'Get sequence',
      id || ''
    );
    try {
      return await this.prisma.cisequence.findUnique({ where: { ID: id } });
    } catch {
      return null;
    }
  }

  async update(entity) {
    if (!entity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.cisequence.update({
        where: { ID: entity.ID },
        data: entity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[SequenceService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async getSequence(fullName) {
    const sequenceEntity = await this.getEntityByAdd(fullName);
    await this.updateSequence(fullName, 1);

    return this.formatSequence(sequenceEntity);
  }

  async getOldSequence(fullName, defaultSequence, sequenceLength = SequenceService.SequenceLength, fillZeroPrefix = SequenceService.FillZeroPrefix) {
    const [sequenceEntity] = await this.ensureSequence(fullName, defaultSequence);
    return this.formatSequence(sequenceEntity, { sequenceLength, fillZeroPrefix });
  }

  async getNewSequence(fullName, defaultSequence, sequenceLength = SequenceService.SequenceLength, fillZeroPrefix = SequenceService.FillZeroPrefix) {
    const [sequenceEntity] = await this.ensureSequence(fullName, defaultSequence);
    return this.formatSequence(sequenceEntity, { sequenceLength, fillZeroPrefix });
  }

  async getUserIds(fullName, count) {
    const sequenceEntity = await this.getEntityByAdd(fullName);
    await this.updateSequence(fullName, count);
    return this.formatSequence(sequenceEntity);
  }

  getReduction() {
    // TODO: implement reduction sequences if needed
    return null;
  }

  reset() {
    // Placeholder for resetting sequences
    return null;
  }

  async delete(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'SequenceService',
      FrameworkMessage.SequenceService || 'SequenceService',
      'SequenceService_Delete',
      FrameworkMessage.SequenceService_Delete || 'Delete sequence',
      id || ''
    );
    return this.prisma.cisequence.delete({ where: { ID: id } });
  }

  async setDeleted(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'SequenceService',
      FrameworkMessage.SequenceService || 'SequenceService',
      'SequenceService_Delete',
      FrameworkMessage.SequenceService_Delete || 'Delete sequence',
      id || ''
    );
    return this.prisma.cisequence.update({
      where: { ID: id },
      data: { DELETEMARK: 1 }
    });
  }

  async batchDelete(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'SequenceService',
      FrameworkMessage.SequenceService || 'SequenceService',
      'SequenceService_Delete',
      FrameworkMessage.SequenceService_Delete || 'Delete sequence',
      ids.join(',')
    );
    return this.prisma.cisequence.deleteMany({ where: { ID: { in: ids } } });
  }

  async getEntityByAdd(fullName) {
    const existing = await this.prisma.cisequence.findFirst({
      where: { FULLNAME: fullName, DELETEMARK: 0 }
    });
    if (existing) {
      return existing;
    }

    const created = await this.prisma.cisequence.create({
      data: {
        FULLNAME: fullName,
        SEQUENCE: SequenceService.DefaultSequence,
        REDUCTION: SequenceService.DefaultReduction,
        STEP: SequenceService.DefaultStep,
        PREFIX: SequenceService.DefaultPrefix,
        SEPARATE: SequenceService.DefaultSeparator,
        DELETEMARK: 0,
        CREATEON: new Date()
      }
    });
    return created;
  }

  async updateSequence(fullName, sequenceCount) {
    await this.prisma.cisequence.updateMany({
      where: { FULLNAME: fullName },
      data: {
        SEQUENCE: { increment: sequenceCount * SequenceService.DefaultStep }
      }
    });
  }

  async ensureSequence(fullName, defaultSequence) {
    const sequence = await this.prisma.cisequence.findFirst({
      where: { FULLNAME: fullName, DELETEMARK: 0 }
    });
    if (sequence) {
      return [sequence];
    }
    const created = await this.prisma.cisequence.create({
      data: {
        FULLNAME: fullName,
        SEQUENCE: defaultSequence,
        REDUCTION: SequenceService.DefaultReduction,
        STEP: SequenceService.DefaultStep,
        PREFIX: SequenceService.DefaultPrefix,
        SEPARATE: SequenceService.DefaultSeparator,
        DELETEMARK: 0,
        CREATEON: new Date()
      }
    });
    return [created];
  }

  formatSequence(sequenceEntity, options = {}) {
    const { sequenceLength = SequenceService.SequenceLength, fillZeroPrefix = SequenceService.FillZeroPrefix } = options;
    let sequence = sequenceEntity.SEQUENCE.toString();
    if (fillZeroPrefix) {
      sequence = sequence.padStart(sequenceLength, '0');
    }
    if (SequenceService.UsePrefix) {
      sequence = `${sequenceEntity.PREFIX || ''}${sequenceEntity.SEPARATE || ''}${sequence}`;
    }
    return sequence;
  }
}

module.exports = {
  SequenceService,
  sequenceService: new SequenceService()
};
