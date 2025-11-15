'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class OrganizePermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async getScopeModuleIdsByOrganizeId(organizeId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }
    const scopes = await this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIORGANIZE',
        RESOURCEID: organizeId,
        TARGETCATEGORY: 'PIMODULE',
        PERMISSIONID: permissionItem.ID
      },
      select: { TARGETID: true }
    });
    return scopes.map((row) => row.TARGETID);
  }

  async grantOrganizeModuleScopes(organizeId, permissionItemCode, grantModuleIds = []) {
    let count = 0;
    for (const moduleId of grantModuleIds) {
      count += await this.grantOrganizeModuleScope(organizeId, permissionItemCode, moduleId);
    }
    return count;
  }

  async grantOrganizeModuleScope(organizeId, permissionItemCode, grantModuleId) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return 0;
    }
    await this.prisma.pipermissionscope.create({
      data: {
        RESOURCECATEGORY: 'PIORGANIZE',
        RESOURCEID: organizeId,
        TARGETCATEGORY: 'PIMODULE',
        TARGETID: grantModuleId,
        ENABLED: 1,
        DELETEMARK: 0,
        PERMISSIONID: permissionItem.ID
      }
    });
    return 1;
  }

  async revokeOrganizeModuleScopes(organizeId, permissionItemCode, revokeModuleIds = []) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIORGANIZE',
        RESOURCEID: organizeId,
        TARGETCATEGORY: 'PIMODULE',
        TARGETID: { in: revokeModuleIds },
        PERMISSIONID: permissionItem.ID
      }
    });
    return result.count;
  }

  async revokeOrganizeModuleScope(organizeId, permissionItemCode, revokeModuleId) {
    return this.revokeOrganizeModuleScopes(organizeId, permissionItemCode, [revokeModuleId]);
  }

  getOrganizePermissionItemIds(organizeId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIORGANIZE', RESOURCEID: organizeId, ENABLED: 1, DELETEMARK: 0 },
      select: { PERMISSIONID: true }
    });
  }

  getOrganizeIdsByPermissionItemId(permissionItemId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIORGANIZE', PERMISSIONID: permissionItemId, ENABLED: 1, DELETEMARK: 0 },
      select: { RESOURCEID: true }
    });
  }

  async grantOrganizePermissions(organizeIds = [], grantPermissionItemIds = []) {
    let count = 0;
    for (const org of organizeIds) {
      for (const permissionId of grantPermissionItemIds) {
        await this.prisma.pipermission.create({
          data: {
            RESOURCECATEGORY: 'PIORGANIZE',
            RESOURCEID: org,
            PERMISSIONID: permissionId,
            ENABLED: 1
          }
        });
        count += 1;
      }
    }
    return count;
  }

  async grantOrganizePermissionById(organizeId, grantPermissionItemId) {
    await this.prisma.pipermission.create({
      data: {
        RESOURCECATEGORY: 'PIORGANIZE',
        RESOURCEID: organizeId,
        PERMISSIONID: grantPermissionItemId,
        ENABLED: 1
      }
    });
    return 1;
  }

  async revokeOrganizePermissions(organizeIds = [], revokePermissionItemIds = []) {
    let count = 0;
    for (const org of organizeIds) {
      for (const permissionId of revokePermissionItemIds) {
        const result = await this.prisma.pipermission.deleteMany({
          where: {
            RESOURCECATEGORY: 'PIORGANIZE',
            RESOURCEID: org,
            PERMISSIONID: permissionId
          }
        });
        count += result.count;
      }
    }
    return count;
  }

  async clearOrganizePermission(organizeId) {
    const delPerm = await this.prisma.pipermission.deleteMany({
      where: { RESOURCECATEGORY: 'PIORGANIZE', RESOURCEID: organizeId }
    });
    const delScope = await this.prisma.pipermissionscope.deleteMany({
      where: { RESOURCECATEGORY: 'PIORGANIZE', RESOURCEID: organizeId }
    });
    return delPerm.count + delScope.count;
  }

  revokeOrganizePermissionById(organizeId, revokePermissionItemId) {
    return this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIORGANIZE',
        RESOURCEID: organizeId,
        PERMISSIONID: revokePermissionItemId
      }
    });
  }
}

module.exports = {
  OrganizePermission,
  organizePermission: new OrganizePermission()
};
