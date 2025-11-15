'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const { OrganizeService } = require('./organize_service');
const { UserService } = require('./user_service');
const { LogService } = require('./log_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const organizeService = new OrganizeService(prisma, db);
const userService = new UserService(prisma);

class StaffService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  async add(userInfo, entity, organizeId = '') {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_AddStaff',
      FrameworkMessage.StaffService_AddStaff || 'Add staff',
      entity?.ID || ''
    );

    try {
      const now = new Date();
      const staffRecord = await this.prisma.pistaff.create({ data: entity });
      await this.prisma.pistafforganize.create({
        data: {
          ID: randomUUID(),
          STAFFID: staffRecord.ID,
          ORGANIZEID: organizeId || null,
          ENABLED: 1,
          DELETEMARK: 0,
          CREATEON: now,
          MODIFIEDON: now
        }
      });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: staffRecord.ID };
    } catch (error) {
      console.error('[StaffService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async getDT(userInfo) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetDT',
      FrameworkMessage.StaffService_GetDT || 'Get staff list',
      ''
    );
    return this.prisma.pistaff.findMany();
  }

  async getDTByPage(userInfo, searchValue, pageSize = 50, order) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetDTByPage',
      FrameworkMessage.StaffService_GetDTByPage || 'Get staff page',
      ''
    );
    let sql = `SELECT * FROM ${this.tableName()} WHERE DELETEMARK = 0`;
    if (searchValue) {
      sql += ` AND (${searchValue})`;
    }
    if (order) {
      sql += ` ORDER BY ${order}`;
    }
    const rows = await db.executeQuery(sql);
    const total = rows.length;
    return [total, rows];
  }

  async getEntity(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetEntity',
      FrameworkMessage.StaffService_GetEntity || 'Get staff',
      id || ''
    );
    return this.prisma.pistaff.findUnique({ where: { ID: id } });
  }

  async updateStaff(userInfo, entity) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_UpdateStaff',
      FrameworkMessage.StaffService_UpdateStaff || 'Update staff',
      entity?.ID || ''
    );
    if (!entity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.pistaff.update({ where: { ID: entity.ID }, data: entity });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[StaffService.updateStaff]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async getDTByIds(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_UpdateStaff',
      FrameworkMessage.StaffService_UpdateStaff || 'Get staff by ids',
      JSON.stringify(ids)
    );
    if (!ids.length) {
      return [];
    }
    return this.prisma.pistaff.findMany({ where: { ID: { in: ids } } });
  }

  async getDTByOrganize(userInfo, organizeId, containChildren) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetDTByOrganize',
      FrameworkMessage.StaffService_GetDTByOrganize || 'Get staff by org',
      organizeId || ''
    );
    if (!organizeId) {
      return [];
    }
    let organizeIds = [];
    if (containChildren) {
      organizeIds = await organizeService.getChildrensById(organizeId);
    } else {
      organizeIds = [organizeId];
    }
    if (!organizeIds?.length) {
      organizeIds = [organizeId];
    }
    const staffOrg = await this.prisma.pistafforganize.findMany({
      where: { ORGANIZEID: { in: organizeIds }, DELETEMARK: 0 },
      select: { STAFFID: true }
    });
    const staffIds = [...new Set(staffOrg.map((row) => row.STAFFID))];
    return this.prisma.pistaff.findMany({
      where: { ID: { in: staffIds }, DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async getDTNotOrganize(userInfo) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetDTByOrganize',
      FrameworkMessage.StaffService_GetDTByOrganize || 'Get staff no org',
      ''
    );
    const organizedIds = await this.prisma.pistafforganize.findMany({
      where: { DELETEMARK: 0, ENABLED: 1 },
      select: { STAFFID: true }
    });
    return this.prisma.pistaff.findMany({
      where: { DELETEMARK: 0, ID: { notIn: organizedIds.map((row) => row.STAFFID) } }
    });
  }

  async setStaffUser(userInfo, staffId, userId) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetDTByOrganize',
      FrameworkMessage.StaffService_GetDTByOrganize || 'Set staff user',
      `${staffId}/${userId}`
    );
    if (!staffId) {
      return false;
    }
    try {
      if (!userId) {
        await this.prisma.pistaff.update({ where: { ID: staffId }, data: { USERID: null } });
        return true;
      }
      const existing = await this.prisma.pistaff.findMany({ where: { USERID: userId } });
      if (existing.length) {
        return false;
      }
      const user = await userService.getEntity(null, userId);
      await this.prisma.pistaff.update({
        where: { ID: staffId },
        data: { USERID: userId, USERNAME: user?.USERNAME || null }
      });
      return true;
    } catch (error) {
      console.error('[StaffService.setStaffUser]', error);
      return false;
    }
  }

  async deleteUser(userInfo, staffId) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_DeleteUser',
      FrameworkMessage.StaffService_DeleteUser || 'Delete staff user',
      staffId || ''
    );
    try {
      const staff = await this.prisma.pistaff.findUnique({ where: { ID: staffId } });
      if (staff?.USERID) {
        await userService.setDeleted(null, [staff.USERID]);
      }
      await this.prisma.pistaff.update({
        where: { ID: staffId },
        data: { USERID: null }
      });
      return true;
    } catch (error) {
      console.error('[StaffService.deleteUser]', error);
      return false;
    }
  }

  async delete(userInfo, id) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_Delete',
      FrameworkMessage.StaffService_Delete || 'Delete staff',
      id || ''
    );
    try {
      const staff = await this.prisma.pistaff.findUnique({ where: { ID: id } });
      if (staff?.USERID) {
        await this.prisma.piuserrole.deleteMany({ where: { USERID: staff.USERID } });
        await userService.delete(null, staff.USERID);
      }
      await this.prisma.pistafforganize.deleteMany({ where: { STAFFID: id } });
      await this.prisma.pistaff.delete({ where: { ID: id } });
      return true;
    } catch (error) {
      console.error('[StaffService.delete]', error);
      return false;
    }
  }

  async batchDelete(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_Delete',
      FrameworkMessage.StaffService_Delete || 'Batch delete staff',
      JSON.stringify(ids)
    );
    if (!ids.length) {
      return false;
    }
    try {
      const staffUsers = await this.prisma.pistaff.findMany({
        where: { ID: { in: ids } },
        select: { USERID: true }
      });
      const userIds = staffUsers.map((row) => row.USERID).filter(Boolean);
      for (const userId of userIds) {
        await userService.delete(null, userId);
      }
      if (userIds.length) {
        await this.prisma.piuserrole.deleteMany({ where: { USERID: { in: userIds } } });
      }
      await this.prisma.pistafforganize.deleteMany({ where: { STAFFID: { in: ids } } });
      await this.prisma.pistaff.deleteMany({ where: { ID: { in: ids } } });
      return true;
    } catch (error) {
      console.error('[StaffService.batchDelete]', error);
      return false;
    }
  }

  async setDeleted(userInfo, ids = []) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_SetDeleted',
      FrameworkMessage.StaffService_SetDeleted || 'Set staff deleted',
      JSON.stringify(ids)
    );
    if (!ids.length) {
      return false;
    }
    try {
      const staff = await this.prisma.pistaff.findMany({
        where: { ID: { in: ids } },
        select: { USERID: true }
      });
      const userIds = staff.map((row) => row.USERID).filter(Boolean);
      if (userIds.length) {
        await userService.setDeleted(null, userIds);
        await this.prisma.piuserrole.deleteMany({ where: { USERID: { in: userIds } } });
      }
      await this.prisma.pistafforganize.updateMany({
        where: { STAFFID: { in: ids } },
        data: { DELETEMARK: 1 }
      });
      await this.prisma.pistaff.updateMany({
        where: { ID: { in: ids } },
        data: { DELETEMARK: 1 }
      });
      return true;
    } catch (error) {
      console.error('[StaffService.setDeleted]', error);
      return false;
    }
  }

  async moveTo(userInfo, id, organizeId) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_MoveTo',
      FrameworkMessage.StaffService_MoveTo || 'Move staff',
      `${id}/${organizeId}`
    );
    try {
      const existing = await this.prisma.pistafforganize.findFirst({ where: { STAFFID: id } });
      if (existing) {
        await this.prisma.pistafforganize.update({
          where: { ID: existing.ID },
          data: { ORGANIZEID: organizeId }
        });
      } else {
        await this.prisma.pistafforganize.create({
          data: {
            ID: randomUUID(),
            STAFFID: id,
            ORGANIZEID: organizeId,
            ENABLED: 1,
            DELETEMARK: 0,
            CREATEON: new Date(),
            MODIFIEDON: new Date()
          }
        });
      }
      return true;
    } catch (error) {
      console.error('[StaffService.moveTo]', error);
      return false;
    }
  }

  async batchMoveTo(userInfo, ids = [], organizeId) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_MoveTo',
      FrameworkMessage.StaffService_MoveTo || 'Batch move staff',
      `${JSON.stringify(ids)}/${organizeId}`
    );
    try {
      await this.prisma.pistafforganize.updateMany({
        where: { STAFFID: { in: ids } },
        data: { ORGANIZEID: organizeId }
      });
      return true;
    } catch (error) {
      console.error('[StaffService.batchMoveTo]', error);
      return false;
    }
  }

  async getId(userInfo, valueDic = {}) {
    await LogService.writeLog(
      userInfo,
      'StaffService',
      FrameworkMessage.StaffService || 'StaffService',
      'StaffService_GetId',
      FrameworkMessage.StaffService_GetId || 'Get staff id',
      ''
    );
    const staff = await this.prisma.pistaff.findMany({
      where: valueDic,
      select: { ID: true }
    });
    return staff.map((row) => row.ID);
  }

  tableName() {
    return 'pistaff';
  }
}

module.exports = {
  StaffService,
  staffService: new StaffService()
};
