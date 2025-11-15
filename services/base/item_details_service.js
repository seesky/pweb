'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const { LogService } = require('./log_service');

const prisma = new PrismaClient();

class ItemDetailsService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async add(userInfo, entity) {
    await LogService.writeLog(
      userInfo,
      'ItemDetailsService',
      FrameworkMessage.ItemDetailsService || 'ItemDetailsService',
      'ItemDetailsService_Add',
      FrameworkMessage.ItemDetailsService_Add || 'Add item detail',
      entity?.ID || ''
    );

    const exists = await this.getDTByValues({
      ITEMID: entity.ITEMID,
      ITEMNAME: entity.ITEMNAME,
      DELETEMARK: 0
    });
    if (exists.length) {
      return { returnValue: 0, statusMessage: 'Duplicate detail exists.' };
    }

    try {
      await this.prisma.ciitemdetails.create({ data: entity });
      return { returnValue: 1, statusMessage: 'Item detail added successfully.' };
    } catch (error) {
      console.error('[ItemDetailsService.add]', error);
      return { returnValue: 0, statusMessage: 'Operation failed.' };
    }
  }

  getDT() {
    return this.prisma.ciitemdetails.findMany({
      where: { DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async getEntity(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'ItemDetailsService',
      FrameworkMessage.ItemDetailsService || 'ItemDetailsService',
      'ItemDetailsService_GetEntity',
      FrameworkMessage.ItemDetailsService_GetEntity || 'Get item detail',
      id || ''
    );
    try {
      return await this.prisma.ciitemdetails.findUnique({ where: { ID: id } });
    } catch {
      return null;
    }
  }

  async update(entity) {
    if (!entity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.ciitemdetails.update({
        where: { ID: entity.ID },
        data: entity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[ItemDetailsService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  getDTByIds(ids = []) {
    return this.prisma.ciitemdetails.findMany({
      where: { ID: { in: ids } },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getDTByValues(valueDic = {}) {
    return this.prisma.ciitemdetails.findMany({ where: valueDic });
  }

  async batchSave(entities = []) {
    try {
      await this.prisma.$transaction(
        entities.map((item) =>
          this.prisma.ciitemdetails.upsert({
            where: { ID: item.ID || '' },
            create: item,
            update: item
          })
        )
      );
      return true;
    } catch (error) {
      console.error('[ItemDetailsService.batchSave]', error);
      return false;
    }
  }

  delete(id) {
    return this.prisma.ciitemdetails.delete({ where: { ID: id } });
  }

  batchDelete(ids = []) {
    return this.prisma.ciitemdetails.deleteMany({ where: { ID: { in: ids } } });
  }

  async setDeleted(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'ItemDetailsService',
      FrameworkMessage.ItemDetailsService || 'ItemDetailsService',
      'ItemDetailsService_SetDeleted',
      FrameworkMessage.ItemDetailsService_SetDeleted || 'Set deleted',
      ids.join(',')
    );
    return this.prisma.ciitemdetails.updateMany({
      where: { ID: { in: ids } },
      data: { DELETEMARK: 1 }
    });
  }

  async getDTByCode(code) {
    const items = await this.prisma.ciitems.findMany({
      where: { CODE: code },
      select: { ID: true }
    });
    if (!items.length) {
      return [];
    }
    return this.prisma.ciitemdetails.findMany({
      where: { ITEMID: { in: items.map((item) => item.ID) }, DELETEMARK: 0, ENABLED: 1 },
      orderBy: { SORTCODE: 'asc' }
    });
  }
}

module.exports = {
  ItemDetailsService,
  itemDetailsService: new ItemDetailsService()
};



