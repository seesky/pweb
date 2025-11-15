'use strict';

const { PrismaClient } = require('@prisma/client');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const ConstrainUtil = require('../../utilities/publiclibrary/constrain_util');

const { PermissionScopeService } = require('./permission_scope_service');
const { PermissionItemService } = require('./permission_item_service');
const { UserRoleService } = require('./user_role_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const permissionScopeService = new PermissionScopeService(prisma);
const permissionItemService = new PermissionItemService(prisma);
const userRoleService = new UserRoleService(prisma);

const toUnique = (values = []) => [...new Set(values.filter(Boolean))];

class TableColumnsService {
  constructor(client = prisma, dbClient = db) {
    this.prisma = client;
    this.db = dbClient;
  }

  async add(entity) {
    try {
      const record = await this.prisma.citablecolumns.create({ data: entity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[TableColumnsService.add]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  getDT() {
    return this.prisma.citablecolumns.findMany({ where: { DELETEMARK: 0 } });
  }

  getAllTableScope() {
    return this.prisma.pitablepermissionscope.findMany({ where: { DELETEMARK: 0 } });
  }

  getTableNameAndCode() {
    const sql = 'SELECT DISTINCT TABLECODE,TABLECODE AS TABLENAME FROM CITABLECOLUMNS ORDER BY TABLECODE';
    return this.db.executeQuery(sql);
  }

  getEntity(id) {
    return this.prisma.citablecolumns.findUnique({ where: { ID: id } });
  }

  async update(entity) {
    if (!entity?.ID) {
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
    try {
      await this.prisma.citablecolumns.update({ where: { ID: entity.ID }, data: entity });
      return { returnCode: StatusCode.OKUpdate, returnMessage: FrameworkMessage.MSG0010 };
    } catch (error) {
      console.error('[TableColumnsService.update]', error);
      return { returnCode: StatusCode.Error, returnMessage: FrameworkMessage.MSG0001 };
    }
  }

  getDTByIds(ids = []) {
    if (!ids.length) {
      return [];
    }
    return this.prisma.citablecolumns.findMany({
      where: { ID: { in: ids }, DELETEMARK: 0 }
    });
  }

  getDTByValues(valuesDic = {}) {
    return this.prisma.citablecolumns.findMany({ where: valuesDic });
  }

  async batchSave(dataTable = []) {
    try {
      await this.prisma.$transaction(
        dataTable.map((column) =>
          this.prisma.citablecolumns.upsert({
            where: { ID: column.ID || '' },
            create: column,
            update: column
          })
        )
      );
      return true;
    } catch (error) {
      console.error('[TableColumnsService.batchSave]', error);
      return false;
    }
  }

  delete(id) {
    return this.prisma.citablecolumns.delete({ where: { ID: id } });
  }

  batchDelete(ids = []) {
    if (!ids.length) {
      return 0;
    }
    return this.prisma.citablecolumns.deleteMany({ where: { ID: { in: ids } } });
  }

  setDeleted(ids = []) {
    if (!ids.length) {
      return 0;
    }
    return this.prisma.citablecolumns.updateMany({
      where: { ID: { in: ids } },
      data: { DELETEMARK: 1 }
    });
  }

  getSearchFields(tableCode) {
    const sql =
      "SELECT columncode,columnname,datatype FROM citablecolumns WHERE tablecode='" +
      tableCode +
      "' AND issearchcolumn = 1 AND deletemark = 0 ORDER BY sortcode";
    return this.db.executeQuery(sql);
  }

  async getColumns(userInfo, tableCode, permissionCode = 'Column.Access') {
    if (!userInfo?.Id || !tableCode) {
      return [];
    }
    const scopeIds = await permissionScopeService.getResourceScopeIds(userInfo.Id, tableCode, permissionCode);
    if (permissionCode === 'Column.Deney' || permissionCode === 'Column.Edit') {
      return scopeIds;
    }
    if (permissionCode === 'Column.Access') {
      const publicColumns = await this.prisma.citablecolumns.findMany({
        where: { TABLECODE: tableCode, ISPUBLIC: 1 },
        select: { COLUMNCODE: true }
      });
      const combined = toUnique([...scopeIds, ...publicColumns.map((col) => col.COLUMNCODE)]);
      return combined;
    }
    return scopeIds;
  }

  getDTByTable(tableCode) {
    return this.prisma.citablecolumns.findMany({
      where: { TABLECODE: tableCode, DELETEMARK: 0 }
    });
  }

  getTablePermissionScope() {
    return this.prisma.pitablepermissionscope.findMany({ where: { DELETEMARK: 0 } });
  }

  async getConstraintDT(resourceCategory, resourceId, permissionCode = 'Resource.AccessPermission') {
    const permissionId = await permissionItemService.getIdByAdd(permissionCode);
    const sql = `
      SELECT PIPERMISSIONSCOPE.ID,
             PITABLEPERMISSIONSCOPE.ITEMVALUE AS TABLECODE,
             PITABLEPERMISSIONSCOPE.ITEMNAME AS TABLENAME,
             PIPERMISSIONSCOPE.PERMISSIONCONSTRAINT,
             PITABLEPERMISSIONSCOPE.SORTCODE
        FROM (
          SELECT ITEMVALUE, ITEMNAME, SORTCODE
            FROM PITABLEPERMISSIONSCOPE
           WHERE DELETEMARK = 0 AND ENABLED = 1
        ) PITABLEPERMISSIONSCOPE
        LEFT OUTER JOIN (
          SELECT ID, TARGETID, PERMISSIONCONSTRAINT
            FROM PIPERMISSIONSCOPE
           WHERE RESOURCECATEGORY = '${resourceCategory}'
             AND RESOURCEID = '${resourceId}'
             AND TARGETCATEGORY = 'Table'
             AND PERMISSIONID = '${permissionId}'
             AND DELETEMARK = 0
             AND ENABLED = 1
        ) PIPERMISSIONSCOPE
          ON PITABLEPERMISSIONSCOPE.ITEMVALUE = PIPERMISSIONSCOPE.TARGETID
       ORDER BY PITABLEPERMISSIONSCOPE.SORTCODE
    `;
    return this.db.executeQuery(sql);
  }

  async getUserConstraint(userInfo, tableName, permissionCode = 'Resource.AccessPermission') {
    if (!userInfo?.Id) {
      return '';
    }
    const permissionId = await permissionItemService.getIdByAdd(permissionCode);
    const roleIds = await userRoleService.getAllRoleIds(userInfo.Id);
    if (!roleIds.length) {
      return '';
    }

    const roleScopes = await this.prisma.pipermissionscope.findMany({
      where: {
        RESOURCECATEGORY: 'PIROLE',
        RESOURCEID: { in: roleIds },
        TARGETCATEGORY: 'Table',
        TARGETID: tableName,
        PERMISSIONID: permissionId,
        ENABLED: 1,
        DELETEMARK: 0
      },
      select: { PERMISSIONCONSTRAINT: true }
    });

    let constraint = '';
    roleScopes.forEach((row) => {
      const clause = (row.PERMISSIONCONSTRAINT || '').trim();
      if (clause) {
        constraint += ` AND ${clause}`;
      }
    });

    const userConstraint = await this.getConstraint('PIUSER', userInfo.Id, tableName, permissionCode);
    if (userConstraint) {
      constraint += ` AND ${userConstraint}`;
    }

    if (constraint) {
      const cleaned = constraint.replace(/^ AND\s*/i, '');
      return ConstrainUtil.prepareParameter(userInfo, cleaned);
    }
    return '';
  }

  setConstraint(resourceCategory, resourceId, tableName, permissionCode, constraint, enabled = true) {
    return permissionScopeService.getIdByAdd(resourceCategory, resourceId, tableName, permissionCode, constraint, enabled);
  }

  async getConstraint(resourceCategory, resourceId, tableName, permissionCode = 'Resource.AccessPermission') {
    const entity = await this.getConstraintEntity(resourceCategory, resourceId, tableName, permissionCode);
    if (entity && entity.ENABLED === 1) {
      return entity.PERMISSIONCONSTRAINT || '';
    }
    return '';
  }

  async getConstraintEntity(resourceCategory, resourceId, tableName, permissionCode = 'Resource.AccessPermission') {
    const permissionId = await permissionItemService.getIdByAdd(permissionCode);
    const entity = await this.prisma.pipermissionscope.findFirst({
      where: {
        RESOURCECATEGORY: resourceCategory,
        RESOURCEID: resourceId,
        TARGETCATEGORY: 'Table',
        TARGETID: tableName,
        PERMISSIONID: permissionId,
        DELETEMARK: 0
      }
    });
    return entity;
  }

  async batchDeleteConstraint(ids = []) {
    if (!ids.length) {
      return 0;
    }
    const result = await this.prisma.pipermissionscope.deleteMany({
      where: { ID: { in: ids } }
    });
    return result.count;
  }

  async addTablePermissionScope(entity) {
    try {
      const record = await this.prisma.pitablepermissionscope.create({ data: entity });
      return { returnCode: StatusCode.OKAdd, returnMessage: FrameworkMessage.MSG0009, returnValue: record.ID };
    } catch (error) {
      console.error('[TableColumnsService.addTablePermissionScope]', error);
      return { returnCode: StatusCode.DbError, returnMessage: FrameworkMessage.MSG0001, returnValue: null };
    }
  }

  async deleteTablePermissionScope(valuesDic = {}) {
    const result = await this.prisma.pitablepermissionscope.deleteMany({ where: valuesDic });
    return result.count;
  }

  async setTablePermissionScopeDeleted(ids = []) {
    if (!ids.length) {
      return 0;
    }
    const result = await this.prisma.pitablepermissionscope.updateMany({
      where: { ID: { in: ids } },
      data: { DELETEMARK: 1 }
    });
    return result.count;
  }

  getTablePermissionScopeEntity(name, value) {
    return this.prisma.pitablepermissionscope.findMany({
      where: { [name]: value }
    });
  }
}

module.exports = {
  TableColumnsService,
  tableColumnsService: new TableColumnsService()
};
