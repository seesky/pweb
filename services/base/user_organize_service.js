'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const { UserService } = require('./user_service');
const { UserRoleService } = require('./user_role_service');
const { OrganizeService } = require('./organize_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const userService = new UserService(prisma);
const userRoleService = new UserRoleService(prisma);
const organizeService = new OrganizeService(prisma, db);

const toUnique = (values = []) => [...new Set(values.filter(Boolean))];

class UserOrganizeService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  async getDTByDepartment(departmentId, containChildren = false) {
    if (!departmentId) {
      return userService.getDT(null);
    }
    return this.getDepartmentUsers(departmentId, containChildren);
  }

  async getUserPageDTByDepartment(
    userInfo,
    permissionScopeCode,
    searchValue,
    enabled,
    auditStates,
    roleIds,
    showRole,
    userAllInformation,
    pageIndex = 1,
    pageSize = 100,
    sort,
    departmentId = ''
  ) {
    const { count, page } = await userService.searchByPage(
      userInfo,
      permissionScopeCode,
      searchValue,
      roleIds,
      enabled,
      auditStates,
      departmentId,
      pageIndex,
      pageSize
    );

    if (showRole && page?.length) {
      const roles = await this.prisma.pirole.findMany({
        where: { DELETEMARK: 0 },
        select: { ID: true, REALNAME: true }
      });
      const roleMap = new Map(roles.map((role) => [role.ID, role.REALNAME]));
      await Promise.all(
        page.map(async (user) => {
          const ids = await userRoleService.getRoleIds(user.ID);
          const names = ids.map((id) => roleMap.get(id)).filter(Boolean);
          if (names.length) {
            user.ROLENAME = names.join(', ');
          }
        })
      );
    }
    return [count, page];
  }

  async getUserOrganizeDT(userId) {
    if (!userId) {
      return [];
    }
    const sql = `
      SELECT PIUSERORGANIZE.*,
             PiOrganize1.FULLNAME AS CompanyName,
             PiOrganize2.FULLNAME AS SubCompanyName,
             PiOrganize3.FULLNAME AS DepartmentName,
             PiOrganize4.FULLNAME AS SubDepartmentName,
             PiOrganize5.FULLNAME AS WorkGroupName
        FROM PIUSERORGANIZE
        LEFT OUTER JOIN PIORGANIZE PiOrganize1 ON PIUSERORGANIZE.CompanyId = PiOrganize1.Id
        LEFT OUTER JOIN PIORGANIZE PiOrganize2 ON PIUSERORGANIZE.SubCompanyId = PiOrganize2.Id
        LEFT OUTER JOIN PIORGANIZE PiOrganize3 ON PIUSERORGANIZE.DepartmentId = PiOrganize3.Id
        LEFT OUTER JOIN PIORGANIZE PiOrganize4 ON PIUSERORGANIZE.SubDepartmentId = PiOrganize4.Id
        LEFT OUTER JOIN PIORGANIZE PiOrganize5 ON PIUSERORGANIZE.WorkgroupId = PiOrganize5.Id
       WHERE PIUSERORGANIZE.USERID = '${userId}'
         AND PIUSERORGANIZE.DELETEMARK = 0
    `;
    return this.db.executeQuery(sql);
  }

  async addUserToOrganize(userOrganizeEntity) {
    try {
      const record = await this.prisma.piuserorganize.create({ data: userOrganizeEntity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[UserOrganizeService.addUserToOrganize]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async batchDeleteUserOrganize(ids = []) {
    if (!ids.length) {
      return 0;
    }
    const result = await this.prisma.piuserorganize.deleteMany({ where: { ID: { in: ids } } });
    return result.count;
  }

  async userIsInOrganize(userId, organizeName) {
    if (!userId || !organizeName) {
      return false;
    }
    const organize = await this.prisma.piorganize.findFirst({
      where: { FULLNAME: organizeName, ENABLED: 1, DELETEMARK: 0 },
      select: { ID: true }
    });
    if (!organize?.ID) {
      return false;
    }
    const organizeIds = await this.getAllOrganizeIds(userId);
    return organizeIds.includes(organize.ID);
  }

  async getAllOrganizeIds(userId) {
    if (!userId) {
      return [];
    }
    const fetchIds = async (field) =>
      this.prisma.piuser.findMany({
        where: {
          ID: userId,
          DELETEMARK: 0,
          ENABLED: 1,
          [field]: { not: null }
        },
        select: { [field]: true }
      });

    const directFields = ['COMPANYID', 'SUBCOMPANYID', 'DEPARTMENTID', 'SUBDEPARTMENTID', 'WORKGROUPID'];
    const directResults = await Promise.all(directFields.map((field) => fetchIds(field)));

    const pivot = await this.prisma.piuserorganize.findMany({
      where: {
        USERID: userId,
        DELETEMARK: 0,
        ENABLED: 1,
        OR: [
          { COMPANYID: { not: null } },
          { SUBCOMPANYID: { not: null } },
          { DEPARTMENTID: { not: null } },
          { SUBDEPARTMENTID: { not: null } },
          { WORKGROUPID: { not: null } }
        ]
      },
      select: {
        COMPANYID: true,
        SUBCOMPANYID: true,
        DEPARTMENTID: true,
        SUBDEPARTMENTID: true,
        WORKGROUPID: true
      }
    });

    const pivotIds = [];
    pivot.forEach((row) => {
      pivotIds.push(row.COMPANYID, row.SUBCOMPANYID, row.DEPARTMENTID, row.SUBDEPARTMENTID, row.WORKGROUPID);
    });

    const directIds = directResults
      .flat()
      .map((row) => Object.values(row)[0])
      .filter(Boolean);

    return toUnique([...directIds, ...pivotIds]);
  }

  async getDepartmentUsers(departmentId, containChildren) {
    if (!departmentId) {
      return this.prisma.piuser.findMany({ where: { DELETEMARK: 0 }, orderBy: { SORTCODE: 'asc' } });
    }
    if (containChildren) {
      const department = await this.prisma.piorganize.findUnique({ where: { ID: departmentId } });
      let organizeIds = [];
      if (department?.CODE) {
        organizeIds = await organizeService.getChildrensIdByCode(department.CODE);
      }
      if (!organizeIds?.length) {
        organizeIds = [departmentId];
      } else if (!organizeIds.includes(departmentId)) {
        organizeIds.push(departmentId);
      }
      return this.getDTByOrganizes(organizeIds);
    }
    return this.getDataTableByDepartment(departmentId);
  }

  async getDTByOrganizes(organizeIds = []) {
    const validOrganizeIds = (organizeIds || []).filter((id) => Boolean(id));
    if (!validOrganizeIds.length) {
      return [];
    }

    const directUsers = await this.prisma.piuser.findMany({
      where: {
        DELETEMARK: 0,
        OR: [
          { WORKGROUPID: { in: validOrganizeIds } },
          { DEPARTMENTID: { in: validOrganizeIds } },
          { SUBDEPARTMENTID: { in: validOrganizeIds } },
          { SUBCOMPANYID: { in: validOrganizeIds } },
          { COMPANYID: { in: validOrganizeIds } }
        ]
      },
      orderBy: { SORTCODE: 'asc' }
    });

    const pivotUsers = await this.prisma.piuserorganize.findMany({
      where: {
        DELETEMARK: 0,
        OR: [
          { WORKGROUPID: { in: validOrganizeIds } },
          { DEPARTMENTID: { in: validOrganizeIds } },
          { SUBDEPARTMENTID: { in: validOrganizeIds } },
          { SUBCOMPANYID: { in: validOrganizeIds } },
          { COMPANYID: { in: validOrganizeIds } }
        ]
      },
      select: { USERID: true }
    });

    if (!pivotUsers.length) {
      return directUsers;
    }

    const extraUsers = await this.prisma.piuser.findMany({
      where: { ID: { in: pivotUsers.map((row) => row.USERID) }, DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });

    const seen = new Set(directUsers.map((user) => user.ID));
    extraUsers.forEach((user) => {
      if (!seen.has(user.ID)) {
        directUsers.push(user);
      }
    });
    return directUsers.sort((a, b) => (a.SORTCODE ?? 0) - (b.SORTCODE ?? 0));
  }

  async getDataTableByDepartment(departmentId) {
    if (!departmentId) {
      return [];
    }

    const users = await this.prisma.piuser.findMany({
      where: {
        DELETEMARK: 0,
        ENABLED: 1,
        OR: [
          { DEPARTMENTID: departmentId },
          {
            ID: {
              in: await this.prisma.piuserorganize
                .findMany({
                  where: { DEPARTMENTID: departmentId, DELETEMARK: 0 },
                  select: { USERID: true }
                })
                .then((rows) => rows.map((row) => row.USERID))
            }
          }
        ]
      },
      orderBy: { SORTCODE: 'asc' }
    });
    return users;
  }
}

module.exports = {
  UserOrganizeService,
  userOrganizeService: new UserOrganizeService()
};
