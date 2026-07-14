'use strict';

const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { ItemService } = require('../services/base/item_service');
const { ItemDetailsService } = require('../services/base/item_details_service');

const prisma = new PrismaClient();
const itemService = new ItemService(prisma);
const itemDetailsService = new ItemDetailsService(prisma);

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

const normalize = (value) => (value === undefined || value === null ? '' : String(value).trim());
const boolToInt = (v, def = 0) => (v ? 1 : def);
const numberOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const formatItem = (row) => ({
  id: row.ID,
  parentId: row.PARENTID || null,
  code: row.CODE || '',
  fullName: row.FULLNAME || '',
  isTree: row.ISTREE === 1,
  allowEdit: row.ALLOWEDIT === 1,
  allowDelete: row.ALLOWDELETE === 1,
  enabled: row.ENABLED === 1,
  sortCode: row.SORTCODE ?? null,
  description: row.DESCRIPTION || ''
});

const formatItemDetail = (row) => ({
  id: row.ID,
  parentId: row.ITEMID || null,
  code: row.CODE || '',
  fullName: row.FULLNAME || '',
  value: row.ITEMVALUE || '',
  isDefault: row.ISDEFAULT === 1,
  allowEdit: row.ALLOWEDIT === 1,
  allowDelete: row.ALLOWDELETE === 1,
  enabled: row.ENABLED === 1,
  sortCode: row.SORTCODE ?? null,
  description: row.DESCRIPTION || ''
});

const buildItemTree = (records = []) => {
  const map = new Map();
  records.forEach((row) => {
    map.set(row.ID, { ...formatItem(row), children: [] });
  });
  const roots = [];
  const sortFn = (a, b) => (a.sortCode || 0) - (b.sortCode || 0);
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  const walk = (children = []) => {
    children.sort(sortFn);
    children.forEach((c) => walk(c.children));
  };
  walk(roots);
  return roots;
};

exports.items = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  try {
    const rows = await itemService.getDT(current);
    res.json({ success: true, data: buildItemTree(rows || []) });
  } catch (error) {
    console.error('[DataItemAdmin.items]', error);
    res.status(500).json({ success: false, message: '获取字典分类失败' });
  }
};

exports.itemDetails = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const itemId = req.query.itemId || '';
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(200, parsePositive(req.query.pageSize, 20));
  const keyword = normalize(req.query.keyword);
  const where = { DELETEMARK: 0 };
  if (itemId) where.ITEMID = itemId;
  if (keyword) {
    where.OR = [
      { FULLNAME: { contains: keyword } },
      { CODE: { contains: keyword } },
      { ITEMVALUE: { contains: keyword } },
      { DESCRIPTION: { contains: keyword } }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      prisma.ciitemdetails.count({ where }),
      prisma.ciitemdetails.findMany({
        where,
        orderBy: [{ SORTCODE: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatItemDetail), total, page, pageSize });
  } catch (error) {
    console.error('[DataItemAdmin.itemDetails]', error);
    res.status(500).json({ success: false, message: '获取字典明细失败' });
  }
};

exports.createItem = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const payload = req.body || {};
  const code = normalize(payload.code);
  const fullName = normalize(payload.fullName);
  if (!code || !fullName) {
    return res.status(400).json({ success: false, message: '编码与名称不能为空' });
  }
  try {
    const now = new Date();
    const entity = {
      ID: randomUUID(),
      PARENTID: payload.parentId || null,
      CODE: code,
      FULLNAME: fullName,
      DESCRIPTION: normalize(payload.description) || null,
      SORTCODE: numberOrNull(payload.sortCode),
      ISTREE: boolToInt(payload.isTree, 0),
      ALLOWEDIT: boolToInt(payload.allowEdit, 1),
      ALLOWDELETE: boolToInt(payload.allowDelete, 1),
      ENABLED: boolToInt(payload.enabled, 1),
      DELETEMARK: 0,
      CREATEON: now,
      CREATEUSERID: current?.Id || null,
      CREATEBY: current?.RealName || null,
      MODIFIEDON: now,
      MODIFIEDUSERID: current?.Id || null,
      MODIFIEDBY: current?.RealName || null
    };
    await prisma.ciitems.create({ data: entity });
    res.json({ success: true, message: '字典分类已创建', data: formatItem(entity) });
  } catch (error) {
    console.error('[DataItemAdmin.createItem]', error);
    res.status(500).json({ success: false, message: '新增字典分类失败' });
  }
};

