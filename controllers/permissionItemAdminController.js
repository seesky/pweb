'use strict';

const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { PermissionItemService } = require('../services/base/permission_item_service');
const { ModuleService } = require('../services/base/module_service');

const prisma = new PrismaClient();
const permissionItemService = new PermissionItemService(prisma);
const moduleService = new ModuleService(prisma);

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

const sanitizeId = (value) => {
  if (!value || value === 'null' || value === 'undefined' || value === 'root') {
    return null;
  }
  return value;
};

const toNullableNumber = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());
const toNullableText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
};

const formatPermissionItem = (entity) => ({
  id: entity.ID,
  parentId: entity.PARENTID || null,
  moduleId: entity.MODULEID || null,
  code: entity.CODE || '',
  fullName: entity.FULLNAME || '',
  categoryCode: entity.CATEGORYCODE || '',
  isScope: entity.ISSCOPE === 1,
  isPublic: entity.ISPUBLIC === 1,
  allowEdit: entity.ALLOWEDIT === 1,
  allowDelete: entity.ALLOWDELETE === 1,
  jsEvent: entity.JSEVENT || '',
  isSplit: entity.ISSPLIT === 1,
  enabled: entity.ENABLED === 1,
  sortCode: entity.SORTCODE ?? null,
  description: entity.DESCRIPTION || '',
  createdOn: entity.CREATEON,
  modifiedOn: entity.MODIFIEDON
});

const buildTree = (records = []) => {
  const nodes = new Map();
  records.forEach((row) => {
    nodes.set(row.ID, {
      id: row.ID,
      parentId: row.PARENTID || null,
      name: row.FULLNAME || row.CODE || '未命名',
      code: row.CODE || '',
      sortCode: row.SORTCODE || 0,
      children: []
    });
  });
  const sortFn = (a, b) => {
    const sortDelta = (a.sortCode || 0) - (b.sortCode || 0);
    if (sortDelta !== 0) {
      return sortDelta;
    }
    return a.name.localeCompare(b.name);
  };
  const roots = [];
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortTree = (children = []) => {
    children.sort(sortFn);
    children.forEach((child) => sortTree(child.children));
  };
  sortTree(roots);
  return roots;
};

const buildCreateEntity = (payload, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    PARENTID: sanitizeId(payload.parentId),
    MODULEID: sanitizeId(payload.moduleId),
    CODE: trimText(payload.code),
    FULLNAME: trimText(payload.fullName),
    CATEGORYCODE: trimText(payload.categoryCode) || 'Application',
    JSEVENT: toNullableText(payload.jsEvent),
    ISSCOPE: payload.isScope ? 1 : 0,
    ISPUBLIC: payload.isPublic ? 1 : 0,
    ALLOWEDIT: payload.allowEdit ? 1 : 0,
    ALLOWDELETE: payload.allowDelete ? 1 : 0,
    ISSPLIT: payload.isSplit ? 1 : 0,
    ENABLED: payload.enabled ? 1 : 0,
    SORTCODE: toNullableNumber(payload.sortCode),
    DESCRIPTION: toNullableText(payload.description),
    DELETEMARK: 0,
    CREATEON: now,
    CREATEUSERID: currentUser?.Id || null,
    CREATEBY: currentUser?.RealName || null,
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

const applyUpdateFields = (existing, payload, currentUser) => {
  const now = new Date();
  return {
    ...existing,
    PARENTID: sanitizeId(payload.parentId),
    MODULEID: sanitizeId(payload.moduleId),
    CODE: trimText(payload.code) || existing.CODE,
    FULLNAME: trimText(payload.fullName) || existing.FULLNAME,
    CATEGORYCODE: trimText(payload.categoryCode) || existing.CATEGORYCODE,
    JSEVENT: toNullableText(payload.jsEvent),
    ISSCOPE: payload.isScope ? 1 : 0,
    ISPUBLIC: payload.isPublic ? 1 : 0,
    ALLOWEDIT: payload.allowEdit ? 1 : 0,
    ALLOWDELETE: payload.allowDelete ? 1 : 0,
    ISSPLIT: payload.isSplit ? 1 : 0,
    ENABLED: payload.enabled ? 1 : 0,
    SORTCODE: toNullableNumber(payload.sortCode),
    DESCRIPTION: toNullableText(payload.description),
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 10));
  const keyword = (req.query.keyword || '').trim();
  const parentId = sanitizeId(req.query.parentId);
  const where = { DELETEMARK: 0 };
  if (parentId !== null) {
    where.PARENTID = parentId;
  } else {
    where.PARENTID = null;
  }
  if (keyword) {
    where.OR = [
      { FULLNAME: { contains: keyword, mode: 'insensitive' } },
      { CODE: { contains: keyword, mode: 'insensitive' } },
      { DESCRIPTION: { contains: keyword, mode: 'insensitive' } }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      prisma.pipermissionitem.count({ where }),
      prisma.pipermissionitem.findMany({
        where,
        orderBy: [{ SORTCODE: 'asc' }, { FULLNAME: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    const moduleIds = [...new Set(rows.map((row) => row.MODULEID).filter(Boolean))];
    let moduleLookup = {};
    if (moduleIds.length) {
      const modules = await prisma.pimodule.findMany({
        where: { ID: { in: moduleIds } },
        select: { ID: true, FULLNAME: true, CODE: true }
      });
      moduleLookup = modules.reduce((acc, mod) => {
        acc[mod.ID] = mod;
        return acc;
      }, {});
    }
    const data = rows.map((row) => {
      const formatted = formatPermissionItem(row);
      if (formatted.moduleId && moduleLookup[formatted.moduleId]) {
        formatted.moduleName = moduleLookup[formatted.moduleId].FULLNAME || moduleLookup[formatted.moduleId].CODE || '';
      } else {
        formatted.moduleName = '';
      }
      return formatted;
    });
    res.json({ success: true, data, total, page, pageSize });
  } catch (error) {
    console.error('[PermissionItemAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取操作权限项失败' });
  }
};

exports.tree = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const rows = await permissionItemService.getDT();
    res.json({ success: true, data: buildTree(rows || []) });
  } catch (error) {
    console.error('[PermissionItemAdmin.tree]', error);
    res.status(500).json({ success: false, message: '获取权限项树失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少权限项主键' });
  }
  try {
    const entity = await permissionItemService.getEntity(id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '权限项不存在' });
    }
    res.json({ success: true, data: formatPermissionItem(entity) });
  } catch (error) {
    console.error('[PermissionItemAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取权限项详情失败' });
  }
};

