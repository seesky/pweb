'use strict';

const { PrismaClient } = require('@prisma/client');

const { PermissionScopeService } = require('../base/permission_scope_service');
const { PermissionItemService } = require('../base/permission_item_service');
const { ModuleService } = require('../base/module_service');
const PermissionScope = require('../../utilities/message/permission_scope');

const prisma = new PrismaClient();
const permissionScopeService = new PermissionScopeService(prisma);
const permissionItemService = new PermissionItemService(prisma);
const moduleService = new ModuleService(prisma);

const toUnique = (array = []) => [...new Set(array.filter(Boolean))];

class UserPermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  getUserPermissionItemIds(userId) {
    return this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        ENABLED: 1,
        DELETEMARK: 0
      },
      select: { PERMISSIONID: true }
    });
  }

  getUserIdsByPermissionItemId(permissionItemId) {
    return this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0
      },
      select: { RESOURCEID: true }
    });
  }

  async grantUserPermissions(userInfo, userIds = [], grantPermissionItemIds = []) {
    let count = 0;
    for (const userId of userIds) {
      for (const permissionId of grantPermissionItemIds) {
        await this.grant(userInfo, null, userId, permissionId);
        count += 1;
      }
    }
    return count;
  }

  grantUserPermissionById(userId, grantPermissionItemId) {
    if (!grantPermissionItemId) {
      return 0;
    }
    return this.grant(null, null, userId, grantPermissionItemId);
  }

  async revokeUserPermissions(userIds = [], revokePermissionItemIds = []) {
    let count = 0;
    for (const userId of userIds) {
      for (const permissionId of revokePermissionItemIds) {
        const result = await this.revoke(userId, permissionId);
        count += result;
      }
    }
    return count;
  }

  revokeUserPermissionById(userId, revokePermissionItemId) {
    return this.revoke(userId, revokePermissionItemId);
  }

  async getScopeOrganizeIdsByUserId(userId, permissionItemCode) {
    if (!permissionItemCode || typeof permissionItemCode !== 'string') {
      return [];
    }
    const permissionIds = await this.prisma.pipermissionitem
      .findMany({ where: { CODE: permissionItemCode }, select: { ID: true } })
      .then((rows) => rows.map((r) => r.ID))
      .catch(() => []);

    if (!Array.isArray(permissionIds) || !permissionIds.length) {
      return [];
    }

    return this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIORGANIZE',
        PERMISSIONID: { in: permissionIds }
      },
      select: { TARGETID: true }
    });
  }

  async grantUserOrganizeScope(userId, permissionScopeItemCode, grantOrganizeIds = []) {
    let count = 0;
    for (const id of grantOrganizeIds) {
      const result = await this.grantOrganize(userId, permissionScopeItemCode, id);
      if (result) {
        count += 1;
      }
    }
    return count;
  }

  async revokeUserOrganizeScope(userId, permissionScopeItemCode, revokeOrganizeIds = []) {
    let count = 0;
    for (const id of revokeOrganizeIds) {
      const result = await this.revokeOrganize(userId, permissionScopeItemCode, id);
      count += result;
    }
    return count;
  }

  getScopeUserIdsByUserId(userId, permissionItemCode) {
    return this.getUserIds(userId, permissionItemCode);
  }

  async grantUserUserScope(userId, permissionScopeItemCode, grantUserIds = []) {
    let count = 0;
    for (const id of grantUserIds) {
      const result = await this.grantUser(userId, permissionScopeItemCode, id);
      if (result) {
        count += 1;
      }
    }
    return count;
  }

  async revokeUserUserScope(userId, permissionScopeItemCode, revokeUserIds = []) {
    let count = 0;
    for (const id of revokeUserIds) {
      const result = await this.revokeUser(userId, permissionScopeItemCode, id);
      count += result;
    }
    return count;
  }

  getScopeRoleIdsByUserId(userId, permissionItemCode) {
    return this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIROLE',
        PERMISSIONID: {
          in: this.prisma.pipermissionitem
            .findMany({ where: { CODE: permissionItemCode }, select: { ID: true } })
            .then((rows) => rows.map((r) => r.ID))
        }
      },
      select: { TARGETID: true }
    });
  }

  async grantUserRoleScope(userId, permissionScopeItemCode, grantRoleIds = []) {
    let count = 0;
    for (const id of grantRoleIds) {
      const result = await this.grantRole(userId, permissionScopeItemCode, id);
      if (result) {
        count += 1;
      }
    }
    return count;
  }

  async revokeUserRoleScope(userId, permissionScopeItemCode, revokeRoleIds = []) {
    let count = 0;
    for (const id of revokeRoleIds) {
      const result = await this.revokeRole(userId, permissionScopeItemCode, id);
      count += result;
    }
    return count;
  }

  getScopePermissionItemIdsByUserId(userId, permissionItemCode) {
    return this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIPERMISSIONITEM',
        PERMISSIONID: {
          in: this.prisma.pipermissionitem
            .findMany({ where: { CODE: permissionItemCode }, select: { ID: true } })
            .then((rows) => rows.map((r) => r.ID))
        }
      },
      select: { TARGETID: true }
    });
  }

  async grantUserPermissionItemScope(userInfo, userId, permissionItemCode, grantPermissionItemIds = []) {
    let count = 0;
    for (const id of grantPermissionItemIds) {
      await this.grantPermissionItem(userInfo, userId, permissionItemCode, id);
      count += 1;
    }
    return count;
  }

  async revokeUserPermissionItemScope(userId, permissionItemCode, revokePermissionItemIds = []) {
    let count = 0;
    for (const id of revokePermissionItemIds) {
      const result = await this.revokePermissionItem(userId, permissionItemCode, id);
      count += result;
    }
    return count;
  }

  async clearUserPermissionByUserId(userId) {
    try {
      await this.prisma.piuser.update({
        where: { ID: userId },
        data: { ROLEID: null }
      });
      await this.prisma.piuserrole.deleteMany({ where: { USERID: userId } });
      await this.prisma.pipermission.deleteMany({
        where: { RESOURCECATEGORY: 'PIUSER', RESOURCEID: userId }
      });
      await this.prisma.pipermissionscope.deleteMany({
        where: { RESOURCECATEGORY: 'PIUSER', RESOURCEID: userId }
      });
      return true;
    } catch (error) {
      console.error('[UserPermission.clearUserPermissionByUserId]', error);
      return false;
    }
  }

  clearUserPermissionScope(userId, permissionItemCode) {
    return this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        PERMISSIONID: {
          in: this.prisma.pipermissionitem
            .findMany({ where: { CODE: permissionItemCode }, select: { ID: true } })
            .then((rows) => rows.map((r) => r.ID))
        }
      }
    });
  }

  async getModuleIdsByUserId(userInfo, userId) {
    if (userInfo?.IsAdministrator) {
      const rows = await this.prisma.pimodule.findMany({
        where: { DELETEMARK: 0, ENABLED: 1 },
        select: { ID: true }
      });
      return rows.map((row) => row.ID);
    }
    return moduleService.getIDsByUser(userId);
  }

  async getModuleDT(userInfo) {
    return this.getModuleDTByUserId(userInfo, userInfo?.Id);
  }

  async getModuleDTByUserId(userInfo, userId) {
    if (userInfo?.IsAdministrator) {
      return this.prisma.pimodule.findMany({
        where: { DELETEMARK: 0, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
    }
    return moduleService.getDTByUser(userId);
  }

  getScopeModuleIdsByUserId(userId, permissionItemCode) {
    return this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIMODULE',
        PERMISSIONID: {
          in: this.prisma.pipermissionitem
            .findMany({ where: { CODE: permissionItemCode }, select: { ID: true } })
            .then((rows) => rows.map((r) => r.ID))
        }
      },
      select: { TARGETID: true }
    });
  }

  async grantUserModuleScope(userInfo, userId, permissionScopeItemCode, grantModuleIds = []) {
    let count = 0;
    for (const moduleId of grantModuleIds) {
      const result = await this.grantModule(userInfo, userId, permissionScopeItemCode, moduleId);
      if (result) {
        count += 1;
      }
    }
    return count;
  }

  async revokeUserModuleScope(userId, permissionScopeItemCode, revokeModuleIds = []) {
    let count = 0;
    for (const id of revokeModuleIds) {
      const result = await this.revokeModule(userId, permissionScopeItemCode, id);
      count += result;
    }
    return count;
  }

  async grant(userInfo, sequence, userId, permissionItemId) {
    const exists = await this.prisma.pipermission.findFirst({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        PERMISSIONID: permissionItemId,
        DELETEMARK: 0
      }
    });

    if (exists) {
      return '';
    }

    const now = new Date();
    const record = await this.prisma.pipermission.create({
      data: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        PERMISSIONID: permissionItemId,
        CREATEON: now,
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null,
        MODIFIEDON: now,
        MODIFIEDBY: userInfo?.RealName || null,
        MODIFIEDUSERID: userInfo?.Id || null,
        DELETEMARK: 0,
        ENABLED: 1
      }
    });
    return record.ID;
  }

  revoke(userId, permissionItemId) {
    return this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        PERMISSIONID: permissionItemId
      }
    }).then((result) => result.count);
  }

  async grantOrganize(userId, permissionItemCode, grantOrganizeId) {
    const permissionItem = await permissionItemService.getIdByAdd(permissionItemCode);
    const exists = await this.prisma.pipermissionscope.findFirst({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIORGANIZE',
        TARGETID: grantOrganizeId,
        PERMISSIONID: permissionItem
      }
    });
    if (exists) {
      return '';
    }

    await this.prisma.pipermissionscope.create({
      data: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIORGANIZE',
        TARGETID: grantOrganizeId,
        PERMISSIONID: permissionItem,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });

    return grantOrganizeId;
  }

  revokeOrganize(userId, permissionItemCode, revokeOrganizeId) {
    return permissionItemService.getIdByAdd(permissionItemCode).then((permissionId) =>
      this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIUSER',
          RESOURCEID: userId,
          TARGETCATEGORY: 'PIORGANIZE',
          TARGETID: revokeOrganizeId,
          PERMISSIONID: permissionId
        }
      }).then((result) => result.count)
    );
  }

  async grantUser(userId, permissionItemCode, grantUserId) {
    const permissionId = await permissionItemService.getIdByAdd(permissionItemCode);
    const exists = await this.prisma.pipermissionscope.findFirst({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIUSER',
        TARGETID: grantUserId,
        PERMISSIONID: permissionId
      }
    });
    if (exists) {
      return '';
    }
    const record = await this.prisma.pipermissionscope.create({
      data: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIUSER',
        TARGETID: grantUserId,
        PERMISSIONID: permissionId,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });
    return record.ID;
  }

  revokeUser(userId, permissionItemCode, revokeUserId) {
    return permissionItemService.getIdByAdd(permissionItemCode).then((permissionId) =>
      this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIUSER',
          RESOURCEID: userId,
          TARGETCATEGORY: 'PIUSER',
          TARGETID: revokeUserId,
          PERMISSIONID: permissionId
        }
      }).then((result) => result.count)
    );
  }

  async grantRole(userId, permissionItemCode, grantRoleId) {
    const permissionId = await permissionItemService.getIdByAdd(permissionItemCode);
    const record = await this.prisma.pipermissionscope.create({
      data: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIROLE',
        TARGETID: grantRoleId,
        PERMISSIONID: permissionId,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });
    return record.ID;
  }

  revokeRole(userId, permissionItemCode, revokeRoleId) {
    return permissionItemService.getIdByAdd(permissionItemCode).then((permissionId) =>
      this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIUSER',
          RESOURCEID: userId,
          TARGETCATEGORY: 'PIROLE',
          TARGETID: revokeRoleId,
          PERMISSIONID: permissionId
        }
      }).then((result) => result.count)
    );
  }

  async grantPermissionItem(userInfo, userId, permissionItemCode, grantPermissionId) {
    const permissionId = await permissionItemService.getIdByAdd(permissionItemCode);
    const record = await this.prisma.pipermissionscope.create({
      data: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIPERMISSIONITEM',
        TARGETID: grantPermissionId,
        PERMISSIONID: permissionId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: new Date(),
        CREATEBY: userInfo?.RealName || null,
        CREATEUSERID: userInfo?.Id || null
      }
    });
    return record.ID;
  }

  revokePermissionItem(userId, permissionItemCode, revokePermissionId) {
    return permissionItemService.getIdByAdd(permissionItemCode).then((permissionId) =>
      this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIUSER',
          RESOURCEID: userId,
          TARGETCATEGORY: 'PIPERMISSIONITEM',
          TARGETID: revokePermissionId,
          PERMISSIONID: permissionId
        }
      }).then((result) => result.count)
    );
  }

  async grantModule(userInfo, userId, permissionItemCode, grantModuleId) {
    const permissionId = await permissionItemService.getIdByAdd(permissionItemCode);
    const now = new Date();
    const record = await this.prisma.pipermissionscope.create({
      data: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIMODULE',
        TARGETID: grantModuleId,
        PERMISSIONID: permissionId,
        ENABLED: 1,
        DELETEMARK: 0,
        CREATEON: now,
        CREATEUSERID: userInfo?.Id || null,
        CREATEBY: userInfo?.RealName || null,
        MODIFIEDON: now,
        MODIFIEDUSERID: userInfo?.Id || null,
        MODIFIEDBY: userInfo?.RealName || null
      }
    });
    return record.ID;
  }

  revokeModule(userId, permissionItemCode, revokeModuleId) {
    return permissionItemService.getIdByAdd(permissionItemCode).then((permissionId) =>
      this.prisma.pipermissionscope.deleteMany({
        where: {
          RESOURCECATEGORY: 'PIUSER',
          RESOURCEID: userId,
          TARGETCATEGORY: 'PIMODULE',
          TARGETID: revokeModuleId,
          PERMISSIONID: permissionId
        }
      }).then((result) => result.count)
    );
  }

  async getUserIds(userId, permissionItemCode) {
    const permissionId = await permissionItemService.getIdByAdd(permissionItemCode);
    const rows = await this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: userId,
        TARGETCATEGORY: 'PIUSER',
        PERMISSIONID: permissionId
      },
      select: { TARGETID: true }
    });
    return rows.map((row) => row.TARGETID);
  }
}

module.exports = {
  UserPermission,
  userPermission: new UserPermission()
};
