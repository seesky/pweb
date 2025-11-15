'use strict';

const { PrismaClient } = require('@prisma/client');

const SystemInfo = require('../../utilities/publiclibrary/system_info');
const PermissionScope = require('../../utilities/message/permission_scope');
const StringHelper = require('../../utilities/publiclibrary/string_helper');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();

class ResourcePermission {
  constructor(client = prisma) {
    this.prisma = client;
  }

  getResourcePermissionItemIds(resourceCategory, resourceId) {
    return this.prisma.pipermission.findMany({
      where: { RESOURCECATEGORY: resourceCategory, RESOURCEID: resourceId }
    });
  }

  async grantResourcePermission(resourceCategory, resourceId, grantPermissionItemIds = []) {
    let count = 0;
    for (const permissionId of grantPermissionItemIds) {
      await this.prisma.pipermission.create({
        data: {
          RESOURCECATEGORY: resourceCategory,
          RESOURCEID: resourceId,
          PERMISSIONID: permissionId,
          ENABLED: 1,
          DELETEMARK: 0
        }
      });
      count += 1;
    }
    return count;
  }

  revokeResourcePermission(resourceCategory, resourceId, revokePermissionItemIds = []) {
    return this.prisma.pipermission.deleteMany({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        PERMISSIONID: { in: revokePermissionItemIds }
      }
    });
  }

  async getPermissionScopeTargetIds(resourceCategory, resourceId, targetCategory, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }
    const scopes = await this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        PERMISSIONID: permissionItem.ID,
        TARGETCATEGORY: targetCategory,
        DELETEMARK: 0,
        ENABLED: 1
      },
      select: { TARGETID: true }
    });
    return scopes.map((row) => row.TARGETID);
  }

  async getPermissionScopeResourceIds(resourceCategory, targetId, targetResourceCategory, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }
    const scopes = await this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: resourceCategory,
        TARGETID: targetId,
        PERMISSIONID: permissionItem.ID,
        TARGETCATEGORY: targetResourceCategory,
        DELETEMARK: 0,
        ENABLED: 1
      },
      select: { RESOURCEID: true }
    });
    return scopes.map((row) => row.RESOURCEID);
  }

  async grantPermissionScopeTargets(resourceCategory, resourceId, targetCategory, grantTargetIds = [], permissionItemId) {
    let count = 0;
    for (const targetId of grantTargetIds) {
      const exists = await this.prisma.pipermissionscope.findFirst({
        where: {
          RESOURCECATEGORY: resourceCategory,
          RESOURCEID: resourceId,
          TARGETCATEGORY: targetCategory,
          TARGETID: targetId,
          PERMISSIONID: permissionItemId,
          ENABLED: 1,
          DELETEMARK: 0
        }
      });
      if (!exists) {
        await this.prisma.pipermissionscope.create({
          data: {
            RESOURCECATEGORY: resourceCategory,
            RESOURCEID: resourceId,
            TARGETCATEGORY: targetCategory,
            PERMISSIONID: permissionItemId,
            TARGETID: targetId,
            ENABLED: 1,
            DELETEMARK: 0
          }
        });
        count += 1;
      }
    }
    return count;
  }

  grantPermissionScopeTarget(resourceCategory, resourceId, targetCategory, grantTargetId, permissionItemId) {
    return this.grantPermissionScopeTargets(resourceCategory, resourceId, targetCategory, [grantTargetId], permissionItemId);
  }

  revokePermissionScopeTargets(resourceCategory, resourceId, targetCategory, revokeTargetIds = [], permissionItemId) {
    return this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        TARGETCATEGORY: targetCategory,
        TARGETID: { in: revokeTargetIds },
        PERMISSIONID: permissionItemId
      }
    });
  }

  revokePermissionScopeTarget(resourceCategory, resourceId, targetCategory, revokeTargetId, permissionItemId) {
    return this.revokePermissionScopeTargets(resourceCategory, resourceId, targetCategory, [revokeTargetId], permissionItemId);
  }

  clearPermissionScopeTarget(resourceCategory, resourceId, targetCategory, permissionItemId) {
    return this.prisma.pipermissionscope.deleteMany({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        TARGETCATEGORY: targetCategory,
        PERMISSIONID: permissionItemId,
        ENABLED: 1
      }
    });
  }

  async getResourceScopeIds(userId, targetCategory, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }

    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    const defaultRoleId = user?.ROLEID || null;

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

    let q2 = [];
    const roleIds = await this.prisma.piuserrole.findMany({
      where: { USERID: userId, ENABLED: 1, DELETEMARK: 0 },
      select: { ROLEID: true }
    });
    const combinedRoleIds = roleIds.map((r) => r.ROLEID);
    if (defaultRoleId && !combinedRoleIds.includes(defaultRoleId)) {
      combinedRoleIds.push(defaultRoleId);
    }

    if (combinedRoleIds.length) {
      q2 = await this.prisma.pipermissionscope.findMany({
        where: {
          RESOURCECATEGORY: 'PIROLE',
          TARGETCATEGORY: targetCategory,
          PERMISSIONID: permissionItem.ID,
          DELETEMARK: 0,
          ENABLED: 1,
          RESOURCEID: { in: combinedRoleIds }
        },
        select: { TARGETID: true }
      });
    }

    let resourceIds = [...new Set([...q1, ...q2].map((row) => row.TARGETID))];

    if (SystemInfo.EnableOrganizePermission && user) {
      const organizeIds = [user.COMPANYID, user.DEPARTMENTID, user.WORKGROUPID].filter(Boolean);
      if (organizeIds.length) {
        const q3 = await this.prisma.pipermissionscope.findMany({
          where: {
            RESOURCECATEGORY: 'PIORGANIZE',
            RESOURCEID: { in: organizeIds },
            TARGETCATEGORY: targetCategory,
            PERMISSIONID: permissionItem.ID,
            ENABLED: 1,
            DELETEMARK: 0
          },
          select: { TARGETID: true }
        });
        resourceIds = [...new Set([...resourceIds, ...q3.map((row) => row.TARGETID)])];
      }
    }

    if (targetCategory === 'PIORGANIZE') {
      const [, transformed] = await this.transformPermissionScope(userId, resourceIds);
      return transformed;
    }

    return resourceIds;
  }

  async transformPermissionScope(userId, resourceIds = []) {
    let permissionScope = PermissionScope.No;
    if (!resourceIds.length) {
      return [permissionScope, resourceIds];
    }

    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
    if (!user) {
      return [permissionScope, resourceIds];
    }

    const mapped = resourceIds.map((id) => {
      if (id === PermissionScope.All) {
        permissionScope = PermissionScope.All;
        return user.ID;
      }
      if (id === PermissionScope.UserCompany) {
        permissionScope = PermissionScope.UserCompany;
        return user.COMPANYID;
      }
      if (id === PermissionScope.UserDepartment) {
        permissionScope = PermissionScope.UserDepartment;
        return user.DEPARTMENTID;
      }
      if (id === PermissionScope.UserWorkgroup) {
        permissionScope = PermissionScope.UserWorkgroup;
        return user.WORKGROUPID;
      }
      return id;
    });

    return [permissionScope, mapped];
  }

  async getTreeResourceScopeIds(userId, targetCategory, permissionItemCode, childrens) {
    const resourceScopeIds = await this.getResourceScopeIds(userId, targetCategory, permissionItemCode);
    if (!childrens || !resourceScopeIds.length) {
      return resourceScopeIds;
    }

    const idList = StringHelper.objectsToList(resourceScopeIds);
    if (!idList) {
      return resourceScopeIds;
    }

    const sql = `SELECT ID FROM (
      SELECT ID FROM ${targetCategory} WHERE ID IN (${idList})
      UNION ALL
      SELECT ResourceTree.ID AS ID
        FROM ${targetCategory} AS ResourceTree
        INNER JOIN pipermissionscope AS A ON A.ID = ResourceTree.PARENTID
    ) AS PermissionScopeTree`;

    const rows = await db.executeQuery(sql);
    const extraIds = rows.map((row) => row.ID);
    return [...new Set([...resourceScopeIds, ...extraIds])];
  }
}

module.exports = {
  ResourcePermission,
  resourcePermission: new ResourcePermission()
};
