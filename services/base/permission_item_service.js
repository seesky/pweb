'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const PermissionScope = require('../../utilities/message/permission_scope');
const prisma = new PrismaClient();

function success(code, message, value) {
  return { returnCode: code, returnMessage: message, returnValue: value };
}

function failure(code, message) {
  return { returnCode: code, returnMessage: message, returnValue: null };
}

const dedupe = (list = []) => [...new Set(list.filter(Boolean))];
const hierarchyMetadata = {
  pipermissionitem: { parentField: 'PARENTID', idField: 'ID', deleteField: 'DELETEMARK' },
  piorganize: { parentField: 'PARENTID', idField: 'ID', deleteField: 'DELETEMARK' }
};

class PermissionItemService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async add(permissionItemEntity) {
    try {
      const record = await this.prisma.pipermissionitem.create({ data: permissionItemEntity });
      return success(StatusCode.OKAdd, FrameworkMessage.MSG0009, record.ID);
    } catch (error) {
      console.error('[PermissionItemService.add]', error);
      return failure(StatusCode.DbError, FrameworkMessage.MSG0001);
    }
  }

  async addByDetail(code, fullName) {
    if (!code) {
      return failure(StatusCode.Error, FrameworkMessage.MSG0007.replace('{0}', 'code'));
    }
    try {
      const now = new Date();
      const record = await this.prisma.pipermissionitem.create({
        data: {
          ID: randomUUID(),
          CODE: code,
          FULLNAME: fullName || code,
          CREATEON: now,
          MODIFIEDON: now
        }
      });
      return success(StatusCode.OKAdd, FrameworkMessage.MSG0009, record.ID);
    } catch (error) {
      console.error('[PermissionItemService.addByDetail]', error);
      return failure(StatusCode.DbError, FrameworkMessage.MSG0001);
    }
  }

  getDT() {
    return this.prisma.pipermissionitem.findMany({
      where: { DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getList() {
    return this.prisma.pipermissionitem.findMany({
      where: { DELETEMARK: 0 }
    });
  }

  getDTByParent(parentId) {
    return this.prisma.pipermissionitem.findMany({
      where: { PARENTID: parentId, DELETEMARK: 0 }
    });
  }

  getListByParent(parentId) {
    return this.getDTByParent(parentId);
  }

  getDTByIds(ids = []) {
    return this.prisma.pipermissionitem.findMany({
      where: { ID: { in: ids }, DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async getLicensedDT(userId, permissionItemCode) {
    await this.ensurePermissionExists('Resource.ManagePermission');

    if (await this.userInRole(userId, 'UserAdmin')) {
      return this.prisma.pipermissionitem.findMany({
        where: { CATEGORYCODE: 'System', DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    if (await this.userInRole(userId, 'Admin')) {
      return this.prisma.pipermissionitem.findMany({
        where: { CATEGORYCODE: 'Application', DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    const permissionItemIds = await this.getTreeResourceScopeIds(userId, 'pipermissionitem', permissionItemCode, true);
    return this.prisma.pipermissionitem.findMany({
      where: { ID: { in: permissionItemIds }, DELETEMARK: 0, ENABLED: 1 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getEntity(id) {
    return this.prisma.pipermissionitem.findUnique({ where: { ID: id } });
  }

  getEntityByCode(code) {
    return this.prisma.pipermissionitem.findFirst({ where: { CODE: code } });
  }

  async update(permissionItemEntity) {
    if (!permissionItemEntity?.ID) {
      return failure(StatusCode.Error, FrameworkMessage.MSG0001);
    }
    try {
      await this.prisma.pipermissionitem.update({
        where: { ID: permissionItemEntity.ID },
        data: {
          ...permissionItemEntity,
          MODIFIEDON: permissionItemEntity.MODIFIEDON || new Date()
        }
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[PermissionItemService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async moveTo(permissionItemId, parentId) {
    try {
      const now = new Date();
      await this.prisma.pipermissionitem.update({
        where: { ID: permissionItemId },
        data: { PARENTID: parentId, MODIFIEDON: now }
      });
      return true;
    } catch (error) {
      console.error('[PermissionItemService.moveTo]', error);
      return false;
    }
  }

  async batchMoveTo(permissionItemIds = [], parentId) {
    try {
      const now = new Date();
      await this.prisma.pipermissionitem.updateMany({
        where: { ID: { in: permissionItemIds } },
        data: { PARENTID: parentId, MODIFIEDON: now }
      });
      return true;
    } catch (error) {
      console.error('[PermissionItemService.batchMoveTo]', error);
      return false;
    }
  }

  async delete(id) {
    try {
      const now = new Date();
      await this.prisma.pipermissionitem.update({
        where: { ID: id },
        data: { DELETEMARK: 1, MODIFIEDON: now }
      });
      return true;
    } catch (error) {
      console.error('[PermissionItemService.delete]', error);
      return false;
    }
  }

  async batchDelete(ids = []) {
    try {
      const now = new Date();
      await this.prisma.pipermissionitem.updateMany({
        where: { ID: { in: ids } },
        data: { DELETEMARK: 1, MODIFIEDON: now }
      });
      return true;
    } catch (error) {
      console.error('[PermissionItemService.batchDelete]', error);
      return false;
    }
  }

  setDeleted(ids = []) {
    return this.batchDelete(ids);
  }

  async batchSave(dataTable = []) {
    const operations = dataTable.map((item) => {
      if (item.ID) {
        return this.prisma.pipermissionitem.upsert({
          where: { ID: item.ID },
          create: item,
          update: item
        });
      }
      return this.prisma.pipermissionitem.create({ data: { ...item, ID: randomUUID() } });
    });
    try {
      await this.prisma.$transaction(operations);
      return true;
    } catch (error) {
      console.error('[PermissionItemService.batchSave]', error);
      return false;
    }
  }

  batchSetSortCode() {
    // Sorting strategy depends on specific business rules; leaving as a no-op.
    return false;
  }

  getIdsByModule(moduleId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIMODULE', RESOURCEID: moduleId, DELETEMARK: 0 }
    });
  }

  async getDTByUser(userId, permissionItemCode) {
    if (await this.userInRole(userId, 'UserAdmin')) {
      return this.prisma.pipermissionitem.findMany({
        where: { CATEGORYCODE: 'System', DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    if (await this.userInRole(userId, 'Admin')) {
      return this.prisma.pipermissionitem.findMany({
        where: { CATEGORYCODE: 'Application', DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    const ids = await this.getTreeResourceScopeIds(userId, 'pipermissionitem', permissionItemCode, true);
    return this.prisma.pipermissionitem.findMany({
      where: { ID: { in: ids }, DELETEMARK: 0, ENABLED: 1 }
    });
  }

  async userInRole(userId, roleCode) {
    if (!roleCode) {
      return false;
    }
    const role = await this.prisma.pirole.findFirst({
      where: { CODE: roleCode, DELETEMARK: 0 }
    });
    if (!role) {
      return false;
    }

    const user = await this.prisma.piuser.findFirst({
      where: { ID: userId, DELETEMARK: 0, ENABLED: 1 },
      select: { ROLEID: true }
    });

    const relations = await this.prisma.piuserrole.findMany({
      where: { USERID: userId, DELETEMARK: 0 },
      select: { ROLEID: true }
    });

    const roleIds = new Set();
    if (user?.ROLEID) {
      roleIds.add(user.ROLEID);
    }
    relations.forEach((rel) => {
      if (rel.ROLEID) {
        roleIds.add(rel.ROLEID);
      }
    });

    return roleIds.has(role.ID);
  }

  async getId(permissionScopeCode) {
    const record = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionScopeCode } });
    return record?.ID || null;
  }

  async getIdByAdd(permissionItemCode, permissionItemName) {
    const fullname = permissionItemName || permissionItemCode;
    const now = new Date();
    const existing = await this.prisma.pipermissionitem.findFirst({
      where: { CODE: permissionItemCode, DELETEMARK: 0 }
    });

    if (existing) {
      if (existing.FULLNAME !== fullname) {
        await this.prisma.pipermissionitem.update({
          where: { ID: existing.ID },
          data: { FULLNAME: fullname, MODIFIEDON: now, ENABLED: 1, DELETEMARK: 0 }
        });
      }
      return existing.ID;
    }

    const created = await this.prisma.pipermissionitem.create({
      data: {
        ID: randomUUID(),
        CODE: permissionItemCode,
        FULLNAME: fullname,
        CATEGORYCODE: 'Application',
        PARENTID: null,
        ISSCOPE: 0,
        ISPUBLIC: 0,
        ALLOWDELETE: 1,
        ALLOWEDIT: 1,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: now,
        MODIFIEDON: now
      }
    });
    return created.ID;
  }

  async getTreeResourceScopeIds(userId, tableName, permissionItemCode, childrens = false) {
    const normalizedTable = (tableName || '').toUpperCase();
    const ids = await this.getResourceScopeIds(userId, normalizedTable, permissionItemCode);
    if (!childrens || !ids?.length) {
      return ids;
    }
    return this.expandHierarchyIds(tableName, ids);
  }

  async getResourceScopeIds(userId, targetCategory, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }

    const user = await this.prisma.piuser.findUnique({
      where: { ID: userId },
      select: { ROLEID: true }
    });
    const q1 = await this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: targetCategory,
        PERMISSIONID: permissionItem.ID,
        ENABLED: 1,
        DELETEMARK: 0
      },
      select: { TARGETID: true }
    });

    const relationRoles = await this.prisma.piuserrole.findMany({
      where: { USERID: userId, ENABLED: 1, DELETEMARK: 0 },
      select: { ROLEID: true }
    });

    let q2 = [];
    const relationRoleIds = relationRoles.map((item) => item.ROLEID).filter(Boolean);
    if (user?.ROLEID) {
      relationRoleIds.push(user.ROLEID);
    }
    const roleIds = dedupe(relationRoleIds);
    if (roleIds.length) {
      q2 = await this.prisma.pipermissionscope.findMany({
        where: {
          RESOURCECATEGORY: 'PIROLE',
          RESOURCEID: { in: roleIds },
          TARGETCATEGORY: targetCategory,
          PERMISSIONID: permissionItem.ID,
          ENABLED: 1,
          DELETEMARK: 0
        },
        select: { TARGETID: true }
      });
    }

    const resourceIds = dedupe([...q1, ...q2].map((item) => item.TARGETID));

    if (targetCategory === 'PIORGANIZE') {
      const [, permissionScope] = await this.transformPermissionScope(userId, resourceIds);
      if (permissionScope === PermissionScope.Detail && resourceIds.length === 0) {
        return [];
      }
    }
    return resourceIds;
  }

  async transformPermissionScope(userId, resourceIds = []) {
    let permissionScope = PermissionScope.No;
    if (!resourceIds.length) {
      return [resourceIds, permissionScope];
    }

    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    if (!user) {
      return [resourceIds, permissionScope];
    }

    resourceIds.forEach((resourceId) => {
      if (resourceId === PermissionScope.All) {
        permissionScope = PermissionScope.All;
      } else if (resourceId === PermissionScope.UserCompany) {
        permissionScope = PermissionScope.UserCompany;
      } else if (resourceId === PermissionScope.UserDepartment) {
        permissionScope = PermissionScope.UserDepartment;
      } else if (resourceId === PermissionScope.UserWorkgroup) {
        permissionScope = PermissionScope.UserWorkgroup;
      }
    });

    return [resourceIds, permissionScope];
  }

  async expandHierarchyIds(tableName, seedIds = []) {
    const tableKey = (tableName || '').toLowerCase();
    const delegate = this.prisma[tableKey];
    if (!delegate?.findMany) {
      return seedIds;
    }

    const metadata = hierarchyMetadata[tableKey] || {
      parentField: 'PARENTID',
      idField: 'ID',
      deleteField: 'DELETEMARK'
    };

    const collected = new Set(seedIds);
    let frontier = [...seedIds];
    while (frontier.length) {
      const where = { [metadata.parentField]: { in: frontier } };
      if (metadata.deleteField) {
        where[metadata.deleteField] = 0;
      }
      const children = await delegate.findMany({
        where,
        select: { [metadata.idField]: true }
      });
      frontier = [];
      children.forEach((child) => {
        const childId = child[metadata.idField];
        if (childId && !collected.has(childId)) {
          collected.add(childId);
          frontier.push(childId);
        }
      });
    }
    return Array.from(collected);
  }

  async ensurePermissionExists(code) {
    const item = await this.prisma.pipermissionitem.findFirst({ where: { CODE: code } });
    if (!item) {
      const now = new Date();
      await this.prisma.pipermissionitem.create({
        data: {
          ID: randomUUID(),
          CODE: code,
          FULLNAME: code,
          CATEGORYCODE: 'System',
          ISSCOPE: 0,
          ISPUBLIC: 0,
          ALLOWDELETE: 1,
          ALLOWEDIT: 1,
          ENABLED: 1,
          DELETEMARK: 0,
          CREATEON: now,
          MODIFIEDON: now
        }
      });
    }
  }
}

module.exports = {
  PermissionItemService,
  permissionItemService: new PermissionItemService()
};
