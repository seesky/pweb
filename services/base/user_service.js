'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const AuditStatus = require('../../utilities/message/audit_status');
const StringHelper = require('../../utilities/publiclibrary/string_helper');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const SystemInfo = require('../../utilities/publiclibrary/system_info');
const PermissionScope = require('../../utilities/message/permission_scope');

const { OrganizeService } = require('./organize_service');
const { UserPermission } = require('../permission/user_permission');
const { PermissionItemService } = require('./permission_item_service');
const { PermissionScopeService } = require('./permission_scope_service');
const { ModuleService } = require('./module_service');
const { LogService } = require('./log_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const organizeService = new OrganizeService(prisma);
const userPermission = new UserPermission(prisma);
const permissionItemService = new PermissionItemService(prisma);
const permissionScopeService = new PermissionScopeService(prisma);
const moduleService = new ModuleService(prisma);

class UserService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  table(name) {
    return name;
  }

  async exists(fieldName, fieldValue) {
    const user = await this.prisma.piuser.findFirst({
      where: { [fieldName]: fieldValue },
      select: { ID: true }
    });
    return Boolean(user);
  }

  async addUser(userInfo, userEntity) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_AddUser',
      FrameworkMessage.UserService_AddUser || 'Add user',
      userEntity?.ID || ''
    );
    try {
      const record = await this.prisma.piuser.create({ data: userEntity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[UserService.addUser]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async getEntity(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetEntity',
      FrameworkMessage.UserService_GetEntity || 'Get user entity',
      id || ''
    );
    return this.prisma.piuser.findUnique({ where: { ID: id } });
  }

  async getEntityByUserName(userInfo, userName) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetEntityByUserName',
      FrameworkMessage.UserService_GetEntityByUserName || 'Get user by username',
      userName || ''
    );
    return this.prisma.piuser.findFirst({ where: { USERNAME: userName } });
  }

  async getDT(userInfo) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetDT',
      FrameworkMessage.UserService_GetDT || 'Get user list',
      ''
    );
    return this.prisma.piuser.findMany({ where: { DELETEMARK: 0 }, orderBy: { SORTCODE: 'asc' } });
  }

  async getDTByPage(userInfo, searchValue, departmentId, roleId, pageSize = 50, order) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetDTByPage',
      FrameworkMessage.UserService_GetDTByPage || 'Get users by page',
      ''
    );

    let whereConditional = 'piuser.deletemark = 0 AND piuser.enabled = 1 AND piuser.isvisible = 1';

    if (departmentId) {
      const organizeIds = await organizeService.getChildrensById(departmentId);
      if (organizeIds?.length) {
        const list = StringHelper.arrayToList(organizeIds, '\'');
        whereConditional += ` AND (
          piuser.companyid IN (${list}) OR
          piuser.subcompanyid IN (${list}) OR
          piuser.departmentid IN (${list}) OR
          piuser.subdepartmentid IN (${list}) OR
          piuser.workgroupid IN (${list})
        )`;
      }
    }

    if (roleId) {
      whereConditional += ` AND piuser.id IN (
        SELECT userid FROM piuserrole
        WHERE roleid = '${roleId}' AND enabled = 1 AND deletemark = 0
      )`;
    }

    if (searchValue) {
      whereConditional += ` AND (${searchValue})`;
    }

    const orderClause = order ? ` ORDER BY ${order}` : ' ORDER BY piuser.sortcode';
    const sql = `SELECT piuser.*, piuserlogon.FIRSTVISIT, piuserlogon.PREVIOUSVISIT, piuserlogon.LASTVISIT,
                        piuserlogon.IPADDRESS, piuserlogon.MACADDRESS, piuserlogon.LOGONCOUNT, piuserlogon.USERONLINE
                   FROM piuser
                   LEFT OUTER JOIN piuserlogon ON piuser.id = piuserlogon.id
                  WHERE ${whereConditional}${orderClause}`;

    const rows = await db.executeQuery(sql);
    const page = Math.ceil(rows.length / pageSize);
    return { count: rows.length, data: rows.slice(0, pageSize), pages: page };
  }

  async getList(userInfo) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetList',
      FrameworkMessage.UserService_GetList || 'Get user list',
      ''
    );
    return this.prisma.piuser.findMany();
  }

  async getDTByIds(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetDTByIds',
      FrameworkMessage.UserService_GetDTByIds || 'Get users by ids',
      JSON.stringify(ids)
    );
    return this.prisma.piuser.findMany({ where: { ID: { in: ids } } });
  }

  getListByIds(userInfo, ids = []) {
    return this.getDTByIds(userInfo, ids);
  }

  async updateUser(userInfo, userEntity) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_UpdateUser',
      FrameworkMessage.UserService_UpdateUser || 'Update user',
      userEntity?.ID || ''
    );
    try {
      await this.prisma.piuser.update({
        where: { ID: userEntity.ID },
        data: userEntity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[UserService.updateUser]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async searchs(userInfo, permissionScopeCode, search, roleIds, enabled, auditStates, departmentId) {
    const whereConditional = await this.getSearchConditional(
      userInfo,
      permissionScopeCode,
      search,
      roleIds,
      enabled,
      auditStates,
      departmentId
    );

    const sql =
      `SELECT piuser.*, piuserlogon.FIRSTVISIT, piuserlogon.PREVIOUSVISIT, piuserlogon.LASTVISIT, ` +
      `piuserlogon.IPADDRESS, piuserlogon.MACADDRESS, piuserlogon.LOGONCOUNT, piuserlogon.USERONLINE, ` +
      `piuserlogon.CHECKIPADDRESS, piuserlogon.MULTIUSERLOGIN ` +
      `FROM piuser LEFT OUTER JOIN piuserlogon ON piuser.id = piuserlogon.id ` +
      `WHERE ${whereConditional} ORDER BY piuser.SORTCODE`;

    return db.executeQuery(sql);
  }

  async search(userInfo, searchValue, auditStatus, roleIds) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_Search',
      FrameworkMessage.UserService_Search || 'Search user',
      ''
    );
    return this.searchs(userInfo, null, searchValue, roleIds, null, auditStatus, null);
  }

  async getSearchConditional(userInfo, permissionScopeCode, search, roleIds, enabled, auditStates, departmentId) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetSearchConditional',
      FrameworkMessage.UserService_GetSearchConditional || 'Get search conditional',
      ''
    );

    const table = this.table('piuser');
    let whereConditional = `${table}.deletemark = 0 AND ${table}.isvisible = 1`;

    if (enabled !== undefined && enabled !== null) {
      whereConditional += ` AND (${table}.enabled = ${enabled ? 1 : 0})`;
    }

    const searchString = StringHelper.getSearchString(search);
    if (searchString) {
      whereConditional +=
        ` AND (` +
        `${table}.username LIKE '${searchString}' OR ` +
        `${table}.code LIKE '${searchString}' OR ` +
        `${table}.realname LIKE '${searchString}' OR ` +
        `${table}.quickquery LIKE '${searchString}' OR ` +
        `${table}.departmentname LIKE '${searchString}' OR ` +
        `${table}.description LIKE '${searchString}')`;
    }

    if (departmentId) {
      const organizeIds = await organizeService.getChildrensById(departmentId);
      if (organizeIds && organizeIds.length > 0) {
        const list = StringHelper.arrayToList(organizeIds, '\'');
        whereConditional +=
          ` AND (` +
          `${table}.companyid IN (${list}) OR ` +
          `${table}.subcompanyid IN (${list}) OR ` +
          `${table}.departmentid IN (${list}) OR ` +
          `${table}.subdepartmentid IN (${list}) OR ` +
          `${table}.workgroupid IN (${list}) OR ` +
          `${table}.id IN (` +
          `SELECT userid FROM piuserorganize WHERE deletemark = 0 AND (` +
          `companyid = '${departmentId}' OR ` +
          `subcompanyid = '${departmentId}' OR ` +
          `departmentid = '${departmentId}' OR ` +
          `subdepartmentid = '${departmentId}' OR ` +
          `workgroupid = '${departmentId}'))` +
          `)`;
      }
    }

    if (auditStates) {
      whereConditional += ` AND (${table}.auditstatus = '${auditStates}')`;
    }

    if (roleIds && roleIds.length > 0) {
      const roles = StringHelper.arrayToList(roleIds, '\'');
      whereConditional += ` AND (${table}.id IN (SELECT userid FROM piuserrole WHERE roleid IN (${roles})))`;
    }

    if (!userInfo?.IsAdministrator && SystemInfo.EnableUserAuthorizationScope) {
      const permissionScopeItemId = await permissionItemService.getId(permissionScopeCode);
      if (permissionScopeItemId) {
        const organizeIds = await permissionScopeService.getOrganizeIds(userInfo.Id, permissionScopeCode);
        if (organizeIds?.includes(PermissionScope.No)) {
          whereConditional += ` AND (${table}.id IS NULL)`;
        }
        if (organizeIds?.includes(PermissionScope.Detail)) {
          const userIds = await permissionScopeService.getUserIds(userInfo.Id, permissionScopeCode);
          whereConditional += ` AND (${table}.id IN (${StringHelper.objectsToList(userIds)}))`;
        }
        if (organizeIds?.includes(PermissionScope.User)) {
          whereConditional += ` AND (${table}.id = '${userInfo.Id}')`;
        }
        if (organizeIds?.includes(PermissionScope.UserWorkgroup)) {
          whereConditional += ` AND (${table}.workgroupid = '${userInfo.WorkgroupId}')`;
        }
        if (organizeIds?.includes(PermissionScope.UserDepartment)) {
          whereConditional += ` AND (${table}.departmentid = '${userInfo.DepartmentId}')`;
        }
        if (organizeIds?.includes(PermissionScope.UserCompany)) {
          whereConditional += ` AND (${table}.companyid = '${userInfo.CompanyId}')`;
        }
      }
    }

    return whereConditional;
  }

  async delete(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_Delete',
      FrameworkMessage.UserService_Delete || 'Delete user',
      id || ''
    );
    try {
      await this.prisma.piuser.update({
        where: { ID: id },
        data: { DELETEMARK: 1 }
      });
      await this.prisma.pistaff.updateMany({
        where: { USERID: id },
        data: { USERID: null }
      });
      await userPermission.clearUserPermissionByUserId(id);
      return true;
    } catch (error) {
      console.error('[UserService.delete]', error);
      return false;
    }
  }

  async batchDelete(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_BatchDelete',
      FrameworkMessage.UserService_BatchDelete || 'Batch delete users',
      JSON.stringify(ids)
    );

    try {
      await this.prisma.piuser.updateMany({
        where: { ID: { in: ids } },
        data: { DELETEMARK: 1 }
      });
      await this.prisma.pistaff.updateMany({
        where: { USERID: { in: ids } },
        data: { USERID: null }
      });
      for (const id of ids) {
        await userPermission.clearUserPermissionByUserId(id);
      }
      return true;
    } catch (error) {
      console.error('[UserService.batchDelete]', error);
      return false;
    }
  }

  async setDeleted(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_SetDeleted',
      FrameworkMessage.UserService_SetDeleted || 'Set deleted',
      JSON.stringify(ids)
    );
    return this.batchDelete(userInfo, ids);
  }

  async getUserIdsInRole(userInfo, roleId) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetUserIdsInRole',
      FrameworkMessage.UserService_GetUserIdsInRole || 'Get user ids in role',
      roleId || ''
    );
    const q1 = await this.prisma.piuser.findMany({
      where: { ROLEID: roleId, DELETEMARK: 0, ENABLED: 1 },
      select: { ID: true }
    });
    const q2 = await this.prisma.piuserrole.findMany({
      where: { ROLEID: roleId, DELETEMARK: 0, USERID: { in: await this.prisma.piuser.findMany({ where: { DELETEMARK: 0 }, select: { ID: true } }).then((rows) => rows.map((r) => r.ID)) } },
      select: { USERID: true }
    });
    return toUnique([...q1.map((row) => row.ID), ...q2.map((row) => row.USERID)]);
  }

  async searchByPage(
    userInfo,
    permissionScopeCode,
    search,
    roleIds,
    enabled,
    auditStates,
    departmentId,
    pageIndex = 1,
    pageSize = 20
  ) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_SearchByPage',
      FrameworkMessage.UserService_SearchByPage || 'Search by page',
      ''
    );
    const whereConditional = await this.getSearchConditional(
      userInfo,
      permissionScopeCode,
      search,
      roleIds,
      enabled,
      auditStates,
      departmentId
    );
    const sql =
      `SELECT piuser.*, piuserlogon.FIRSTVISIT, piuserlogon.PREVIOUSVISIT, piuserlogon.LASTVISIT, ` +
      `piuserlogon.IPADDRESS, piuserlogon.MACADDRESS, piuserlogon.LOGONCOUNT, piuserlogon.USERONLINE, ` +
      `piuserlogon.CHECKIPADDRESS, piuserlogon.MULTIUSERLOGIN ` +
      `FROM piuser LEFT OUTER JOIN piuserlogon ON piuser.id = piuserlogon.id ` +
      `WHERE ${whereConditional} ORDER BY piuser.SORTCODE`;

    const rows = await db.executeQuery(sql);
    const total = rows.length;
    const start = (Math.max(1, pageIndex) - 1) * pageSize;
    const page = rows.slice(start, start + pageSize);
    return { count: total, page };
  }

  getModuleIdsByUserId(userInfo, userId) {
    return userPermission.getModuleIdsByUserId(userInfo, userId);
  }

  getModuleDT(userInfo) {
    return userPermission.getModuleDT(userInfo);
  }

  getModuleDTByUserId(userInfo, userId) {
    return userPermission.getModuleDTByUserId(userInfo, userId);
  }

  async getUserIdsByOrganizeIdsAndRoleIds(userInfo, receiverIds = [], organizeIds = [], roleIds = []) {
    await LogService.writeLog(
      userInfo,
      'UserService',
      FrameworkMessage.UserService || 'UserService',
      'UserService_GetUserIdsByOrganizeIdsAndRoleIds',
      FrameworkMessage.UserService_GetUserIdsByOrganizeIdsAndRoleIds || 'Get user ids by organize and role',
      ''
    );
    const companyUsers = await this.prisma.piuser.findMany({
      where: {
        DELETEMARK: 0,
        ENABLED: 1,
        OR: [
          { WORKGROUPID: { in: organizeIds } },
          { DEPARTMENTID: { in: organizeIds } },
          { SUBDEPARTMENTID: { in: organizeIds } },
          { SUBCOMPANYID: { in: organizeIds } },
          { COMPANYID: { in: organizeIds } }
        ]
      },
      select: { ID: true }
    });

    const pivotUsers = await this.prisma.piuserorganize.findMany({
      where: {
        DELETEMARK: 0,
        OR: [
          { WORKGROUPID: { in: organizeIds } },
          { DEPARTMENTID: { in: organizeIds } },
          { SUBDEPARTMENTID: { in: organizeIds } },
          { SUBCOMPANYID: { in: organizeIds } },
          { COMPANYID: { in: organizeIds } }
        ]
      },
      select: { USERID: true }
    });

    const roleUsers = await this.prisma.piuserrole.findMany({
      where: {
        ROLEID: { in: roleIds },
        USERID: {
          in: await this.prisma.piuser
            .findMany({ where: { DELETEMARK: 0 }, select: { ID: true } })
            .then((rows) => rows.map((r) => r.ID))
        }
      },
      select: { USERID: true }
    });

    const combined = toUnique([
      ...receiverIds,
      ...companyUsers.map((row) => row.ID),
      ...pivotUsers.map((row) => row.USERID),
      ...roleUsers.map((row) => row.USERID)
    ]);
    return combined;
  }
}

module.exports = {
  UserService,
  userService: new UserService()
};
