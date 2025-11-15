'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const SystemInfo = require('../../utilities/publiclibrary/system_info');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();

let innerOrganizeCache = null;
let lastCheckOrgTime = 0;
let onLineStateCache = null;

class OrganizeService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  async add(entity) {
    try {
      const record = await this.prisma.piorganize.create({ data: entity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[OrganizeService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async batchDelete(ids = []) {
    try {
      await this.prisma.piorganize.updateMany({
        where: { ID: { in: ids } },
        data: { DELETEMARK: 1 }
      });
      return true;
    } catch (error) {
      console.error('[OrganizeService.batchDelete]', error);
      return false;
    }
  }

  async batchMoveTo(organizeIds = [], parentId) {
    try {
      await this.prisma.piorganize.updateMany({
        where: { ID: { in: organizeIds } },
        data: { PARENTID: parentId }
      });
      return true;
    } catch (error) {
      console.error('[OrganizeService.batchMoveTo]', error);
      return false;
    }
  }

  async batchSave(dataTable = []) {
    try {
      await this.prisma.$transaction(
        dataTable.map((record) =>
          this.prisma.piorganize.upsert({
            where: { ID: record.ID || '' },
            create: record,
            update: record
          })
        )
      );
      return true;
    } catch (error) {
      console.error('[OrganizeService.batchSave]', error);
      return false;
    }
  }

  async delete(id) {
    try {
      await this.prisma.piorganize.update({
        where: { ID: id },
        data: { DELETEMARK: 1 }
      });
      return true;
    } catch (error) {
      console.error('[OrganizeService.delete]', error);
      return false;
    }
  }

  async getChildrensById(organizeId) {
    const ids = [organizeId];
    const children = await this.prisma.piorganize.findMany({
      where: { PARENTID: organizeId, DELETEMARK: 0 },
      select: { ID: true }
    });
    children.forEach((child) => ids.push(child.ID));
    return ids;
  }

  getDT() {
    return this.prisma.piorganize.findMany({
      where: { DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
  }

  async getDTByIds(ids = []) {
    if (!ids.length) {
      return [];
    }
    return this.prisma.piorganize.findMany({ where: { ID: { in: ids } } });
  }

  getDTByParent(parentId) {
    return this.prisma.piorganize.findMany({ where: { PARENTID: parentId } });
  }

  getDTByValues(valueDic = {}) {
    return this.prisma.piorganize.findMany({ where: valueDic });
  }

  getEntity(id) {
    return this.prisma.piorganize.findUnique({ where: { ID: id } });
  }

  getList() {
    return this.prisma.piorganize.findMany();
  }

  getListByParent(parentId) {
    return this.getDTByParent(parentId);
  }

  async moveTo(organizeId, parentId) {
    try {
      await this.prisma.piorganize.update({
        where: { ID: organizeId },
        data: { PARENTID: parentId }
      });
      return true;
    } catch (error) {
      console.error('[OrganizeService.moveTo]', error);
      return false;
    }
  }

  async setDeleted(ids = []) {
    try {
      for (const id of ids) {
        await this.prisma.$transaction([
          this.prisma.piorganize.update({
            where: { ID: id },
            data: { DELETEMARK: 1 }
          }),
          this.prisma.piuser.updateMany({
            where: { COMPANYID: id },
            data: { COMPANYID: null, COMPANYNAME: null }
          }),
          this.prisma.piuser.updateMany({
            where: { SUBCOMPANYID: id },
            data: { SUBCOMPANYID: null, SUBCOMPANYNAME: null }
          }),
          this.prisma.piuser.updateMany({
            where: { DEPARTMENTID: id },
            data: { DEPARTMENTID: null, DEPARTMENTNAME: null }
          }),
          this.prisma.piuser.updateMany({
            where: { SUBDEPARTMENTID: id },
            data: { SUBDEPARTMENTID: null, SUBDEPARTMENTNAME: null }
          }),
          this.prisma.piuser.updateMany({
            where: { WORKGROUPID: id },
            data: { WORKGROUPID: null, WORKGROUPNAME: null }
          }),
          this.prisma.pistafforganize.updateMany({
            where: { ORGANIZEID: id },
            data: { DELETEMARK: 1 }
          })
        ]);
      }
      return true;
    } catch (error) {
      console.error('[OrganizeService.setDeleted]', error);
      return false;
    }
  }

  async update(entity) {
    if (!entity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.piorganize.update({
        where: { ID: entity.ID },
        data: entity
      });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[OrganizeService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  async getChildrensIdByCode(code) {
    const sql = `SELECT ID FROM piorganize WHERE LEFT(CODE, LENGTH('${code}'))='${code}'`;
    const rows = await this.db.executeQuery(sql);
    return rows.map((row) => row.id);
  }

  async getInnerOrganizeDT() {
    let refresh = false;
    const now = Date.now();
    if (lastCheckOrgTime === 0) {
      refresh = true;
    } else if (now - lastCheckOrgTime >= SystemInfo.OnLineCheck * 1000) {
      refresh = true;
    }
    if (!innerOrganizeCache || refresh) {
      innerOrganizeCache = await this.prisma.piorganize.findMany({
        where: { ISINNERORGANIZE: 1, ENABLED: 1 },
        orderBy: { SORTCODE: 'asc' }
      });
      lastCheckOrgTime = now;
    }
    return innerOrganizeCache;
  }
}

module.exports = {
  OrganizeService,
  organizeService: new OrganizeService()
};
