'use strict';

const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { RoleService } = require('../services/base/role_service');

const roleService = new RoleService();

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return current;
};

const formatRole = (entity) => ({
  id: entity.ID,
  organizeId: entity.ORGANIZEID || '',
  code: entity.CODE || '',
  realName: entity.REALNAME || '',
  category: entity.CATEGORY || '',
  enabled: entity.ENABLED === 1,
  allowEdit: entity.ALLOWEDIT === 1,
  allowDelete: entity.ALLOWDELETE === 1,
  sortCode: entity.SORTCODE || 0,
  description: entity.DESCRIPTION || ''
});

const buildCreateEntity = (payload, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    ORGANIZEID: payload.organizeId || null,
    CODE: payload.code || null,
    REALNAME: payload.realName,
    CATEGORY: payload.category || null,
    DESCRIPTION: payload.description || null,
    SORTCODE: payload.sortCode ?? null,
    ENABLED: payload.enabled ? 1 : 0,
    ALLOWEDIT: payload.allowEdit ? 1 : 0,
    ALLOWDELETE: payload.allowDelete ? 1 : 0,
    DELETEMARK: 0,
    CREATEON: now,
    CREATEUSERID: currentUser?.Id || null,
    CREATEBY: currentUser?.RealName || null,
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

const buildUpdateEntity = (payload, currentUser) => {
  const now = new Date();
  return {
    ORGANIZEID: payload.organizeId || null,
    CODE: payload.code || null,
    REALNAME: payload.realName,
    CATEGORY: payload.category || null,
    DESCRIPTION: payload.description || null,
    SORTCODE: payload.sortCode ?? null,
    ENABLED: payload.enabled ? 1 : 0,
    ALLOWEDIT: payload.allowEdit ? 1 : 0,
    ALLOWDELETE: payload.allowDelete ? 1 : 0,
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

exports.list = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);
  const keyword = (req.query.keyword || '').trim();

  const where = { DELETEMARK: 0 };
  if (keyword) {
    where.OR = [
      { REALNAME: { contains: keyword } },
      { CODE: { contains: keyword } },
      { CATEGORY: { contains: keyword } }
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      roleService.prisma.pirole.count({ where }),
      roleService.prisma.pirole.findMany({
        where,
        orderBy: { SORTCODE: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatRole), total });
  } catch (error) {
    console.error('[RoleAdminController.list]', error);
    res.status(500).json({ success: false, message: '获取角色失败' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少角色主键' });
  }
  try {
    const entity = await roleService.getEntity(user, id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }
    res.json({ success: true, data: formatRole(entity) });
  } catch (error) {
    console.error('[RoleAdminController.detail]', error);
    res.status(500).json({ success: false, message: '获取角色信息失败' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.realName) {
    return res.status(400).json({ success: false, message: '角色名称不能为空' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await roleService.add(user, entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增角色失败' });
    }
    const created = await roleService.getEntity(user, returnValue);
    res.json({ success: true, message: returnMessage, data: formatRole(created) });
  } catch (error) {
    console.error('[RoleAdminController.create]', error);
    res.status(500).json({ success: false, message: '新增角色时发生错误' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少角色主键' });
  }
  const payload = req.body || {};
  if (!payload.realName) {
    return res.status(400).json({ success: false, message: '角色名称不能为空' });
  }
  try {
    const entity = await roleService.getEntity(user, id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }
    const data = buildUpdateEntity(payload, user);
    const { returnCode, returnMessage } = await roleService.update(user, { ID: id, ...data });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新角色失败' });
    }
    const updated = await roleService.getEntity(user, id);
    res.json({ success: true, message: returnMessage, data: formatRole(updated) });
  } catch (error) {
    console.error('[RoleAdminController.update]', error);
    res.status(500).json({ success: false, message: '更新角色时发生错误' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少角色主键' });
  }
  try {
    const count = await roleService.setDeleted(user, [id]);
    if (!count) {
      return res.status(400).json({ success: false, message: '删除角色失败' });
    }
    res.json({ success: true, message: '角色已删除' });
  } catch (error) {
    console.error('[RoleAdminController.remove]', error);
    res.status(500).json({ success: false, message: '删除角色时发生错误' });
  }
};
