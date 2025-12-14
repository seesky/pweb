'use strict';

const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { UserService } = require('../services/base/user_service');
const { UserRoleService } = require('../services/base/user_role_service');
const { ModuleService } = require('../services/base/module_service');
const { PermissionItemService } = require('../services/base/permission_item_service');
const { UserPermission } = require('../services/permission/user_permission');

const prisma = new PrismaClient();
const userService = new UserService(prisma);
const userRoleService = new UserRoleService(prisma);
const moduleService = new ModuleService(prisma);
const permissionItemService = new PermissionItemService(prisma);
const userPermissionService = new UserPermission(prisma);

const MODULE_SCOPE_CODE = 'Resource.AccessPermission';
const ORGANIZE_SCOPE_CODE = 'Resource.ManagePermission';

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: 'Login expired.' });
    return null;
  }
  return current;
};

const parsePositive = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const uniq = (list = []) => [...new Set(list.filter(Boolean))];

const formatUser = (entity) => ({
  id: entity.ID,
  userName: entity.USERNAME || '',
  realName: entity.REALNAME || '',
  code: entity.CODE || '',
  mobile: entity.MOBILE || '',
  email: entity.EMAIL || '',
  enabled: entity.ENABLED === 1,
  sortCode: entity.SORTCODE || 0
});

const toTree = (rows = [], { idField = 'ID', parentField = 'PARENTID', nameField = 'FULLNAME', codeField = 'CODE' } = {}) => {
  const nodes = new Map();
  const roots = [];
  rows.forEach((row) => {
    nodes.set(row[idField], {
      id: row[idField],
      parentId: row[parentField] || null,
      name: row[nameField] || row[codeField] || 'Unnamed',
      code: row[codeField] || '',
      sortCode: row.SORTCODE || 0,
      children: []
    });
  });
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortFn = (a, b) => a.sortCode - b.sortCode;
  const recurse = (children = []) => {
    children.sort(sortFn);
    children.forEach((child) => recurse(child.children));
  };
  recurse(roots);
  return roots;
};

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const page = parsePositive(req.query.page, 1);
  const pageSize = parsePositive(req.query.pageSize, 10);
  const keyword = (req.query.keyword || '').trim();
  const where = { DELETEMARK: 0 };
  if (keyword) {
    where.OR = [
      { USERNAME: { contains: keyword } },
      { REALNAME: { contains: keyword } },
      { CODE: { contains: keyword } }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      userService.prisma.piuser.count({ where }),
      userService.prisma.piuser.findMany({
        where,
        orderBy: { SORTCODE: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatUser), total });
  } catch (error) {
    console.error('[UserPermissionAdmin.list]', error);
    res.status(500).json({ success: false, message: 'Failed to load users.' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing user id.' });
  }
  try {
    const entity = await userService.getEntity(current, id);
    if (!entity) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const roleIds = await userRoleService.getAllRoleIds(id);
    const roles = roleIds.length
      ? await prisma.pirole.findMany({
          where: { ID: { in: roleIds } },
          select: { ID: true, REALNAME: true, CODE: true }
        })
      : [];
    const modules = await moduleService
      .getDTByUser(id)
      .catch(() => [])
      .then((items) =>
        (items || []).map((row) => ({
          id: row.ID,
          code: row.CODE,
          name: row.FULLNAME
        }))
      );
    const directPermissions = await prisma.pipermission.findMany({
      where: {
        RESOURCECATEGORY: 'PIUSER',
        RESOURCEID: id,
        DELETEMARK: 0,
        ENABLED: 1
      },
      select: { PERMISSIONID: true }
    });
    const permissionItemIds = directPermissions.map((item) => item.PERMISSIONID);
    const permissionItems = permissionItemIds.length
      ? await prisma.pipermissionitem.findMany({
          where: { ID: { in: permissionItemIds } },
          select: { ID: true, CODE: true, FULLNAME: true }
        })
      : [];
    res.json({
      success: true,
      data: {
        user: formatUser(entity),
        roles,
        modules,
        permissionItems
      }
    });
  } catch (error) {
    console.error('[UserPermissionAdmin.detail]', error);
    res.status(500).json({ success: false, message: 'Failed to load permission detail.' });
  }
};

exports.roles = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const roles = await prisma.pirole.findMany({
      where: { DELETEMARK: 0, ENABLED: 1 },
      orderBy: { SORTCODE: 'asc' }
    });
    res.json({
      success: true,
      data: roles.map((role) => ({
        id: role.ID,
        name: role.REALNAME || role.FULLNAME || role.CODE || 'Unnamed',
        code: role.CODE || ''
      }))
    });
  } catch (error) {
    console.error('[UserPermissionAdmin.roles]', error);
    res.status(500).json({ success: false, message: 'Failed to load roles.' });
  }
};

exports.modules = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const modules = await moduleService.getDT();
    res.json({
      success: true,
      data: toTree(modules, { idField: 'ID', parentField: 'PARENTID', nameField: 'FULLNAME', codeField: 'CODE' })
    });
  } catch (error) {
    console.error('[UserPermissionAdmin.modules]', error);
    res.status(500).json({ success: false, message: 'Failed to load modules.' });
  }
};

