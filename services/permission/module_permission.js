'use strict';

const { PrismaClient } = require('@prisma/client');

const { PermissionScopeService } = require('../base/permission_scope_service');

const prisma = new PrismaClient();
const permissionScopeService = new PermissionScopeService(prisma);

class ModulePermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  getPermissionIds(moduleId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIMODULE', RESOURCEID: moduleId, DELETEMARK: 0 },
      select: { PERMISSIONID: true }
    });
  }

  getModuleIds(permissionItemId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIPERMISSION', PERMISSIONID: permissionItemId, DELETEMARK: 0 },
      select: { RESOURCEID: true }
    });
  }

  async add(moduleId, permissionItemId) {
    const exists = await this.prisma.pipermission.findFirst({
      where: {
        RESOURCECATEGORY: 'PIMODULE',
        RESOURCEID: moduleId,
        PERMISSIONID: permissionItemId,
        DELETEMARK: 0
      }
    });
    if (exists) {
      return 0;
    }
    await this.prisma.pipermission.create({
      data: {
        RESOURCEID: moduleId,
        RESOURCECATEGORY: 'pipermission',
        ENABLED: 1,
        DELETEMARK: 0,
        PERMISSIONID: permissionItemId
      }
    });
    return 1;
  }

  async addsI(moduleId, permissionItemIds = []) {
    let count = 0;
    for (const permissionId of permissionItemIds) {
      count += await this.add(moduleId, permissionId);
    }
    return count;
  }

  async addsM(moduleIds = [], permissionItemId) {
    let count = 0;
    for (const moduleId of moduleIds) {
      count += await this.add(moduleId, permissionItemId);
    }
    return count;
  }

  delete(moduleId, permissionItemId) {
    return this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIMODULE',
        RESOURCEID: moduleId,
        PERMISSIONID: permissionItemId
      }
    });
  }

  async deletesM(moduleIds = [], permissionItemId) {
    let count = 0;
    for (const moduleId of moduleIds) {
      const result = await this.delete(moduleId, permissionItemId);
      count += result.count;
    }
    return count;
  }

  async deletesI(moduleId, permissionItemIds = []) {
    let count = 0;
    for (const permissionId of permissionItemIds) {
      const result = await this.delete(moduleId, permissionId);
      count += result.count;
    }
    return count;
  }

  async getDTByPermission(userId, permissionItemScopeCode) {
    if (await this.userInRole(userId, 'UserAdmin')) {
      return this.prisma.pimodule.findMany({
        where: { CATEGORY: 'System', DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    if (await this.userInRole(userId, 'Admin')) {
      return this.prisma.pimodule.findMany({
        where: { CATEGORY: 'Application', DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }

    const moduleIds = await permissionScopeService.getTreeResourceScopeIds(
      userId,
      'PIMODULE',
      permissionItemScopeCode,
      true
    );

    return this.prisma.pimodule.findMany({
      where: { ID: { in: moduleIds }, DELETEMARK: 0, ENABLED: 1 }
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
    const roleIds = await this.getAllRoleIds(userId);
    return roleIds.includes(role.ID);
  }

  async getAllRoleIds(userId) {
    if (!userId) {
      return [];
    }
    const list1 = await this.prisma.piuser.findMany({
      where: { ID: userId, DELETEMARK: 0, ENABLED: 1 },
      select: { ROLEID: true }
    });
    const list2 = await this.prisma.piuserrole.findMany({
      where: {
        USERID: userId,
        DELETEMARK: 0,
        ROLEID: { in: await this.prisma.pirole.findMany({ where: { DELETEMARK: 0 }, select: { ID: true } }).then((rows) => rows.map((r) => r.ID)) }
      },
      select: { ROLEID: true }
    });

    const ids = new Set();
    list1.forEach((row) => row.ROLEID && ids.add(row.ROLEID));
    list2.forEach((row) => row.ROLEID && ids.add(row.ROLEID));
    return [...ids];
  }
}

module.exports = {
  ModulePermission,
  modulePermission: new ModulePermission()
};
