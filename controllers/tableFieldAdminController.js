'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');

const prisma = new PrismaClient();

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return current;
};

const parsePositive = (value, fallback = 1) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const normalizeString = (value, fallback = '') => {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
};

const boolToInt = (value, defaultValue = 0) => (value ? 1 : defaultValue);

const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatColumn = (entity) => ({
  id: entity.ID,
  tableCode: entity.TABLECODE || '',
  tableName: entity.TABLENAME || '',
  columnCode: entity.COLUMNCODE || '',
  columnName: entity.COLUMNNAME || '',
  dataType: entity.DATATYPE || '',
  isPublic: entity.ISPUBLIC === 1,
  columnAccess: entity.COLUMNACCESS === 1,
  columnEdit: entity.COLUMNEDIT === 1,
  columnDeny: entity.COLUMNDENEY === 1,
  useConstraint: entity.USECONSTRAINT === 1,
  isSearchColumn: entity.ISSEARCHCOLUMN === 1,
  isExhibitColumn: entity.ISEXHIBITCOLUMN === 1,
  enabled: entity.ENABLED === 1,
  allowEdit: entity.ALLOWEDIT === 1,
  allowDelete: entity.ALLOWDELETE === 1,
  sortCode: entity.SORTCODE ?? null,
  description: entity.DESCRIPTION || ''
});

const buildCreateEntity = (payload, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    TABLECODE: payload.tableCode,
    TABLENAME: payload.tableName || payload.tableCode,
    COLUMNCODE: payload.columnCode,
    COLUMNNAME: payload.columnName || payload.columnCode,
    DATATYPE: payload.dataType || null,
    ISPUBLIC: boolToInt(payload.isPublic),
    COLUMNACCESS: boolToInt(payload.columnAccess),
    COLUMNEDIT: boolToInt(payload.columnEdit),
    COLUMNDENEY: boolToInt(payload.columnDeny),
    USECONSTRAINT: boolToInt(payload.useConstraint),
    ISSEARCHCOLUMN: boolToInt(payload.isSearchColumn),
    ISEXHIBITCOLUMN: boolToInt(payload.isExhibitColumn),
    ENABLED: boolToInt(payload.enabled, 1),
    ALLOWEDIT: boolToInt(payload.allowEdit, 1),
    ALLOWDELETE: boolToInt(payload.allowDelete, 1),
    SORTCODE: numberOrNull(payload.sortCode),
    DESCRIPTION: payload.description || null,
    DELETEMARK: 0,
    CREATEON: now,
    CREATEUSERID: currentUser?.Id || null,
    CREATEBY: currentUser?.RealName || null
  };
};

const buildUpdateEntity = (payload, currentUser) => ({
  TABLECODE: payload.tableCode,
  TABLENAME: payload.tableName || payload.tableCode,
  COLUMNCODE: payload.columnCode,
  COLUMNNAME: payload.columnName || payload.columnCode,
  DATATYPE: payload.dataType || null,
  ISPUBLIC: boolToInt(payload.isPublic),
  COLUMNACCESS: boolToInt(payload.columnAccess),
  COLUMNEDIT: boolToInt(payload.columnEdit),
  COLUMNDENEY: boolToInt(payload.columnDeny),
  USECONSTRAINT: boolToInt(payload.useConstraint),
  ISSEARCHCOLUMN: boolToInt(payload.isSearchColumn),
  ISEXHIBITCOLUMN: boolToInt(payload.isExhibitColumn),
  ENABLED: boolToInt(payload.enabled, 1),
  ALLOWEDIT: boolToInt(payload.allowEdit, 1),
  ALLOWDELETE: boolToInt(payload.allowDelete, 1),
  SORTCODE: numberOrNull(payload.sortCode),
  DESCRIPTION: payload.description || null,
  MODIFIEDON: new Date(),
  MODIFIEDUSERID: currentUser?.Id || null,
  MODIFIEDBY: currentUser?.RealName || null
});