exports.permissionItems = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const items = await prisma.pipermissionitem.findMany({
      where: { DELETEMARK: 0, ENABLED: 1 },
      orderBy: { SORTCODE: 'asc' }
    });
    res.json({
      success: true,
      data: toTree(items, { idField: 'ID', parentField: 'PARENTID', nameField: 'FULLNAME', codeField: 'CODE' })
    });
  } catch (error) {
    console.error('[UserPermissionAdmin.permissionItems]', error);
    res.status(500).json({ success: false, message: 'Failed to load permission items.' });
  }
};

exports.updateRoles = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing user id.' });
  }
  const primaryRoleId = req.body?.primaryRoleId || null;
  const extraRoleIds = uniq(Array.isArray(req.body?.extraRoleIds) ? req.body.extraRoleIds : []).filter((roleId) => roleId && roleId !== primaryRoleId);
  try {
    const target = await prisma.piuser.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    await prisma.$transaction(async () => {
      await userRoleService.setDefaultRole(id, primaryRoleId);
      await userRoleService.clearUserRole(id);
      for (const roleId of extraRoleIds) {
        await userRoleService.addUserToRole(current, id, roleId);
      }
    });
    res.json({
      success: true,
      message: 'Roles updated.',
      data: { primaryRoleId, extraRoleIds }
    });
  } catch (error) {
    console.error('[UserPermissionAdmin.updateRoles]', error);
    res.status(500).json({ success: false, message: 'Failed to save roles.' });
  }
};

exports.updateModules = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing user id.' });
  }
  const moduleIds = uniq(Array.isArray(req.body?.moduleIds) ? req.body.moduleIds : []);
  try {
    const target = await prisma.piuser.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    await userPermissionService.setUserModuleScope(current, id, MODULE_SCOPE_CODE, moduleIds);
    res.json({ success: true, message: 'Module permissions updated.', data: moduleIds });
  } catch (error) {
    console.error('[UserPermissionAdmin.updateModules]', error);
    res.status(500).json({ success: false, message: 'Failed to update module permissions.' });
  }
};

exports.updatePermissionItems = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing user id.' });
  }
  const permissionItemIds = uniq(Array.isArray(req.body?.permissionItemIds) ? req.body.permissionItemIds : []);
  try {
    const target = await prisma.piuser.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const existing = await userPermissionService.getUserPermissionItemIds(id).then((rows) => rows.map((row) => row.PERMISSIONID));
    if (existing.length) {
      await userPermissionService.revokeUserPermissions([id], existing);
    }
    if (permissionItemIds.length) {
      await userPermissionService.grantUserPermissions(current, [id], permissionItemIds);
    }
    res.json({ success: true, message: 'Operation permissions updated.', data: permissionItemIds });
  } catch (error) {
    console.error('[UserPermissionAdmin.updatePermissionItems]', error);
    res.status(500).json({ success: false, message: 'Failed to update operation permissions.' });
  }
};
exports.organizes = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const rows = await prisma.piorganize.findMany({
      where: { DELETEMARK: 0 },
      orderBy: { SORTCODE: 'asc' }
    });
    res.json({
      success: true,
      data: toTree(rows, { idField: 'ID', parentField: 'PARENTID', nameField: 'FULLNAME', codeField: 'CODE' })
    });
  } catch (error) {
    console.error('[UserPermissionAdmin.organizes]', error);
    res.status(500).json({ success: false, message: 'Failed to load organizes.' });
  }
};

exports.organizeScope = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing user id.' });
  }
  try {
    const scopeIds = await userPermissionService
      .getScopeOrganizeIdsByUserId(id, ORGANIZE_SCOPE_CODE)
      .then((rows) => rows.map((row) => row.TARGETID));
    res.json({ success: true, data: scopeIds });
  } catch (error) {
    console.error('[UserPermissionAdmin.organizeScope]', error);
    res.status(500).json({ success: false, message: 'Failed to load organize scope.' });
  }
};

exports.updateOrganizeScope = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing user id.' });
  }
  const organizeIds = uniq(Array.isArray(req.body?.organizeIds) ? req.body.organizeIds : []);
  try {
    const target = await prisma.piuser.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const existing = await userPermissionService
      .getScopeOrganizeIdsByUserId(id, ORGANIZE_SCOPE_CODE)
      .then((rows) => rows.map((row) => row.TARGETID));
    if (existing.length) {
      await userPermissionService.revokeUserOrganizeScope(id, ORGANIZE_SCOPE_CODE, existing);
    }
    if (organizeIds.length) {
      await userPermissionService.grantUserOrganizeScope(id, ORGANIZE_SCOPE_CODE, organizeIds);
    }
    res.json({ success: true, message: 'Organize scope updated.', data: organizeIds });
  } catch (error) {
    console.error('[UserPermissionAdmin.updateOrganizeScope]', error);
    res.status(500).json({ success: false, message: 'Failed to update organize scope.' });
  }
};
