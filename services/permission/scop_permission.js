'use strict';

const { PrismaClient } = require('@prisma/client');

const SystemInfo = require('../../utilities/publiclibrary/system_info');
const PermissionScope = require('../../utilities/message/permission_scope');

const { UserRoleService } = require('../base/user_role_service');
const { PermissionScopeService } = require('../base/permission_scope_service');
const { ModulePermission } = require('./module_permission');
const { PermissionItemService } = require('../base/permission_item_service');
const { UserOrganizeService } = require('../base/user_organize_service');

const prisma = new PrismaClient();
const userRoleService = new UserRoleService(prisma);
const permissionScopeService = new PermissionScopeService(prisma);
const modulePermission = new ModulePermission(prisma);
const permissionItemService = new PermissionItemService(prisma);
const userOrganizeService = new UserOrganizeService(prisma);

const toUnique = (values = []) => [...new Set(values.filter(Boolean))];

class ScopPermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async getUserDTByPermissionScope(userId, permissionItemCode) {
    const isAdmin =
      (await userRoleService.userInRole(userId, 'UserAdmin')) ||
      (await userRoleService.userInRole(userId, 'Admin'));
    if (isAdmin) {
      return this.prisma.piuser.findMany({
        where: { ISVISIBLE: 1, DELETEMARK: 0, ENABLED: 1 }
      });
    }
    const userIds = await this.getUserIdsSql(userId, permissionItemCode);
    return this.prisma.piuser.findMany({
      where: { ISVISIBLE: 1, ENABLED: 1, ID: { in: userIds } },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  getUserIdsByPermissionScope(userId, permissionItemCode) {
    return this.getUserIds(userId, permissionItemCode);
  }

  async getRoleDTByPermissionScope(userInfo, permissionItemCode) {
    if (userInfo?.IsAdministrator || !permissionItemCode) {
      return this.prisma.pirole.findMany({ where: { DELETEMARK: 0 }, orderBy: { SORTCODE: 'asc' } });
    }
    return this.getRoleDT(userInfo.Id, permissionItemCode);
  }

  getRoleIdsByPermissionScope(userId, permissionItemCode) {
    return this.getRoleIds(userId, permissionItemCode);
  }

  getModuleDTByPermissionScope(userId, permissionItemCode) {
    return modulePermission.getDTByPermission(userId, permissionItemCode);
  }

  async getPermissionItemDTByPermissionScope(userId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({
      where: { CODE: permissionItemCode }
    });
    if (!permissionItem && permissionItemCode === 'Resource.ManagePermission') {
      await this.prisma.pipermissionitem.create({
        data: {
          ID: randomUUID(),
          CODE: 'Resource.ManagePermission',
          FULLNAME: '资源管理范围权限（系统默认）',
          ISSCOPE: 1,
          ENABLED: 1,
          ALLOWDELETE: 0,
          DELETEMARK: 0,
          CREATEON: new Date(),
          MODIFIEDON: new Date()
        }
      });
    }
    return permissionItemService.getDTByUser(userId, permissionItemCode);
  }

  async getOrganizeDTByPermissionScope(userInfo, userId, permissionItemCode) {
    if (!permissionItemCode) {
      return this.prisma.piorganize.findMany({ where: { DELETEMARK: 0 } });
    }
    const targetUserId = userId || userInfo?.Id;
    if (!targetUserId) {
      return [];
    }
    return permissionScopeService.getOrganizeDT(targetUserId, permissionItemCode);
  }

  getOrganizeIdsByPermissionScope(userId, permissionItemCode) {
    return permissionScopeService.getOrganizeIds(userId, permissionItemCode);
  }

  async getUserIdsSql(managerUserId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return [];
    }

    const directIds = await this.prisma.pipermissionscope.findMany({
      where: {
        TARGETCATEGORY: 'PIUSER',
        RESOURCEID: managerUserId,
        RESOURCECATEGORY: 'PIUSER',
        PERMISSIONID: permissionItem.ID,
        TARGETID: { not: null }
      },
      select: { TARGETID: true }
    });

    const organizeIds = await this.getOrganizeIds(managerUserId, permissionItemCode);
    let fromOrganize = [];
    if (organizeIds?.length) {
      fromOrganize = await this.prisma.piuser.findMany({
        where: {
          DELETEMARK: 0,
          OR: [
            { COMPANYID: { in: organizeIds } },
            { DEPARTMENTID: { in: organizeIds } },
            { WORKGROUPID: { in: organizeIds } }
          ]
        },
        select: { ID: true }
      });
    }

    const roleIds = await this.getRoleIds(managerUserId, permissionItemCode);
    let fromRoles = [];
    if (roleIds?.length) {
      fromRoles = await this.prisma.piuserrole.findMany({
        where: { ROLEID: { in: roleIds }, ENABLED: 1, DELETEMARK: 0 },
        select: { USERID: true }
      });
    }

    return toUnique([
      ...directIds.map((row) => row.TARGETID),
      ...fromOrganize.map((row) => row.ID),
      ...fromRoles.map((row) => row.USERID)
    ]);
  }

  async getOrganizeIds(managerUserId, permissionItemCode) {
    const ids = await this.getTreeResourceScopeIds(managerUserId, 'PIORGANIZE', permissionItemCode, false);
    if (!ids?.length) {
      return [];
    }
    const valid = await this.prisma.piorganize.findMany({
      where: { ID: { in: ids }, ENABLED: 1, DELETEMARK: 0 },
      select: { ID: true }
    });
    return valid.map((row) => row.ID);
  }

  async getTreeResourceScopeIds(userId, tableName, permissionItemCode, childrens) {
    const ids = await this.getResourceScopeIds(userId, tableName, permissionItemCode);
    if (!childrens || !ids.length) {
      return ids;
    }
    const idList = ids.join(',');
    const sql = `
      SELECT ID FROM (
        SELECT ID FROM ${tableName} WHERE ID IN (${idList})
        UNION ALL
        SELECT ResourceTree.ID AS ID
          FROM ${tableName} AS ResourceTree
          INNER JOIN pipermissionscope AS A ON A.ID = ResourceTree.ParentId
      ) AS PermissionScopeTree
    `;
    const rows = await db.executeQuery(sql);
    const childIds = rows.map((row) => row.id);
    return toUnique([...ids, ...childIds]);
  }

  async getResourceScopeIds(userId, targetCategory, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem?.ID) {
      return [];
    }
    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    if (!user) {
      return [];
    }

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

    const roleRelations = await this.prisma.piuserrole.findMany({
      where: { USERID: userId, ENABLED: 1, DELETEMARK: 0 },
      select: { ROLEID: true }
    });
    const roleIds = toUnique([user.ROLEID, ...roleRelations.map((row) => row.ROLEID)]);

    let q2 = [];
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

    let resourceIds = toUnique([...q1, ...q2].map((row) => row.TARGETID));

    if (SystemInfo.EnableOrganizePermission) {
      const orgIds = [user.COMPANYID, user.DEPARTMENTID, user.WORKGROUPID].filter(Boolean);
      if (orgIds.length) {
        const q3 = await this.prisma.pipermissionscope.findMany({
          where: {
            RESOURCECATEGORY: 'PIORGANIZE',
            RESOURCEID: { in: orgIds },
            TARGETCATEGORY: targetCategory,
            PERMISSIONID: permissionItem.ID,
            ENABLED: 1,
            DELETEMARK: 0
          },
          select: { TARGETID: true }
        });
        resourceIds = toUnique([...resourceIds, ...q3.map((row) => row.TARGETID)]);
      }
    }

    if (targetCategory === 'PIORGANIZE') {
      const [, permissionScope] = await permissionScopeService.transformPermissionScope(userId, resourceIds);
      if (permissionScope === PermissionScope.All) {
        const organizations = await this.prisma.piorganize.findMany({
          where: { ENABLED: 1, DELETEMARK: 0 },
          select: { ID: true }
        });
        return organizations.map((item) => item.ID);
      }
      if (permissionScope === PermissionScope.User) {
        return [userId];
      }
      if (permissionScope === PermissionScope.UserCompany) {
        return [user.COMPANYID].filter(Boolean);
      }
      if (permissionScope === PermissionScope.UserDepartment) {
        return [user.DEPARTMENTID].filter(Boolean);
      }
      if (permissionScope === PermissionScope.UserWorkgroup) {
        return [user.WORKGROUPID].filter(Boolean);
      }
      resourceIds = resourceIds.filter((id) => !Object.values(PermissionScope).includes(id));
    }

    return resourceIds;
  }
}

module.exports = {
  ScopPermission,
  scopPermission: new ScopPermission()
};
