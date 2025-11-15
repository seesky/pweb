'use strict';

const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { UserService } = require('../services/base/user_service');
const { UserRoleService } = require('../services/base/user_role_service');
const { ModuleService } = require('../services/base/module_service');

const prisma = new PrismaClient();
const userService = new UserService(prisma);
const userRoleService = new UserRoleService(prisma);
const moduleService = new ModuleService(prisma);

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return current;
};

const normalizePositive = (value, fallback) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

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

exports.list = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const page = normalizePositive(req.query.page, 1);
  const pageSize = normalizePositive(req.query.pageSize, 10);
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
    res.status(500).json({ success: false, message: '获取用户失败' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少用户主键' });
  }
  try {
    const entity = await userService.getEntity(user, id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '用户不存在' });
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
    res.status(500).json({ success: false, message: '获取权限详情失败' });
  }
};