exports.create = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const payload = req.body || {};
  const code = trimText(payload.code);
  const fullName = trimText(payload.fullName);
  if (!code || !fullName) {
    return res.status(400).json({ success: false, message: '编码与名称不能为空' });
  }
  const normalizedPayload = { ...payload, code, fullName };
  try {
    const entity = buildCreateEntity(normalizedPayload, current);
    const { returnCode, returnMessage, returnValue } = await permissionItemService.add(entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增权限项失败' });
    }
    const created = await permissionItemService.getEntity(returnValue);
    res.json({
      success: true,
      message: returnMessage || '操作权限项已创建',
      data: formatPermissionItem(created || entity)
    });
  } catch (error) {
    console.error('[PermissionItemAdmin.create]', error);
    res.status(500).json({ success: false, message: '新增权限项失败' });
  }
};

exports.update = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少权限项主键' });
  }
  const payload = req.body || {};
  try {
    const existing = await permissionItemService.getEntity(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '权限项不存在' });
    }
    const nextCode = trimText(payload.code || existing.CODE);
    const nextName = trimText(payload.fullName || existing.FULLNAME);
    if (!nextCode || !nextName) {
      return res.status(400).json({ success: false, message: '编码与名称不能为空' });
    }
    const entity = applyUpdateFields(existing, { ...payload, code: nextCode, fullName: nextName }, current);
    const { returnCode, returnMessage } = await permissionItemService.update(entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新权限项失败' });
    }
    res.json({
      success: true,
      message: returnMessage || '操作权限项已更新',
      data: formatPermissionItem(entity)
    });
  } catch (error) {
    console.error('[PermissionItemAdmin.update]', error);
    res.status(500).json({ success: false, message: '更新权限项失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少权限项主键' });
  }
  try {
    const success = await permissionItemService.setDeleted([id]);
    if (!success) {
      return res.status(400).json({ success: false, message: '删除权限项失败' });
    }
    res.json({ success: true, message: '操作权限项已删除' });
  } catch (error) {
    console.error('[PermissionItemAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除权限项失败' });
  }
};

exports.move = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  const { parentId } = req.body || {};
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少权限项主键' });
  }
  if (parentId && parentId === id) {
    return res.status(400).json({ success: false, message: '不能移动到自身节点' });
  }
  try {
    const success = await permissionItemService.moveTo(id, sanitizeId(parentId));
    if (!success) {
      return res.status(400).json({ success: false, message: '移动权限项失败' });
    }
    res.json({ success: true, message: '权限项已移动' });
  } catch (error) {
    console.error('[PermissionItemAdmin.move]', error);
    res.status(500).json({ success: false, message: '移动权限项失败' });
  }
};

exports.modules = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const records = await moduleService.getDT();
    const data = (records || []).map((item) => ({
      id: item.ID,
      parentId: item.PARENTID || null,
      name: item.FULLNAME || item.CODE || '未命名模块',
      code: item.CODE || '',
      sortCode: item.SORTCODE || 0
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[PermissionItemAdmin.modules]', error);
    res.status(500).json({ success: false, message: '获取模块列表失败' });
  }
};
