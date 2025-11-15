'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const DefaultRole = require('../../utilities/message/default_role');

const prisma = new PrismaClient();

const toUnique = (list = []) => [...new Set(list.filter(Boolean))];

class UserRoleService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async getDTByRole(roleId) {
    if (!roleId) {
      return [];
    }
    const directUserIds = await this.prisma.piuser.findMany({
      where: { ROLEID: roleId, ENABLED: 1, DELETEMARK: 0 },
      select: { ID: true }
    });

    const relationUserIds = await this.prisma.piuserrole.findMany({
      where: { ROLEID: roleId, ENABLED: 1, DELETEMARK: 0 },
      select: { USERID: true }
    });

    const userIds = toUnique([
      ...directUserIds.map((row) => row.ID),
      ...relationUserIds.map((row) => row.USERID)
    ]);

    if (!userIds.length) {
      return [];
    }

    return this.prisma.piuser.findMany({
      where: { ID: { in: userIds }, ENABLED: 1, DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async getListByRole(roleIds = []) {
    if (!roleIds?.length) {
      return [];
    }

    const directUsers = await this.prisma.piuser.findMany({
      where: { ROLEID: { in: roleIds }, ENABLED: 1, DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });

    const relationIds = await this.prisma.piuserrole.findMany({
      where: { ROLEID: { in: roleIds }, ENABLED: 1, DELETEMARK: 0 },
      select: { USERID: true }
    });

    if (!relationIds.length) {
      return directUsers;
    }

    const relationUsers = await this.prisma.piuser.findMany({
      where: {
        ENABLED: 1,
        DELETEMARK: 0,
        ID: { in: relationIds.map((row) => row.USERID) }
      },
      orderBy: { SORTCODE: 'asc' }
    });

    const seen = new Set(directUsers.map((user) => user.ID));
    relationUsers.forEach((user) => {
      if (!seen.has(user.ID)) {
        directUsers.push(user);
      }
    });

    return directUsers;
  }

  getRoleDT(userInfo) {
    const filter = {
      where: { DELETEMARK: 0, ENABLED: 1 },
      orderBy: { SORTCODE: 'asc' }
    };
    if (userInfo?.IsAdministrator !== true) {
      filter.where.CODE = { not: DefaultRole.Administrators };
    }
    return this.prisma.pirole.findMany(filter);
  }

  async userInRole(userId, roleCode) {
    if (!userId || !roleCode) {
      return false;
    }
    const role = await this.prisma.pirole.findFirst({
      where: { CODE: roleCode, DELETEMARK: 0 },
      select: { ID: true }
    });
    if (!role?.ID) {
      return false;
    }
    const roleIds = await this.getAllRoleIds(userId);
    return roleIds.includes(role.ID);
  }

  setDefaultRole(userId, roleId) {
    if (!userId) {
      return 0;
    }
    return this.prisma.piuser.updateMany({ where: { ID: userId }, data: { ROLEID: roleId } });
  }

  batchSetDefaultRole(userIds = [], roleId) {
    if (!userIds.length) {
      return 0;
    }
    return this.prisma.piuser.updateMany({
      where: { ID: { in: userIds } },
      data: { ROLEID: roleId }
    });
  }

  async getUserRoleIds(userId) {
    if (!userId) {
      return [];
    }
    const rows = await this.prisma.piuserrole.findMany({
      where: { USERID: userId, ENABLED: 1, DELETEMARK: 0 },
      select: { ROLEID: true }
    });
    return rows.map((row) => row.ROLEID);
  }

  async getAllUserRoleIds(userId) {
    if (!userId) {
      return [];
    }
    const rows = await this.prisma.piuserrole.findMany({
      where: { USERID: userId },
      select: { ID: true }
    });
    return rows.map((row) => row.ID);
  }

  async addUserToRole(userInfo, userId, roleId) {
    if (!userId || !roleId) {
      return false;
    }
    const exists = await this.prisma.piuserrole.findFirst({
      where: { USERID: userId, ROLEID: roleId, ENABLED: 1, DELETEMARK: 0 }
    });
    if (exists) {
      return false;
    }
    const now = new Date();
    await this.prisma.piuserrole.create({
      data: {
        ID: randomUUID(),
        USERID: userId,
        ROLEID: roleId,
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
    return true;
  }

  removeUserFromRole(userId, roleId) {
    if (!userId || !roleId) {
      return 0;
    }
    return this.prisma.piuserrole.deleteMany({ where: { USERID: userId, ROLEID: roleId } });
  }

  clearUserRole(userId) {
    if (!userId) {
      return 0;
    }
    return this.prisma.piuserrole.deleteMany({ where: { USERID: userId } });
  }

  async getAllRoleIds(userId) {
    if (!userId) {
      return [];
    }
    const primaryRole = await this.prisma.piuser.findFirst({
      where: { ID: userId, DELETEMARK: 0, ENABLED: 1 },
      select: { ROLEID: true }
    });

    const validRoleIds = await this.prisma.pirole
      .findMany({ where: { DELETEMARK: 0 }, select: { ID: true } })
      .then((rows) => rows.map((row) => row.ID));

    const relationRoles = await this.prisma.piuserrole.findMany({
      where: {
        USERID: userId,
        DELETEMARK: 0,
        ROLEID: { in: validRoleIds }
      },
      select: { ROLEID: true }
    });

    return toUnique([
      primaryRole?.ROLEID,
      ...relationRoles.map((row) => row.ROLEID)
    ]);
  }

  async eliminateRoleUser(roleId) {
    if (!roleId) {
      return 0;
    }
    const reset = await this.prisma.piuser.updateMany({
      where: { ROLEID: roleId },
      data: { ROLEID: null }
    });
    const removed = await this.prisma.piuserrole.deleteMany({ where: { ROLEID: roleId } });
    return reset.count + removed.count;
  }

  async getUserIds(roleId) {
    if (!roleId) {
      return [];
    }
    const q1 = await this.prisma.piuser.findMany({
      where: { ROLEID: roleId, DELETEMARK: 0, ENABLED: 1 },
      select: { ID: true }
    });
    const validUsers = await this.prisma.piuser
      .findMany({ where: { DELETEMARK: 0 }, select: { ID: true } })
      .then((rows) => rows.map((row) => row.ID));

    const q2 = await this.prisma.piuserrole.findMany({
      where: {
        ROLEID: roleId,
        DELETEMARK: 0,
        USERID: { in: validUsers }
      },
      select: { USERID: true }
    });
    return toUnique([...q1.map((row) => row.ID), ...q2.map((row) => row.USERID)]);
  }

  async addToRole(userInfo, userId, roleId) {
    if (!userId || !roleId) {
      return 0;
    }
    const exists = await this.prisma.piuserrole.findFirst({
      where: { USERID: userId, ROLEID: roleId, ENABLED: 1, DELETEMARK: 0 }
    });
    if (exists) {
      return 1;
    }
    const now = new Date();
    await this.prisma.piuserrole.create({
      data: {
        ID: randomUUID(),
        USERID: userId,
        ROLEID: roleId,
        ALLOWEDIT: 1,
        ALLOWDELETE: 1,
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
    return 1;
  }

  async addToRolesR(userId, roleIds = []) {
    let count = 0;
    for (const roleId of roleIds) {
      count += await this.addToRole(null, userId, roleId);
    }
    return count;
  }

  async addToRolesU(userInfo, userIds = [], roleId) {
    let count = 0;
    for (const userId of userIds) {
      count += await this.addToRole(userInfo, userId, roleId);
    }
    return count;
  }

  removeFormRole(userInfo, userId, roleId) {
    return this.removeUserFromRole(userId, roleId);
  }

  async removeFromRoleR(userId, roleIds = []) {
    let count = 0;
    for (const roleId of roleIds) {
      const result = await this.removeUserFromRole(userId, roleId);
      count += result.count ?? 0;
    }
    return count;
  }

  async removeFromRoleU(userInfo, userIds = [], roleId) {
    let count = 0;
    for (const userId of userIds) {
      const result = await this.removeUserFromRole(userId, roleId);
      count += result.count ?? 0;
    }
    return count;
  }

  async clearRoleUser(roleId) {
    const reset = await this.prisma.piuser.updateMany({
      where: { ROLEID: roleId },
      data: { ROLEID: null }
    });
    const removed = await this.prisma.piuserrole.deleteMany({ where: { ROLEID: roleId } });
    return reset.count + removed.count;
  }

  async getRoleIds(userId) {
    if (!userId) {
      return [];
    }
    const validRoleIds = await this.prisma.pirole
      .findMany({ where: { DELETEMARK: 0 }, select: { ID: true } })
      .then((rows) => rows.map((row) => row.ID));

    const rows = await this.prisma.piuserrole.findMany({
      where: {
        USERID: userId,
        DELETEMARK: 0,
        ROLEID: { in: validRoleIds }
      },
      select: { ROLEID: true }
    });
    return rows.map((row) => row.ROLEID);
  }
}

module.exports = {
  UserRoleService,
  userRoleService: new UserRoleService()
};
