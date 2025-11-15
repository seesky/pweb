'use strict';

const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { OrganizeService } = require('../services/base/organize_service');

const organizeService = new OrganizeService();

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话超时' });
    return null;
  }
  return current;
};

const formatOrganize = (entity) => ({
  id: entity.ID,
  parentId: entity.PARENTID,
  fullName: entity.FULLNAME || '',
  shortName: entity.SHORTNAME || '',
  code: entity.CODE || '',
  category: entity.CATEGORY || '',
  description: entity.DESCRIPTION || '',
  enabled: entity.ENABLED === 1,
  sortCode: entity.SORTCODE || 0
});

const buildCreateEntity = (body, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    PARENTID: body.parentId || null,
    FULLNAME: body.fullName,
    SHORTNAME: body.shortName || null,
    CODE: body.code || null,
    CATEGORY: body.category || null,
    DESCRIPTION: body.description || null,
    SORTCODE: body.sortCode ?? null,
    ENABLED: body.enabled ? 1 : 0,
    DELETEMARK: 0,
    CREATEON: now,
    CREATEUSERID: currentUser?.Id || null,
    CREATEBY: currentUser?.RealName || null,
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

const buildUpdateEntity = (body, currentUser) => {
  const now = new Date();
  return {
    PARENTID: body.parentId || null,
    FULLNAME: body.fullName,
    SHORTNAME: body.shortName || null,
    CODE: body.code || null,
    CATEGORY: body.category || null,
    DESCRIPTION: body.description || null,
    SORTCODE: body.sortCode ?? null,
    ENABLED: body.enabled ? 1 : 0,
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
  try {
    const rows = await organizeService.getDT();
    res.json({ success: true, data: (rows || []).map(formatOrganize) });
  } catch (error) {
    console.error('[OrganizeAdminController.list]', error);
    res.status(500).json({ success: false, message: '获取组织机构失败' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少组织机构主键' });
  }
  try {
    const entity = await organizeService.getEntity(id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '组织机构不存在' });
    }
    res.json({ success: true, data: formatOrganize(entity) });
  } catch (error) {
    console.error('[OrganizeAdminController.detail]', error);
    res.status(500).json({ success: false, message: '获取组织机构信息失败' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.fullName) {
    return res.status(400).json({ success: false, message: '组织名称不能为空' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await organizeService.add(entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增组织失败' });
    }
    const created = await organizeService.getEntity(returnValue);
    res.json({ success: true, message: returnMessage, data: formatOrganize(created) });
  } catch (error) {
    console.error('[OrganizeAdminController.create]', error);
    res.status(500).json({ success: false, message: '新增组织机构失败' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少组织主键' });
  }
  const payload = req.body || {};
  if (!payload.fullName) {
    return res.status(400).json({ success: false, message: '组织名称不能为空' });
  }
  try {
    const entity = await organizeService.getEntity(id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '组织机构不存在' });
    }
    const data = buildUpdateEntity(payload, user);
    const { returnCode, returnMessage } = await organizeService.update({ ID: id, ...data });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新组织失败' });
    }
    const updated = await organizeService.getEntity(id);
    res.json({ success: true, message: returnMessage, data: formatOrganize(updated) });
  } catch (error) {
    console.error('[OrganizeAdminController.update]', error);
    res.status(500).json({ success: false, message: '更新组织机构失败' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少组织主键' });
  }
  try {
    const success = await organizeService.setDeleted([id]);
    if (!success) {
      return res.status(400).json({ success: false, message: '删除组织失败' });
    }
    res.json({ success: true, message: '组织机构已删除' });
  } catch (error) {
    console.error('[OrganizeAdminController.remove]', error);
    res.status(500).json({ success: false, message: '删除组织机构失败' });
  }
};
