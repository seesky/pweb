'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const { ModulePermission } = require('../permission/module_permission');
const { PermissionScopeService } = require('./permission_scope_service');
const { PermissionItemService } = require('./permission_item_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const modulePermission = new ModulePermission(prisma);
const permissionScopeService = new PermissionScopeService(prisma);
const permissionItemService = new PermissionItemService(prisma);

class ModuleService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  getDT() {
    return this.prisma.pimodule.findMany({ where: { DELETEMARK: 0 }, orderBy: { SORTCODE: 'asc' } });
  }

  getDTByCondition(condition) {
    const where = condition ? `${condition} AND deletemark = 0` : 'deletemark = 0';
    const sql = `SELECT * FROM pimodule WHERE ${where}`;
    return db.executeQuery(sql);
  }

  getList() {
    return this.getDT();
  }

  getDTByIds(ids = []) {
    return this.prisma.pimodule.findMany({
      where: { DELETEMARK: 0, ID: { in: ids } },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getEntity(id) {
    return this.prisma.pimodule.findUnique({ where: { ID: id } });
  }

  async getFullNameByCode(code) {
    const module = await this.prisma.pimodule.findFirst({ where: { CODE: code } });
    return module?.FULLNAME || null;
  }

  async add(moduleEntity) {
    const exists = await this.exists(moduleEntity);
    if (exists) {
      return {
        returnCode: StatusCode.ErrorCodeExist,
        returnMessage: FrameworkMessage.MSG0001,
        returnValue: null
      };
    }
    try {
      const record = await this.prisma.pimodule.create({ data: moduleEntity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[ModuleService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async update(moduleEntity) {
    if (!moduleEntity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.pimodule.update({
        where: { ID: moduleEntity.ID },
        data: moduleEntity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[ModuleService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  getDTByParent(parentId) {
    return this.prisma.pimodule.findMany({
      where: { DELETEMARK: 0, PARENTID: parentId },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async delete(id) {
    try {
      await this.prisma.pimodule.update({
        where: { ID: id },
        data: { DELETEMARK: 1 }
      });
      return true;
    } catch (error) {
      console.error('[ModuleService.delete]', error);
      return false;
    }
  }

  batchDelete(ids = []) {
    return this.prisma.pimodule.updateMany({
      where: { ID: { in: ids } },
      data: { DELETEMARK: 1 }
    });
  }

  setDeleted(ids = []) {
    return this.batchDelete(ids);
  }

  async moveTo(moduleId, parentId) {
    try {
      await this.prisma.pimodule.update({
        where: { ID: moduleId },
        data: { PARENTID: parentId }
      });
      return true;
    } catch (error) {
      console.error('[ModuleService.moveTo]', error);
      return false;
    }
  }

  async batchMoveTo(moduleIds = [], parentId) {
    try {
      await this.prisma.pimodule.updateMany({
        where: { ID: { in: moduleIds } },
        data: { PARENTID: parentId }
      });
      return true;
    } catch (error) {
      console.error('[ModuleService.batchMoveTo]', error);
      return false;
    }
  }

  async batchSave(dataTable = []) {
    try {
      await this.prisma.$transaction(
        dataTable.map((record) =>
          this.prisma.pimodule.upsert({
            where: { ID: record.ID || '' },
            create: record,
            update: record
          })
        )
      );
      return true;
    } catch (error) {
      console.error('[ModuleService.batchSave]', error);
      return false;
    }
  }

  setSortCode() {
    return null;
  }

  async getPermissionDT(moduleId) {
    const ids = await modulePermission.getPermissionIds(moduleId);
    const permissionIds = ids.map((row) => row.PERMISSIONID);
    return permissionItemService.getDTByIds(permissionIds);
  }

  getIdsByPermission(permissionItemId) {
    return modulePermission.getModuleIds(permissionItemId);
  }

  batchAddPermissions(moduleId, permissionItemIds = []) {
    return modulePermission.addsI(moduleId, permissionItemIds);
  }

  batchAddModules(moduleIds = [], permissionItemId) {
    return modulePermission.addsM(moduleIds, permissionItemId);
  }

  batchDeletePermissions(moduleId, permissionItemIds = []) {
    return modulePermission.deletesI(moduleId, permissionItemIds);
  }

  batchDeleteModules(modulesIds = [], permissionItemId) {
    return modulePermission.deletesM(modulesIds, permissionItemId);
  }

  getPermissionIds(moduleId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIMODULE', RESOURCEID: moduleId, DELETEMARK: 0 }
    });
  }

  async exists(entity) {
    const module = await this.prisma.pimodule.findFirst({
      where: {
        DELETEMARK: 0,
        CODE: entity.CODE,
        FULLNAME: entity.FULLNAME
      }
    });
    return Boolean(module);
  }

  async getIDsByUser(userId) {
    const openModuleIds = await this.prisma.pimodule.findMany({
      where: { ISPUBLIC: 1, ENABLED: 1, DELETEMARK: 0 },
      select: { ID: true }
    });

    let otherModuleIds = [];
    if (userId) {
      const ids = await permissionScopeService.getResourceScopeIds(userId, 'PIMODULE', 'Resource.AccessPermission');
      otherModuleIds = ids.map((id) => ({ ID: id }));
    }

    return Array.from(new Set([...openModuleIds.map((row) => row.ID), ...otherModuleIds.map((row) => row.ID)]));
  }

  async getDTByUser(userId) {
    const moduleIds = await this.getIDsByUser(userId);
    return this.getDTByIds(moduleIds);
  }
}

module.exports = {
  ModuleService,
  moduleService: new ModuleService()
};
