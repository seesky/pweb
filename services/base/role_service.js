'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const { UserService } = require('./user_service');
const { UserRoleService } = require('./user_role_service');
const { LogService } = require('./log_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const userService = new UserService(prisma);
const userRoleService = new UserRoleService(prisma);

class RoleService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async add(userInfo, entity) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_Add',
      FrameworkMessage.RoleService_Add || 'Add role',
      entity?.ID || ''
    );
    try {
      const record = await this.prisma.pirole.create({ data: entity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[RoleService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async update(userInfo, entity) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_Update',
      FrameworkMessage.RoleService_Update || 'Update role',
      entity?.ID || ''
    );
    if (!entity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.pirole.update({ where: { ID: entity.ID }, data: entity });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[RoleService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async getDT(userInfo) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_GetDT',
      FrameworkMessage.RoleService_GetDT || 'Get role list',
      ''
    );
    return this.prisma.pirole.findMany({ where: { DELETEMARK: 0 } });
  }

  async getList(userInfo) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_GetDT',
      FrameworkMessage.RoleService_GetDT || 'Get roles',
      ''
    );
    return this.prisma.pirole.findMany();
  }

  async getDTByPage(userInfo, pageSize = 20, whereConditional = '', order = '') {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_GetDTByPage',
      FrameworkMessage.RoleService_GetDTByPage || 'Get roles by page',
      ''
    );
    let sql = `SELECT * FROM ${this.tableName()} WHERE DELETEMARK = 0`;
    if (whereConditional) {
      sql = `SELECT * FROM ${this.tableName()} WHERE ${whereConditional} AND DELETEMARK = 0`;
    }
    if (order) {
      sql += ` ORDER BY ${order}`;
    }
    const rows = await db.executeQuery(sql);
    return rows;
  }

  async getEntity(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_GetDTByPage',
      FrameworkMessage.RoleService_GetDTByPage || 'Get role entity',
      id || ''
    );
    return this.prisma.pirole.findUnique({ where: { ID: id } });
  }

  async getDTByIds(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_GetDTByIds',
      FrameworkMessage.RoleService_GetDTByIds || 'Get role by ids',
      JSON.stringify(ids)
    );
    if (!ids.length) {
      return [];
    }
    return this.prisma.pirole.findMany({ where: { ID: { in: ids }, DELETEMARK: 0 } });
  }

  getDTByValues(valuesDic = {}) {
    return this.prisma.pirole.findMany({ where: valuesDic });
  }

  async getDTByOrganize(userInfo, organizeId, showUser = true) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_GetDTByOrganize',
      FrameworkMessage.RoleService_GetDTByOrganize || 'Get roles by org',
      organizeId || ''
    );
    const roles = await this.prisma.pirole.findMany({
      where: { ORGANIZEID: organizeId, DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
    if (!showUser || !roles.length) {
      return roles;
    }
    const users = await userService.getDT(null); // returns list of users
    const usersMap = new Map(users.map((user) => [user.ID, user.REALNAME]));

    for (const role of roles) {
      const userIds = await userService.getUserIdsInRole(null, role.ID);
      let userNames = '';
      if (userIds?.length) {
        userNames = userIds
          .map((userId) => usersMap.get(userId) || '')
          .filter(Boolean)
          .join(', ');
      }
      role.users = userNames;
    }
    return roles;
  }

  getApplicationRole() {
    return this.prisma.pirole.findMany({
      where: { DELETEMARK: 0, CATEGORY: 'ApplicationRole' }
    });
  }

  async batchSave(entities = []) {
    try {
      await this.prisma.$transaction(
        entities.map((entity) =>
          this.prisma.pirole.upsert({
            where: { ID: entity.ID || '' },
            create: entity,
            update: entity
          })
        )
      );
      return true;
    } catch (error) {
      console.error('[RoleService.batchSave]', error);
      return false;
    }
  }

  async delete(id) {
    let result = 0;
    result += (await this.prisma.piuserrole.deleteMany({ where: { ROLEID: id } })).count;
    result += (
      await this.prisma.pirole.deleteMany({
        where: { ID: id, ALLOWDELETE: 1 }
      })
    ).count;
    return result;
  }

  async batchDelete(ids = []) {
    let count = 0;
    for (const id of ids) {
      count += await this.delete(id);
    }
    return count;
  }

  async setDeleted(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'RoleService',
      FrameworkMessage.RoleService || 'RoleService',
      'RoleService_SetDeleted',
      FrameworkMessage.RoleService_SetDeleted || 'Set role deleted',
      JSON.stringify(ids)
    );
    if (!ids.length) {
      return 0;
    }
    const result = await this.prisma.pirole.updateMany({
      where: { ID: { in: ids } },
      data: { DELETEMARK: 1 }
    });
    return result.count;
  }

  eliminateRoleUser(roleId) {
    return userRoleService.eliminateRoleUser(roleId);
  }

  getRoleUserIds(roleId) {
    return userRoleService.getUserIds(roleId);
  }

  addUserToRole(userInfo, roleId, addUserIds = []) {
    return userRoleService.addToRolesU(userInfo, addUserIds, roleId);
  }

  removeUserFromRole(userInfo, userIds = [], roleId) {
    return userRoleService.removeFromRoleU(userInfo, userIds, roleId);
  }

  clearRoleUser(roleId) {
    return userRoleService.clearRoleUser(roleId);
  }

  setUsersToRole(roleId, userIds = []) {
    // Implementation depends on business rules; placeholder for parity.
    return userRoleService.addToRolesR(roleId, userIds);
  }

  resetSortCode(organizeId) {
    // Placeholder: implement if needed (sorting logic not detailed in reference).
    return null;
  }

  async moveTo(id, targetOrganizedId) {
    const role = await this.prisma.pirole.findUnique({ where: { ID: id } });
    if (!role) {
      return false;
    }
    try {
      await this.prisma.pirole.update({
        where: { ID: id },
        data: { ORGANIZEID: targetOrganizedId }
      });
      return true;
    } catch (error) {
      console.error('[RoleService.moveTo]', error);
      return false;
    }
  }

  tableName() {
    return 'pirole';
  }
}

module.exports = {
  RoleService,
  roleService: new RoleService()
};