exports.tables = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const rows = await prisma.citablecolumns.findMany({
      where: { DELETEMARK: 0 },
      select: {
        TABLECODE: true,
        TABLENAME: true
      },
      distinct: ['TABLECODE', 'TABLENAME'],
      orderBy: { TABLECODE: 'asc' }
    });
    const data = rows.map((row) => ({
      tableCode: row.TABLECODE || '',
      tableName: row.TABLENAME || row.TABLECODE || ''
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[TableFieldAdmin.tables]', error);
    res.status(500).json({ success: false, message: '获取表列表失败' });
  }
};

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 20));
  const tableCode = normalizeString(req.query.tableCode, '');
  const keyword = (req.query.keyword || '').trim();
  const where = { DELETEMARK: 0 };
  if (tableCode) {
    where.TABLECODE = tableCode;
  }
  if (keyword) {
    where.OR = [
      { COLUMNCODE: { contains: keyword, mode: 'insensitive' } },
      { COLUMNNAME: { contains: keyword, mode: 'insensitive' } },
      { TABLENAME: { contains: keyword, mode: 'insensitive' } },
      { DATATYPE: { contains: keyword, mode: 'insensitive' } }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      prisma.citablecolumns.count({ where }),
      prisma.citablecolumns.findMany({
        where,
        orderBy: [{ SORTCODE: 'asc' }, { COLUMNNAME: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatColumn), total, page, pageSize });
  } catch (error) {
    console.error('[TableFieldAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取表字段失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少字段主键' });
  }
  try {
    const entity = await prisma.citablecolumns.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '字段不存在' });
    }
    res.json({ success: true, data: formatColumn(entity) });
  } catch (error) {
    console.error('[TableFieldAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取字段详情失败' });
  }
};

exports.create = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const payload = req.body || {};
  const tableCode = normalizeString(payload.tableCode);
  const columnCode = normalizeString(payload.columnCode);
  if (!tableCode || !columnCode) {
    return res.status(400).json({ success: false, message: '请填写表名和英文字段名' });
  }
  try {
    const entity = buildCreateEntity({
      ...payload,
      tableCode,
      tableName: normalizeString(payload.tableName),
      columnCode,
      columnName: normalizeString(payload.columnName)
    }, current);
    const created = await prisma.citablecolumns.create({ data: entity });
    res.json({ success: true, message: '字段已创建', data: formatColumn(created) });
  } catch (error) {
    console.error('[TableFieldAdmin.create]', error);
    res.status(500).json({ success: false, message: '新增字段失败' });
  }
};

exports.update = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少字段主键' });
  }
  const payload = req.body || {};
  const tableCode = normalizeString(payload.tableCode);
  const columnCode = normalizeString(payload.columnCode);
  if (!tableCode || !columnCode) {
    return res.status(400).json({ success: false, message: '请填写表名和英文字段名' });
  }
  try {
    const existing = await prisma.citablecolumns.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '字段不存在' });
    }
    await prisma.citablecolumns.update({
      where: { ID: id },
      data: buildUpdateEntity({
        ...payload,
        tableCode,
        tableName: normalizeString(payload.tableName),
        columnCode,
        columnName: normalizeString(payload.columnName)
      }, current)
    });
    const updated = await prisma.citablecolumns.findFirst({ where: { ID: id } });
    res.json({ success: true, message: '字段已更新', data: formatColumn(updated) });
  } catch (error) {
    console.error('[TableFieldAdmin.update]', error);
    res.status(500).json({ success: false, message: '更新字段失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少字段主键' });
  }
  try {
    const result = await prisma.citablecolumns.updateMany({
      where: { ID: id, DELETEMARK: 0 },
      data: { DELETEMARK: 1 }
    });
    if (!result.count) {
      return res.status(404).json({ success: false, message: '字段不存在或已删除' });
    }
    res.json({ success: true, message: '字段已删除' });
  } catch (error) {
    console.error('[TableFieldAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除字段失败' });
  }
};