exports.updateItem = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少分类主键' });
  const payload = req.body || {};
  const code = normalize(payload.code);
  const fullName = normalize(payload.fullName);
  if (!code || !fullName) {
    return res.status(400).json({ success: false, message: '编码与名称不能为空' });
  }
  try {
    const existing = await prisma.ciitems.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '分类不存在' });
    }
    await prisma.ciitems.update({
      where: { ID: id },
      data: {
        CODE: code,
        FULLNAME: fullName,
        PARENTID: payload.parentId || null,
        DESCRIPTION: normalize(payload.description) || null,
        SORTCODE: numberOrNull(payload.sortCode),
        ISTREE: boolToInt(payload.isTree, existing.ISTREE),
        ALLOWEDIT: boolToInt(payload.allowEdit, existing.ALLOWEDIT),
        ALLOWDELETE: boolToInt(payload.allowDelete, existing.ALLOWDELETE),
        ENABLED: boolToInt(payload.enabled, existing.ENABLED),
        MODIFIEDON: new Date(),
        MODIFIEDBY: current?.RealName || null,
        MODIFIEDUSERID: current?.Id || null
      }
    });
    const updated = await prisma.ciitems.findUnique({ where: { ID: id } });
    res.json({ success: true, message: '分类已更新', data: formatItem(updated) });
  } catch (error) {
    console.error('[DataItemAdmin.updateItem]', error);
    res.status(500).json({ success: false, message: '更新分类失败' });
  }
};

exports.deleteItem = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少分类主键' });
  try {
    const result = await prisma.ciitems.updateMany({ where: { ID: id, DELETEMARK: 0 }, data: { DELETEMARK: 1 } });
    if (!result.count) {
      return res.status(404).json({ success: false, message: '分类不存在或已删除' });
    }
    res.json({ success: true, message: '分类已删除' });
  } catch (error) {
    console.error('[DataItemAdmin.deleteItem]', error);
    res.status(500).json({ success: false, message: '删除分类失败' });
  }
};

exports.createDetail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const payload = req.body || {};
  const itemId = payload.itemId || '';
  const code = normalize(payload.code);
  const fullName = normalize(payload.fullName);
  if (!itemId || !code || !fullName) {
    return res.status(400).json({ success: false, message: '所属分类、编码与名称不能为空' });
  }
  try {
    const now = new Date();
    const entity = {
      ID: randomUUID(),
      ITEMID: itemId,
      CODE: code,
      FULLNAME: fullName,
      ITEMVALUE: normalize(payload.value),
      ISDEFAULT: boolToInt(payload.isDefault, 0),
      ALLOWEDIT: boolToInt(payload.allowEdit, 1),
      ALLOWDELETE: boolToInt(payload.allowDelete, 1),
      ENABLED: boolToInt(payload.enabled, 1),
      SORTCODE: numberOrNull(payload.sortCode),
      DESCRIPTION: normalize(payload.description) || null,
      DELETEMARK: 0,
      CREATEON: now,
      CREATEBY: current?.RealName || null,
      CREATEUSERID: current?.Id || null,
      MODIFIEDON: now,
      MODIFIEDBY: current?.RealName || null,
      MODIFIEDUSERID: current?.Id || null
    };
    await prisma.ciitemdetails.create({ data: entity });
    res.json({ success: true, message: '字典明细已创建', data: formatItemDetail(entity) });
  } catch (error) {
    console.error('[DataItemAdmin.createDetail]', error);
    res.status(500).json({ success: false, message: '新增字典明细失败' });
  }
};

exports.updateDetail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少明细主键' });
  const payload = req.body || {};
  const code = normalize(payload.code);
  const fullName = normalize(payload.fullName);
  if (!code || !fullName) {
    return res.status(400).json({ success: false, message: '编码与名称不能为空' });
  }
  try {
    const existing = await prisma.ciitemdetails.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '明细不存在' });
    }
    await prisma.ciitemdetails.update({
      where: { ID: id },
      data: {
        CODE: code,
        FULLNAME: fullName,
        ITEMVALUE: normalize(payload.value),
        ISDEFAULT: boolToInt(payload.isDefault, existing.ISDEFAULT),
        ALLOWEDIT: boolToInt(payload.allowEdit, existing.ALLOWEDIT),
        ALLOWDELETE: boolToInt(payload.allowDelete, existing.ALLOWDELETE),
        ENABLED: boolToInt(payload.enabled, existing.ENABLED),
        SORTCODE: numberOrNull(payload.sortCode),
        DESCRIPTION: normalize(payload.description) || null,
        MODIFIEDON: new Date(),
        MODIFIEDBY: current?.RealName || null,
        MODIFIEDUSERID: current?.Id || null
      }
    });
    const updated = await prisma.ciitemdetails.findUnique({ where: { ID: id } });
    res.json({ success: true, message: '明细已更新', data: formatItemDetail(updated) });
  } catch (error) {
    console.error('[DataItemAdmin.updateDetail]', error);
    res.status(500).json({ success: false, message: '更新字典明细失败' });
  }
};

exports.deleteDetail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少明细主键' });
  try {
    const result = await prisma.ciitemdetails.updateMany({ where: { ID: id, DELETEMARK: 0 }, data: { DELETEMARK: 1 } });
    if (!result.count) {
      return res.status(404).json({ success: false, message: '明细不存在或已删除' });
    }
    res.json({ success: true, message: '明细已删除' });
  } catch (error) {
    console.error('[DataItemAdmin.deleteDetail]', error);
    res.status(500).json({ success: false, message: '删除字典明细失败' });
  }
};
