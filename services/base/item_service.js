'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const { LogService } = require('./log_service');
const { PermissionScopeService } = require('./permission_scope_service');

const prisma = new PrismaClient();
const permissionScopeService = new PermissionScopeService(prisma);

class ItemService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async getDT(userInfo) {
    if (userInfo?.IsAdministrator) {
      return this.prisma.ciitems.findMany({
        where: { DELETEMARK: 0 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    const ids = await permissionScopeService.getResourceScopeIds(
      userInfo?.Id,
      'ciitems',
      'Resource.ManagePermission'
    );
    return this.prisma.ciitems.findMany({
      where: { DELETEMARK: 0, ID: { in: ids } },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getDTByParent(parentId) {
    return this.prisma.ciitems.findMany({
      where: { DELETEMARK: 0, PARENTID: parentId },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getItemDetailDTByItemId(itemId) {
    return this.prisma.ciitemdetails.findMany({
      where: { DELETEMARK: 0, ITEMID: itemId },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async getEntity(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'ItemsService',
      FrameworkMessage.ItemsService || 'ItemsService',
      'ItemsService_GetEntity',
      FrameworkMessage.ItemsService_GetEntity || 'Get item',
      id || ''
    );
    try {
      return await this.prisma.ciitems.findUnique({ where: { ID: id } });
    } catch {
      return null;
    }
  }

  async add(userInfo, itemsEntity) {
    await LogService.writeLog(
      userInfo,
      'ItemsService',
      FrameworkMessage.ItemsService || 'ItemsService',
      'ItemsService_Add',
      FrameworkMessage.ItemsService_Add || 'Add item',
      itemsEntity?.ID || ''
    );

    const existing = await this.prisma.ciitems.findFirst({
      where: { ID: itemsEntity.ID, DELETEMARK: 0 }
    });
    if (existing) {
      return { returnValue: 0, statusMessage: '已存在相同的明细项！' };
    }

    try {
      await this.prisma.ciitems.create({ data: itemsEntity });
      return { returnValue: 1, statusMessage: '成功新增数据！' };
    } catch (error) {
      console.error('[ItemService.add]', error);
      return { returnValue: 0, statusMessage: '操作异常！' };
    }
  }

  async update(userInfo, itemsEntity) {
    await LogService.writeLog(
      userInfo,
      'ItemsService',
      FrameworkMessage.ItemsService || 'ItemsService',
      'ItemsService_Update',
      FrameworkMessage.ItemsService_Update || 'Update item',
      itemsEntity?.ID || ''
    );
    try {
      await this.prisma.ciitems.update({
        where: { ID: itemsEntity.ID },
        data: itemsEntity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[ItemService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  createTable() {
    // Not implemented in reference code.
    return null;
  }

  delete(id) {
    return this.prisma.ciitems.delete({ where: { ID: id } });
  }

  async setDeleted(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'ItemsService',
      FrameworkMessage.ItemsService || 'ItemsService',
      'ItemsService_SetDeleted',
      FrameworkMessage.ItemsService_SetDeleted || 'Set deleted',
      ids.join(',')
    );
    return this.prisma.ciitems.updateMany({
      where: { ID: { in: ids } },
      data: { DELETEMARK: 1 }
    });
  }
}

module.exports = {
  ItemService,
  itemService: new ItemService()
};
