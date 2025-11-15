'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const SystemInfo = require('../../utilities/publiclibrary/system_info');
const PermissionScope = require('../../utilities/message/permission_scope');
const { PermissionItemService } = require('./permission_item_service');

const prisma = new PrismaClient();
const permissionItemService = new PermissionItemService(prisma);

const dedupe = (list = []) => [...new Set(list.filter(Boolean))];
const hierarchyMetadata = {
  pipermissionitem: { parentField: 'PARENTID', idField: 'ID', deleteField: 'DELETEMARK' },
  piorganize: { parentField: 'PARENTID', idField: 'ID', deleteField: 'DELETEMARK' }
};

class PermissionScopeService {
  constructor(client = prisma) {
    this.prisma = client;
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
    const permissionItem = await this.prisma.pipermissionitem.findFirst({
      where: { CODE: permissionItemCode }
    });
    if (!permissionItem) {
      return [];
    }

    const user = await this.prisma.piuser.findUnique({ where: { ID: userId } });
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
    const relationRoleIds = roleRelations.map((item) => item.ROLEID).filter(Boolean);
    if (user?.ROLEID) {
      relationRoleIds.push(user.ROLEID);
    }
    const roleIds = dedupe(relationRoleIds);

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

    let ids = dedupe([...q1, ...q2].map((item) => item.TARGETID));

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
        ids = dedupe([...ids, ...q3.map((item) => item.TARGETID)]);
      }
    }

    if (targetCategory.toUpperCase() === 'PIORGANIZE') {
      await this.transformPermissionScope(userId, ids);
    }

    return ids;
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

    resourceIds.forEach((r) => {
      if (r === PermissionScope.All) {
        permissionScope = PermissionScope.All;
      } else if (r === PermissionScope.UserCompany) {
        permissionScope = PermissionScope.UserCompany;
      } else if (r === PermissionScope.UserDepartment) {
        permissionScope = PermissionScope.UserDepartment;
      } else if (r === PermissionScope.UserWorkgroup) {
        permissionScope = PermissionScope.UserWorkgroup;
      }
    });

    return [resourceIds, permissionScope];
  }

  async getUserPermissionScope(managerUserId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return PermissionScope.No;
    }
    const roleIds = await this.prisma.piuserrole.findMany({
      where: { USERID: managerUserId, DELETEMARK: 0, ENABLED: 1 },
      select: { ROLEID: true }
    });
    const organizeIds = await this.prisma.pipermissionscope.findMany({
      where: {
        TARGETCATEGORY: 'PIORGANIZE',
        DELETEMARK: 0,
        ENABLED: 1,
        TARGETID: { not: null },
        PERMISSIONID: permissionItem.ID,
        OR: [
          { RESOURCECATEGORY: 'PIUSER', RESOURCEID: managerUserId },
          {
            RESOURCECATEGORY: 'PIROLE',
            RESOURCEID: { in: roleIds.map((r) => r.ROLEID).filter(Boolean) }
          }
        ]
      },
      select: { TARGETID: true }
    });

    const ids = organizeIds.map((r) => r.TARGETID);
    const matches = Object.values(PermissionScope).filter((value) => ids.includes(value));
    return matches.length ? matches[0] : PermissionScope.No;
  }

  async getOrganizeDT(managerUserId, permissionItemCode) {
    const ids = await this.getTreeResourceScopeIds(managerUserId, 'PIORGANIZE', permissionItemCode, false);
    if (!ids?.length) {
      return [];
    }
    return this.prisma.piorganize.findMany({
      where: { ID: { in: ids }, ENABLED: 1, DELETEMARK: 0 }
    });
  }

  async getOrganizeIds(managerUserId, permissionItemCode) {
    const ids = await this.getTreeResourceScopeIds(managerUserId, 'PIORGANIZE', permissionItemCode, false);
    if (!ids?.length) {
      return [];
    }
    return this.prisma.piorganize
      .findMany({ where: { ID: { in: ids }, ENABLED: 1, DELETEMARK: 0 }, select: { ID: true } })
      .then((rows) => rows.map((r) => r.ID));
  }

  async getOrganizeIdsSql(managerUserId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }

    const roleIds = await this.prisma.piuserrole.findMany({
      where: { USERID: managerUserId, ENABLED: 1, DELETEMARK: 0 },
      select: { ROLEID: true }
    });

    const scopes = await this.prisma.pipermissionscope.findMany({
      where: {
        TARGETCATEGORY: 'PIORGANIZE',
        TARGETID: { not: null },
        PERMISSIONID: permissionItem.ID,
        ENABLED: 1,
        DELETEMARK: 0,
        OR: [
          { RESOURCECATEGORY: 'PIUSER', RESOURCEID: managerUserId },
          {
            RESOURCECATEGORY: 'PIROLE',
            RESOURCEID: { in: roleIds.map((r) => r.ROLEID).filter(Boolean) }
          }
        ]
      },
      select: { TARGETID: true }
    });

    return dedupe(scopes.map((row) => row.TARGETID));
  }

  async getUserIds(managerUserId, permissionItemCode) {
    const ids = await this.getTreeResourceScopeIds(managerUserId, 'PIORGANIZE', permissionItemCode, true);
    if (ids?.includes(PermissionScope.User)) {
      return [managerUserId];
    }

    const sqlIds = await this.getUserIdsSql(managerUserId, permissionItemCode);
    const unique = dedupe([...(ids || []), ...sqlIds]);

    if (!unique.length) {
      return [];
    }

    return this.prisma.piuser
      .findMany({ where: { ID: { in: unique }, ENABLED: 1, DELETEMARK: 0 }, select: { ID: true } })
      .then((rows) => rows.map((r) => r.ID));
  }

  async getUserIdsSql(managerUserId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }

    const direct = await this.prisma.pipermissionscope.findMany({
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
    if (organizeIds.length) {
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
    if (roleIds.length) {
      fromRoles = await this.prisma.piuserrole.findMany({
        where: { ROLEID: { in: roleIds }, ENABLED: 1, DELETEMARK: 0 },
        select: { USERID: true }
      });
    }

    const ids = [
      ...direct.map((row) => row.TARGETID),
      ...fromOrganize.map((row) => row.ID),
      ...fromRoles.map((row) => row.USERID)
    ];
    return dedupe(ids);
  }

  async getRoleIdsSql(managerUserId, permissionItemCode) {
    const permissionItem = await this.prisma.pipermissionitem.findFirst({ where: { CODE: permissionItemCode } });
    if (!permissionItem) {
      return [];
    }

    const roleIds = await this.prisma.piuserrole.findMany({
      where: { USERID: managerUserId, ENABLED: 1 },
      select: { ROLEID: true }
    });

    const direct = await this.prisma.pipermissionscope.findMany({
      where: {
        TARGETID: { not: null },
        TARGETCATEGORY: 'PIROLE',
        PERMISSIONID: permissionItem.ID,
        OR: [
          { RESOURCECATEGORY: 'PIUSER', RESOURCEID: managerUserId },
          {
            RESOURCECATEGORY: 'PIROLE',
            RESOURCEID: { in: roleIds.map((r) => r.ROLEID).filter(Boolean) }
          }
        ]
      },
      select: { TARGETID: true }
    });

    const organizeIds = await this.getOrganizeIds(managerUserId, permissionItemCode);
    let fromOrganize = [];
    if (organizeIds.length) {
      fromOrganize = await this.prisma.pirole.findMany({
        where: { ORGANIZEID: { in: organizeIds }, ENABLED: 1, DELETEMARK: 0 },
        select: { ID: true }
      });
    }

    return dedupe([...direct.map((row) => row.TARGETID), ...fromOrganize.map((row) => row.ID)]);
  }

  async getRoleIds(managerUserId, permissionItemCode) {
    const ids = await this.getRoleIdsSql(managerUserId, permissionItemCode);
    if (!ids.length) {
      return [];
    }
    return this.prisma.pirole
      .findMany({ where: { ID: { in: ids }, ENABLED: 1, DELETEMARK: 0 }, select: { ID: true } })
      .then((rows) => rows.map((r) => r.ID));
  }

  async getDT(valuesDic = {}) {
    return this.prisma.pipermissionitem.findMany({
      where: valuesDic
    });
  }

  async getIdByAdd(resourceCategory, resourceId, tableName, permissionCode, constraint, enabled = true) {
    const permissionId = await permissionItemService.getIdByAdd(permissionCode);
    const existing = await this.prisma.pipermissionscope.findFirst({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        TARGETCATEGORY: 'Table',
        TARGETID: tableName,
        PERMISSIONID: permissionId,
        PERMISSIONCONSTRAINT: constraint,
        DELETEMARK: 0
      }
    });

    if (existing) {
      await this.prisma.pipermissionscope.update({
        where: { ID: existing.ID },
        data: {
          PERMISSIONCONSTRAINT: constraint,
          ENABLED: enabled ? 1 : 0,
          DELETEMARK: 0
        }
      });
    } else {
      await this.prisma.pipermissionscope.create({
        data: {
          ID: randomUUID(),
          RESOURCECATEGORY: resourceCategory,
          RESOURCEID: resourceId,
          TARGETCATEGORY: 'Table',
          TARGETID: tableName,
          PERMISSIONCONSTRAINT: constraint,
          PERMISSIONID: permissionId,
          DELETEMARK: 0,
          ENABLED: enabled ? 1 : 0
        }
      });
    }
    const scope = await this.prisma.pipermissionscope.findFirst({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        TARGETCATEGORY: 'Table',
        TARGETID: tableName,
        PERMISSIONID: permissionId,
        PERMISSIONCONSTRAINT: constraint,
        DELETEMARK: 0
      },
      select: { ID: true }
    });
    return scope?.ID || null;
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
}

module.exports = {
  PermissionScopeService,
  permissionScopeService: new PermissionScopeService()
};
