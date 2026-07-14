'use strict';

const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { RoleService } = require('../services/base/role_service');
const { ModuleService } = require('../services/base/module_service');
const { PermissionItemService } = require('../services/base/permission_item_service');
const { RolePermission } = require('../services/permission/role_permission');

const prisma = new PrismaClient();
const roleService = new RoleService(prisma);
const moduleService = new ModuleService(prisma);
const permissionItemService = new PermissionItemService(prisma);
const rolePermissionService = new RolePermission(prisma);

const MODULE_SCOPE_CODE = 'Resource.AccessPermission';
const formatRole = (entity) => ({
  id: entity.ID,
  code: entity.CODE || '',
  realName: entity.REALNAME || '',
  category: entity.CATEGORY || '',
  enabled: entity.ENABLED === 1,
  allowEdit: entity.ALLOWEDIT === 1,
  allowDelete: entity.ALLOWDELETE === 1,
  sortCode: entity.SORTCODE || 0,
  description: entity.DESCRIPTION || ''
});

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

const uniq = (items = []) => [...new Set(items.filter(Boolean))];

const buildTree = (records = []) => {
  const nodes = new Map();
  records.forEach((item) => {
    nodes.set(item.ID, {
      id: item.ID,
      parentId: item.PARENTID || null,
      name: item.FULLNAME || item.CODE || '未命名',
      code: item.CODE || '',
      sortCode: item.SORTCODE || 0,
      children: []
    });
  });
  const roots = [];
  const sortFn = (a, b) => {
    const delta = (a.sortCode || 0) - (b.sortCode || 0);
    if (delta !== 0) {
      return delta;
    }
    return a.name.localeCompare(b.name);
  };
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  const walk = (children = []) => {
    children.sort(sortFn);
    children.forEach((child) => walk(child.children));
  };
  walk(roots);
  return roots;
};

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(50, parsePositive(req.query.pageSize, 10));
  const keyword = (req.query.keyword || '').trim();

  const where = { DELETEMARK: 0 };
  if (keyword) {
    where.OR = [
      { REALNAME: { contains: keyword } },
      { CODE: { contains: keyword } },
      { DESCRIPTION: { contains: keyword } }
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      prisma.pirole.count({ where }),
      prisma.pirole.findMany({
        where,
        orderBy: [{ SORTCODE: 'asc' }, { REALNAME: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatRole), total, page, pageSize });
  } catch (error) {
    console.error('[RolePermissionAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取角色失败' });
  }
};

exports.modules = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const rows = await moduleService.getDT();
    res.json({ success: true, data: buildTree(rows || []) });
  } catch (error) {
    console.error('[RolePermissionAdmin.modules]', error);
    res.status(500).json({ success: false, message: '获取模块数据失败' });
  }
};

exports.permissionItems = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const rows = await permissionItemService.getDT();
    res.json({ success: true, data: buildTree(rows || []) });
  } catch (error) {
    console.error('[RolePermissionAdmin.permissionItems]', error);
    res.status(500).json({ success: false, message: '获取操作权限项失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少角色主键' });
  }
  try {
    const entity = await prisma.pirole.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }
    const moduleIds = await rolePermissionService
      .getScopeModuleIdsByRoleId(id, MODULE_SCOPE_CODE)
      .then((rows) => rows.map((row) => row.TARGETID));
    const permissionItemIds = await rolePermissionService
      .getRolePermissionItemIds(id)
      .then((rows) => rows.map((row) => row.PERMISSIONID));

    const [modules, permissionItems] = await Promise.all([
      moduleIds.length
        ? prisma.pimodule.findMany({
            where: { ID: { in: moduleIds } },
            select: { ID: true, FULLNAME: true, CODE: true }
          })
        : [],
      permissionItemIds.length
        ? prisma.pipermissionitem.findMany({
            where: { ID: { in: permissionItemIds } },
            select: { ID: true, FULLNAME: true, CODE: true }
          })
        : []
    ]);

    res.json({
      success: true,
      data: {
        role: formatRole(entity),
        moduleIds,
        permissionItemIds,
        modules: modules.map((item) => ({
          id: item.ID,
          name: item.FULLNAME || item.CODE || ''
        })),
        permissionItems: permissionItems.map((item) => ({
          id: item.ID,
          name: item.FULLNAME || item.CODE || ''
        }))
      }
    });
  } catch (error) {
    console.error('[RolePermissionAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取角色权限详情失败' });
  }
};

exports.updateModules = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少角色主键' });
  }
  const moduleIds = uniq(Array.isArray(req.body?.moduleIds) ? req.body.moduleIds : []);
  try {
    const role = await prisma.pirole.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!role) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }
    const existing = await rolePermissionService
      .getScopeModuleIdsByRoleId(id, MODULE_SCOPE_CODE)
      .then((rows) => rows.map((row) => row.TARGETID));
    if (existing.length) {
      await rolePermissionService.revokeRoleModuleScope(id, MODULE_SCOPE_CODE, existing);
    }
    if (moduleIds.length) {
      await rolePermissionService.grantRoleModuleScope(current, id, MODULE_SCOPE_CODE, moduleIds);
    }
    res.json({ success: true, message: '模块权限已更新', data: moduleIds });
  } catch (error) {
    console.error('[RolePermissionAdmin.updateModules]', error);
    res.status(500).json({ success: false, message: '保存模块权限失败' });
  }
};

exports.updatePermissionItems = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少角色主键' });
  }
  const permissionItemIds = uniq(Array.isArray(req.body?.permissionItemIds) ? req.body.permissionItemIds : []);
  try {
    const role = await prisma.pirole.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!role) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }
    const existing = await rolePermissionService
      .getRolePermissionItemIds(id)
      .then((rows) => rows.map((row) => row.PERMISSIONID));
    if (existing.length) {
      await rolePermissionService.revokeRolePermissions([id], existing);
    }
    if (permissionItemIds.length) {
      await rolePermissionService.grantRolePermissions(current, [id], permissionItemIds);
    }
    res.json({ success: true, message: '操作权限已更新', data: permissionItemIds });
  } catch (error) {
    console.error('[RolePermissionAdmin.updatePermissionItems]', error);
    res.status(500).json({ success: false, message: '保存操作权限失败' });
  }
};
