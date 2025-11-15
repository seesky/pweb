'use strict';

const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { RoleService } = require('../services/base/role_service');

const roleService = new RoleService();
const CATEGORY_CODE = 'Duty';

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return current;
};

const formatPost = (entity) => ({
  id: entity.ID,
  organizeId: entity.ORGANIZEID || '',
  code: entity.CODE || '',
  realName: entity.REALNAME || '',
  sortCode: entity.SORTCODE || 0,
  enabled: entity.ENABLED === 1,
  allowEdit: entity.ALLOWEDIT === 1,
  allowDelete: entity.ALLOWDELETE === 1,
  description: entity.DESCRIPTION || ''
});

const buildCreateEntity = (payload, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    CATEGORY: CATEGORY_CODE,
    ORGANIZEID: payload.organizeId || null,
    CODE: payload.code || null,
    REALNAME: payload.realName,
    SORTCODE: payload.sortCode ?? null,
    DESCRIPTION: payload.description || null,
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
    CATEGORY: CATEGORY_CODE,
    ORGANIZEID: payload.organizeId || null,
    CODE: payload.code || null,
    REALNAME: payload.realName,
    SORTCODE: payload.sortCode ?? null,
    DESCRIPTION: payload.description || null,
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
  const organizeId = (req.query.organizeId || '').trim();

  const where = { DELETEMARK: 0, CATEGORY: CATEGORY_CODE };
  if (keyword) {
    where.OR = [{ REALNAME: { contains: keyword } }, { CODE: { contains: keyword } }];
  }
  if (organizeId) {
    where.ORGANIZEID = organizeId;
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
    res.json({ success: true, data: rows.map(formatPost), total });
  } catch (error) {
    console.error('[PostAdminController.list]', error);
    res.status(500).json({ success: false, message: '获取岗位失败' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少岗位主键' });
  }
  try {
    const entity = await roleService.getEntity(user, id);
    if (!entity || entity.CATEGORY !== CATEGORY_CODE) {
      return res.status(404).json({ success: false, message: '岗位不存在' });
    }
    res.json({ success: true, data: formatPost(entity) });
  } catch (error) {
    console.error('[PostAdminController.detail]', error);
    res.status(500).json({ success: false, message: '获取岗位信息失败' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.realName) {
    return res.status(400).json({ success: false, message: '岗位名称不能为空' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await roleService.add(user, entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增岗位失败' });
    }
    const created = await roleService.getEntity(user, returnValue);
    res.json({ success: true, message: returnMessage, data: formatPost(created) });
  } catch (error) {
    console.error('[PostAdminController.create]', error);
    res.status(500).json({ success: false, message: '新增岗位时发生错误' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少岗位主键' });
  }
  const payload = req.body || {};
  if (!payload.realName) {
    return res.status(400).json({ success: false, message: '岗位名称不能为空' });
  }
  try {
    const entity = await roleService.getEntity(user, id);
    if (!entity || entity.CATEGORY !== CATEGORY_CODE) {
      return res.status(404).json({ success: false, message: '岗位不存在' });
    }
    const data = buildUpdateEntity(payload, user);
    const { returnCode, returnMessage } = await roleService.update(user, { ID: id, ...data });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新岗位失败' });
    }
    const updated = await roleService.getEntity(user, id);
    res.json({ success: true, message: returnMessage, data: formatPost(updated) });
  } catch (error) {
    console.error('[PostAdminController.update]', error);
    res.status(500).json({ success: false, message: '更新岗位时发生错误' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少岗位主键' });
  }
  try {
    const count = await roleService.setDeleted(user, [id]);
    if (!count) {
      return res.status(400).json({ success: false, message: '删除岗位失败' });
    }
    res.json({ success: true, message: '岗位已删除' });
  } catch (error) {
    console.error('[PostAdminController.remove]', error);
    res.status(500).json({ success: false, message: '删除岗位时发生错误' });
  }
};

exports.move = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  const { organizeId } = req.body || {};
  if (!id || !organizeId) {
    return res.status(400).json({ success: false, message: '缺少岗位或组织参数' });
  }
  try {
    const success = await roleService.moveTo(id, organizeId);
    if (!success) {
      return res.status(400).json({ success: false, message: '移动岗位失败' });
    }
    res.json({ success: true, message: '岗位组织已更新' });
  } catch (error) {
    console.error('[PostAdminController.move]', error);
    res.status(500).json({ success: false, message: '更新岗位组织失败' });
  }
};
