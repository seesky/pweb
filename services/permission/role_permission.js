'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const { PermissionItemService } = require('../base/permission_item_service');

const prisma = new PrismaClient();
const permissionItemService = new PermissionItemService(prisma);

const RESOURCE_CATEGORY = 'PIROLE';
const toUnique = (list = []) => [...new Set(list.filter(Boolean))];

const buildScopeRecord = ({
  resourceId,
  targetCategory,
  targetId,
  permissionId,
  userInfo
}) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    RESOURCECATEGORY: RESOURCE_CATEGORY,
    RESOURCEID: resourceId,
    TARGETCATEGORY: targetCategory,
    TARGETID: targetId,
    PERMISSIONID: permissionId,
    ENABLED: 1,
    DELETEMARK: 0,
    CREATEON: now,
    CREATEUSERID: userInfo?.Id || null,
    CREATEBY: userInfo?.RealName || null,
    MODIFIEDON: now,
    MODIFIEDUSERID: userInfo?.Id || null,
    MODIFIEDBY: userInfo?.RealName || null
  };
};

class RolePermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  getRolePermissionItemIds(roleId) {
    if (!roleId) {
      return Promise.resolve([]);
    }
    return this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        ENABLED: 1,
        DELETEMARK: 0
      },
      select: { PERMISSIONID: true }
    });
  }

  getRoleIdsByPermissionItemId(permissionItemId) {
    if (!permissionItemId) {
      return Promise.resolve([]);
    }
    return this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0
      },
      select: { RESOURCEID: true }
    });
  }

  async grantRolePermissions(userInfo, roleIds = [], permissionItemIds = []) {
    let count = 0;
    for (const roleId of toUnique(roleIds)) {
      for (const permissionId of toUnique(permissionItemIds)) {
        await this.grant(userInfo, roleId, permissionId);
        count += 1;
      }
    }
    return count;
  }

  async grantRolePermission(roleName, permissionItemCode) {
    if (!roleName || !permissionItemCode) {
      return 0;
    }
    const role = await this.prisma.pirole.findFirst({ where: { REALNAME: roleName } });
    const permission = await this.ensurePermissionItem(permissionItemCode);
    if (!role?.ID || !permission) {
      return 0;
    }
    await this.grant(null, role.ID, permission);
    return 1;
  }

  async grantRolePermissionById(roleId, permissionItemId) {
    if (!roleId || !permissionItemId) {
      return 0;
    }
    await this.grant(null, roleId, permissionItemId);
    return 1;
  }

  async revokeRolePermissions(roleIds = [], permissionItemIds = []) {
    let count = 0;
    for (const roleId of toUnique(roleIds)) {
      for (const permissionId of toUnique(permissionItemIds)) {
        count += await this.revoke(roleId, permissionId);
      }
    }
    return count;
  }

  async revokeRolePermission(roleName, permissionItemCode) {
    if (!roleName || !permissionItemCode) {
      return 0;
    }
    const role = await this.prisma.pirole.findFirst({ where: { REALNAME: roleName } });
    const permission = await this.ensurePermissionItem(permissionItemCode);
    if (!role?.ID || !permission) {
      return 0;
    }
    return this.revoke(role.ID, permission);
  }

  revokeRolePermissionById(roleId, permissionItemId) {
    if (!roleId || !permissionItemId) {
      return 0;
    }
    return this.revoke(roleId, permissionItemId);
  }

  getScopeModuleIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIMODULE');
  }

  getScopePermissionItemIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIPERMISSIONITEM');
  }

  getScopeUserIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIUSER');
  }

  getScopeRoleIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIROLE');
  }

  getScopeOrganizeIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIORGANIZE');
  }

  async grantRoleModuleScope(userInfo, roleId, permissionItemCode, moduleIds = []) {
    await this.grantScopeTargets(userInfo, roleId, permissionItemCode, 'PIMODULE', moduleIds);
  }

  async revokeRoleModuleScope(roleId, permissionItemCode, moduleIds = []) {
    await this.revokeScopeTargets(roleId, permissionItemCode, 'PIMODULE', moduleIds);
  }

  async grantRolePermissionItemScope(userInfo, roleId, permissionItemCode, permissionItemIds = []) {
    await this.grantScopeTargets(userInfo, roleId, permissionItemCode, 'PIPERMISSIONITEM', permissionItemIds);
  }

  async revokeRolePermissionItemScope(roleId, permissionItemCode, permissionItemIds = []) {
    await this.revokeScopeTargets(roleId, permissionItemCode, 'PIPERMISSIONITEM', permissionItemIds);
  }

  async grantRoleUserScope(userInfo, roleId, permissionItemCode, userIds = []) {
    await this.grantScopeTargets(userInfo, roleId, permissionItemCode, 'PIUSER', userIds);
  }

  async revokeRoleUserScope(roleId, permissionItemCode, userIds = []) {
    await this.revokeScopeTargets(roleId, permissionItemCode, 'PIUSER', userIds);
  }

  async grantRoleRoleScope(userInfo, roleId, permissionItemCode, roleIds = []) {
    await this.grantScopeTargets(userInfo, roleId, permissionItemCode, 'PIROLE', roleIds);
  }

  async revokeRoleRoleScope(roleId, permissionItemCode, revokeRoleIds = []) {
    await this.revokeScopeTargets(roleId, permissionItemCode, 'PIROLE', revokeRoleIds);
  }

  async grantRoleOrganizeScope(userInfo, roleId, permissionItemCode, organizeIds = []) {
    await this.grantScopeTargets(userInfo, roleId, permissionItemCode, 'PIORGANIZE', organizeIds);
  }

  async revokeRoleOrganizeScope(roleId, permissionItemCode, organizeIds = []) {
    await this.revokeScopeTargets(roleId, permissionItemCode, 'PIORGANIZE', organizeIds);
  }

  async clearRolePermissionScope(roleId, permissionItemCode) {
    const permissionId = await this.ensurePermissionItem(permissionItemCode);
    if (!permissionId) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        PERMISSIONID: permissionId
      }
    });
    return result.count;
  }

  async clearRolePermissionByRoleId(roleId) {
    if (!roleId) {
      return 0;
    }
    const deleted = await this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId
      }
    });
    await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId
      }
    });
    return deleted.count;
  }

  async grant(userInfo, roleId, permissionItemId) {
    if (!roleId || !permissionItemId) {
      return '';
    }
    const exists = await this.prisma.pipermission.findFirst({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        PERMISSIONID: permissionItemId,
        DELETEMARK: 0
      }
    });
    if (exists) {
      return exists.ID;
    }
    const now = new Date();
    const record = await this.prisma.pipermission.create({
      data: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: now,
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null,
        MODIFIEDON: now,
        MODIFIEDBY: userInfo?.RealName || null,
        MODIFIEDUSERID: userInfo?.Id || null
      }
    });
    return record.ID;
  }

  revoke(roleId, permissionItemId) {
    if (!roleId || !permissionItemId) {
      return 0;
    }
    return this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        PERMISSIONID: permissionItemId
      }
    }).then((result) => result.count);
  }

  async grantScopeTargets(userInfo, roleId, permissionItemCode, targetCategory, targetIds = []) {
    const permissionId = await this.ensurePermissionItem(permissionItemCode);
    if (!roleId || !permissionId || !targetIds?.length) {
      return 0;
    }
    let count = 0;
    for (const targetId of toUnique(targetIds)) {
      if (!targetId) continue;
      const exists = await this.prisma.pipermissionscope.findFirst({
        where: {
          RESOURCECATEGORY: RESOURCE_CATEGORY,
          RESOURCEID: roleId,
          TARGETCATEGORY: targetCategory,
          TARGETID: targetId,
          PERMISSIONID: permissionId,
          DELETEMARK: 0
        }
      });
      if (exists) {
        continue;
      }
      await this.prisma.pipermissionscope.create({
        data: buildScopeRecord({
          resourceId: roleId,
          targetCategory,
          targetId,
          permissionId,
          userInfo
        })
      });
      count += 1;
    }
    return count;
  }

  async revokeScopeTargets(roleId, permissionItemCode, targetCategory, targetIds = []) {
    const permissionId = await this.ensurePermissionItem(permissionItemCode);
    if (!permissionId || !roleId || !targetIds?.length) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        TARGETCATEGORY: targetCategory,
        TARGETID: { in: toUnique(targetIds) },
        PERMISSIONID: permissionId
      }
    });
    return result.count;
  }

  async getScopeTargetIds(roleId, permissionItemCode, targetCategory) {
    if (!roleId || !permissionItemCode) {
      return [];
    }
    const permissionId = await this.ensurePermissionItem(permissionItemCode);
    if (!permissionId) {
      return [];
    }
    return this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: RESOURCE_CATEGORY,
        RESOURCEID: roleId,
        TARGETCATEGORY: targetCategory,
        PERMISSIONID: permissionId,
        DELETEMARK: 0
      },
      select: { TARGETID: true }
    });
  }

  async ensurePermissionItem(permissionItemCode) {
    if (!permissionItemCode) {
      return null;
    }
    const item = await permissionItemService.getEntityByCode(permissionItemCode);
    if (item?.ID) {
      return item.ID;
    }
    const created = await this.prisma.pipermissionitem.create({
      data: {
        ID: randomUUID(),
        CODE: permissionItemCode,
        FULLNAME: permissionItemCode,
        CATEGORYCODE: 'Application',
        ISSCOPE: 0,
        ISPUBLIC: 0,
        ALLOWDELETE: 1,
        ALLOWEDIT: 1,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        MODIFIEDON: new Date()
      }
    });
    return created.ID;
  }
}

module.exports = {
  RolePermission,
  rolePermission: new RolePermission()
};
