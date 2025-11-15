'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const SystemInfo = require('../../utilities/publiclibrary/system_info');
const DefaultRole = require('../../utilities/message/default_role');
const StatusCode = require('../../utilities/message/status_code');

const { UserRoleService } = require('../base/user_role_service');
const { UserOrganizeService } = require('../base/user_organize_service');
const { ModuleService } = require('../base/module_service');
const { PermissionScopeService } = require('../base/permission_scope_service');

const prisma = new PrismaClient();
const userRoleService = new UserRoleService(prisma);
const userOrganizeService = new UserOrganizeService(prisma);
const moduleService = new ModuleService(prisma);
const permissionScopeService = new PermissionScopeService(prisma);

class PermissionService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async isInRole(userId, roleName) {
    const role = await this.prisma.pirole.findFirst({
      where: { REALNAME: roleName }
    });
    if (!role?.CODE) {
      return false;
    }
    return userRoleService.userInRole(userId, role.CODE);
  }

  async isAuthorized(userId, permissionItemCode, permissionItemName) {
    return this.isAuthorizedByUserId(userId, permissionItemCode, permissionItemName);
  }

  async isAuthorizedByUserId(userId, permissionItemCode, permissionItemName) {
    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    if (!user) {
      return false;
    }
    if (await this.isAdministrator(user)) {
      return true;
    }
    return this.checkPermissionByUser(userId, permissionItemCode, permissionItemName);
  }

  async isAuthorizedByRoleId(roleId, permissionItemCode) {
    if (!roleId) {
      return false;
    }
    if (roleId === DefaultRole.Administrators) {
      return true;
    }
    const permissionItem = await this.prisma.pipermissionitem.findFirst({
      where: { CODE: permissionItemCode }
    });
    if (!permissionItem?.ID) {
      return false;
    }
    const count = await this.prisma.pipermission.count({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: roleId,
        PERMISSIONID: permissionItem.ID,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });
    return count > 0;
  }

  async isAdministrator(userEntity) {
    if (!userEntity) {
      return false;
    }
    if (
      userEntity.ID === 'Administrator' ||
      userEntity.CODE === 'Administrator' ||
      userEntity.USERNAME === 'Administrator'
    ) {
      return true;
    }
    const roleIds = await userRoleService.getRoleIds(userEntity.ID);
    for (const roleId of roleIds) {
      if (roleId === DefaultRole.Administrators) {
        return true;
      }
      const role = await this.prisma.pirole.findUnique({ where: { ID: roleId } });
      if (role?.CODE === DefaultRole.Administrators) {
        return true;
      }
    }
    return false;
  }

  async isAdministratorByUserId(userId) {
    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    return this.isAdministrator(user);
  }

  async getPermissionDTByUserId(userId) {
    const isAdmin = await this.isAdministratorByUserId(userId);
    if (isAdmin) {
      return this.prisma.pipermission.findMany();
    }

    const userPermissions = await this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: 'PIUSER', RESOURCEID: userId, ENABLED: 1 }
    });

    const roleRelations = await this.prisma.piuserrole.findMany({
      where: { USERID: userId, ENABLED: 1 },
      select: { ROLEID: true }
    });
    const userRoleId = await this.prisma.piuser.findUnique({
      where: { ID: userId },
      select: { ROLEID: true }
    });

    const roleIds = [
      userRoleId?.ROLEID,
      ...roleRelations.map((relation) => relation.ROLEID)
    ].filter(Boolean);

    const rolePermissions = await this.prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: { in: roleIds },
        ENABLED: 1
      }
    });

    return [...userPermissions, ...rolePermissions];
  }

  async isModuleAuthorizedByUserId(userId, moduleCode) {
    const isAdmin = await this.isAdministratorByUserId(userId);
    if (isAdmin) {
      return true;
    }
    const modules = await moduleService.getDTByUser(userId);
    return modules.some((module) => module.CODE === moduleCode);
  }

  getPermissionScopeByUserId(userId, permissionItemCode) {
    return permissionScopeService.getUserPermissionScope(userId, permissionItemCode);
  }

  async checkUserOrganizePermission(userId, permissionItemId, organizeIds = []) {
    if (!organizeIds?.length) {
      return false;
    }
    const count = await this.prisma.pipermission.count({
      where: {
        RESOURCECATEGORY: 'PIORGANIZE',
        RESOURCEID: { in: organizeIds },
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });
    return count > 0;
  }

  async checkUserRolePermission(userId, permissionItemId) {
    const roleIds = await userRoleService.getRoleIds(userId);
    if (!roleIds?.length) {
      return false;
    }
    const count = await this.prisma.pipermission.count({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: { in: roleIds },
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });
    return count > 0;
  }

  checkUserPermission(userId, permissionItemId) {
    return this.checkResourcePermission('PIUSER', userId, permissionItemId);
  }

  async checkResourcePermission(resourceCategory, resourceId, permissionItemId) {
    const count = await this.prisma.pipermission.count({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        PERMISSIONID: permissionItemId,
        ENABLED: 1,
        DELETEMARK: 0
      }
    });
    return count > 0;
  }

  async checkPermissionByUser(userId, permissionItemCode, permissionItemName) {
    let permissionItem = await this.prisma.pipermissionitem.findFirst({
      where: { CODE: permissionItemCode }
    });

    if (!permissionItem) {
      const name = permissionItemName || permissionItemCode;
      permissionItem = await this.prisma.pipermissionitem.create({
        data: {
          ID: randomUUID(),
          CODE: permissionItemCode,
          FULLNAME: name,
          CATEGORYCODE: 'Application',
          PARENTID: null,
          MODULEID: null,
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
      return false;
    }

    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    if (!user) {
      return false;
    }
    if (await this.isAdministrator(user)) {
      return true;
    }
    if (await userRoleService.userInRole(userId, 'UserAdmin')) {
      return true;
    }
    if (permissionItem.CATEGORYCODE === 'Application' && (await userRoleService.userInRole(userId, 'Admin'))) {
      return true;
    }
    if (await this.checkUserPermission(userId, permissionItem.ID)) {
      return true;
    }
    if (await this.checkUserRolePermission(userId, permissionItem.ID)) {
      return true;
    }
    if (SystemInfo.EnableOrganizePermission) {
      const organizeIds = await userOrganizeService.getAllOrganizeIds(userId);
      if (await this.checkUserOrganizePermission(userId, permissionItem.ID, organizeIds)) {
        return true;
      }
    }
    return false;
  }
}

module.exports = {
  PermissionService,
  permissionService: new PermissionService()
};
