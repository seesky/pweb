'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const PermissionScope = require('../../utilities/message/permission_scope');
const { UserRoleService } = require('../base/user_role_service');

const prisma = new PrismaClient();
const userRoleService = new UserRoleService(prisma);

const toUnique = (items = []) => [...new Set(items.filter(Boolean))];

class RolePermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  getRolePermissionItemIds(roleId) {
    return this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        DELETEMARK: 0,
        ENABLED: 1
      },
      select: { PERMISSIONID: true }
    });
  }

  getRoleIdsByPermissionItemId(permissionItemId) {
    return this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        PERMISSIONID: permissionItemId,
        DELETEMARK: 0,
        ENABLED: 1
      }
    });
  }

  async grantRolePermissions(userInfo, roleIds = [], grantPermissionItemIds = []) {
    let count = 0;
    for (const roleId of roleIds) {
      for (const permissionId of grantPermissionItemIds) {
        count += await this.grant(userInfo, roleId, permissionId);
      }
    }
    return count;
  }

  async grantRolePermission(roleName, permissionItemCode) {
    const role = await this.prisma.pirole.findFirst({ where: { REALNAME: roleName } });
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!role?.ID || !permissionItem?.ID) {
      return 0;
    }
    return this.grant(null, role.ID, permissionItem.ID);
  }

  grantRolePermissionById(roleId, permissionItemId) {
    return this.grant(null, roleId, permissionItemId);
  }

  async revokeRolePermissions(roleIds = [], revokePermissionItemIds = []) {
    let count = 0;
    for (const roleId of roleIds) {
      for (const permissionId of revokePermissionItemIds) {
        count += await this.revoke(roleId, permissionId);
      }
    }
    return count;
  }

  async revokeRolePermission(roleName, permissionItemCode) {
    const role = await this.prisma.pirole.findFirst({ where: { REALNAME: roleName } });
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!role?.ID || !permissionItem?.ID) {
      return 0;
    }
    return this.revoke(role.ID, permissionItem.ID);
  }

  revokeRolePermissionById(roleId, permissionItemId) {
    return this.revoke(roleId, permissionItemId);
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

  getScopePermissionItemIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIPERMISSIONITEM');
  }

  getScopeModuleIdsByRoleId(roleId, permissionItemCode) {
    return this.getScopeTargetIds(roleId, permissionItemCode, 'PIMODULE');
  }

  async grantRoleUserScope(userInfo, roleId, permissionItemCode, grantUserIds = []) {
    let count = 0;
    for (const userId of grantUserIds) {
      await this.grantUser(userInfo, roleId, permissionItemCode, userId);
      count += 1;
    }
    return count;
  }

  async revokeRoleUserScope(roleId, permissionItemCode, revokeUserIds = []) {
    let count = 0;
    for (const userId of revokeUserIds) {
      await this.revokeUser(roleId, permissionItemCode, userId);
      count += 1;
    }
    return count;
  }

  async grantRoleRoleScope(userInfo, roleId, permissionItemCode, grantRoleIds = []) {
    let count = 0;
    for (const grantId of grantRoleIds) {
      await this.grantRole(userInfo, roleId, permissionItemCode, grantId);
      count += 1;
    }
    return count;
  }

  async revokeRoleRoleScope(roleId, permissionItemCode, revokeRoleIds = []) {
    let count = 0;
    for (const revokeId of revokeRoleIds) {
      await this.revokeRole(roleId, permissionItemCode, revokeId);
      count += 1;
    }
    return count;
  }

  async grantRoleOrganizeScope(userInfo, roleId, permissionItemCode, grantOrganizeIds = []) {
    let count = 0;
    for (const orgId of grantOrganizeIds) {
      await this.grantOrganize(userInfo, roleId, permissionItemCode, orgId);
      count += 1;
    }
    return count;
  }

  async revokeRoleOrganizeScope(roleId, permissionItemCode, revokeOrganizeIds = []) {
    let count = 0;
    for (const orgId of revokeOrganizeIds) {
      await this.revokeOrganize(roleId, permissionItemCode, orgId);
      count += 1;
    }
    return count;
  }

  async grantRolePermissionItemScope(userInfo, roleId, permissionItemCode, grantPermissionItemIds = []) {
    let count = 0;
    for (const permissionId of grantPermissionItemIds) {
      await this.grantPermissionItem(userInfo, roleId, permissionItemCode, permissionId);
      count += 1;
    }
    return count;
  }

  async revokeRolePermissionItemScope(roleId, permissionItemCode, revokePermissionItemIds = []) {
    let count = 0;
    for (const permissionId of revokePermissionItemIds) {
      await this.revokePermissionItem(roleId, permissionItemCode, permissionId);
      count += 1;
    }
    return count;
  }

  clearRolePermissionScope(roleId, permissionItemCode) {
    return this.clearScope(roleId, permissionItemCode);
  }

  async clearRolePermissionByRoleId(roleId) {
    let count = 0;
    count += await userRoleService.eliminateRoleUser(roleId);
    count += (
      await this.prisma.pipermissionscope.deleteMany({
        where: { RESOURCECATEGORY: 'PIROLE', RESOURCEID: roleId }
      })
    ).count;
    count += (
      await this.prisma.pipermission.deleteMany({
        where: { RESOURCECATEGORY: 'PIROLE', RESOURCEID: roleId }
      })
    ).count;
    return count;
  }

  async grantRoleModuleScope(userInfo, roleId, permissionItemCode, grantModuleIds = []) {
    let count = 0;
    for (const moduleId of grantModuleIds) {
      await this.grantModule(userInfo, roleId, permissionItemCode, moduleId);
      count += 1;
    }
    return count;
  }

  async revokeRoleModuleScope(roleId, permissionItemCode, revokeModuleIds = []) {
    let count = 0;
    for (const moduleId of revokeModuleIds) {
      await this.revokeModule(roleId, permissionItemCode, moduleId);
      count += 1;
    }
    return count;
  }

  async grant(userInfo, roleId, permissionItemId) {
    const exists = await this.prisma.pipermission.findFirst({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        PERMISSIONID: permissionItemId,
        DELETEMARK: 0
      }
    });
    if (exists) {
      return 0;
    }
    await this.prisma.pipermission.create({
      data: {
        ID: randomUUID(),
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null,
        MODIFIEDON: new Date(),
        MODIFIEDBY: userInfo?.RealName || null,
        MODIFIEDUSERID: userInfo?.Id || null
      }
    });
    return 1;
  }

  async revoke(roleId, permissionItemId) {
    const result = await this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        PERMISSIONID: permissionItemId
      }
    });
    return result.count;
  }

  async grantUser(userInfo, roleId, permissionItemCode, userId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return null;
    }
    const record = await this.prisma.pipermissionscope.create({
      data: {
        ID: randomUUID(),
        PERMISSIONID: permissionItem.ID,
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIUSER',
        TARGETID: userId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null,
        MODIFIEDON: new Date(),
        MODIFIEDBY: userInfo?.RealName || null,
        MODIFIEDUSERID: userInfo?.Id || null
      }
    });
    return record.ID;
  }

  async revokeUser(roleId, permissionItemCode, userId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIUSER',
        TARGETID: userId,
        PERMISSIONID: permissionItem.ID
      }
    });
    return result.count;
  }

  async grantRole(userInfo, roleId, permissionItemCode, grantRoleId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return null;
    }
    const record = await this.prisma.pipermissionscope.create({
      data: {
        ID: randomUUID(),
        PERMISSIONID: permissionItem.ID,
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIROLE',
        TARGETID: grantRoleId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null,
        MODIFIEDON: new Date(),
        MODIFIEDBY: userInfo?.RealName || null,
        MODIFIEDUSERID: userInfo?.Id || null
      }
    });
    return record.ID;
  }

  async revokeRole(roleId, permissionItemCode, revokeRoleId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIROLE',
        TARGETID: revokeRoleId,
        PERMISSIONID: permissionItem.ID
      }
    });
    return result.count;
  }

  async grantOrganize(userInfo, roleId, permissionItemCode, organizeId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return null;
    }
    const exists = await this.prisma.pipermissionscope.findFirst({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIORGANIZE',
        TARGETID: organizeId,
        PERMISSIONID: permissionItem.ID,
        DELETEMARK: 0
      }
    });
    if (exists) {
      return exists.ID;
    }
    const record = await this.prisma.pipermissionscope.create({
      data: {
        ID: randomUUID(),
        PERMISSIONID: permissionItem.ID,
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIORGANIZE',
        TARGETID: organizeId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null,
        MODIFIEDON: new Date(),
        MODIFIEDBY: userInfo?.RealName || null,
        MODIFIEDUSERID: userInfo?.Id || null
      }
    });

    const noScope = PermissionScope.PermissionScopeDic?.No;
    if (noScope && organizeId !== noScope) {
      await this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIROLE',
          RESOURCEID: roleId,
          TARGETCATEGORY: 'PIORGANIZE',
          PERMISSIONID: permissionItem.ID,
          TARGETID: noScope
        }
      });
    } else if (noScope) {
      await this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIROLE',
          RESOURCEID: roleId,
          TARGETCATEGORY: 'PIORGANIZE',
          PERMISSIONID: permissionItem.ID,
          TARGETID: { not: noScope }
        }
      });
    }
    return record.ID;
  }

  async revokeOrganize(roleId, permissionItemCode, organizeId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIORGANIZE',
        TARGETID: organizeId,
        PERMISSIONID: permissionItem.ID
      }
    });
    return result.count;
  }

  async grantPermissionItem(userInfo, roleId, permissionItemCode, grantPermissionId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return null;
    }
    const record = await this.prisma.pipermissionscope.create({
      data: {
        ID: randomUUID(),
        PERMISSIONID: permissionItem.ID,
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        TARGETCATEGORY: 'PIPERMISSIONITEM',
        TARGETID: grantPermissionId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        CREATEBY: userInfo?.RealName || null,

