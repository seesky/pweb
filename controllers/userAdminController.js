'use strict';

const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { UserService } = require('../services/base/user_service');
const { UserOrganizeService } = require('../services/base/user_organize_service');
const { OrganizeService } = require('../services/base/organize_service');

const userService = new UserService();
const userOrganizeService = new UserOrganizeService();
const organizeService = new OrganizeService();

const boolToInt = (value, defaultValue = 0) => (value ? 1 : defaultValue);
const parseNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const sanitize = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return value;
};

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return user;
};

const applyKeywordFilter = (records = [], keyword) => {
  if (!keyword) {
    return records;
  }
  const normalized = keyword.toLowerCase();
  return records.filter((item) => {
    const values = [
      item.USERNAME,
      item.REALNAME,
      item.CODE,
      item.MOBILE,
      item.EMAIL
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    return values.some((v) => v.includes(normalized));
  });
};

const buildCreateEntity = (body, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    USERNAME: body.userName,
    REALNAME: sanitize(body.realName),
    CODE: sanitize(body.code),
    MOBILE: sanitize(body.mobile),
    EMAIL: sanitize(body.email),
    DEPARTMENTID: sanitize(body.organizeId),
    ENABLED: boolToInt(body.enabled ?? true, 1),
    ISDIMISSION: boolToInt(body.isDimission, 0),
    DELETEMARK: 0,
    ISVISIBLE: 1,
    ISSTAFF: 1,
    SORTCODE: parseNumber(body.sortCode),
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
    USERNAME: body.userName,
    REALNAME: sanitize(body.realName),
    CODE: sanitize(body.code),
    MOBILE: sanitize(body.mobile),
    EMAIL: sanitize(body.email),
    DEPARTMENTID: sanitize(body.organizeId),
    ENABLED: boolToInt(body.enabled ?? true, 1),
    ISDIMISSION: boolToInt(body.isDimission, 0),
    SORTCODE: parseNumber(body.sortCode),
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

const formatUser = (entity) => ({
  id: entity.ID,
  userName: entity.USERNAME || '',
  realName: entity.REALNAME || '',
  code: entity.CODE || '',
  mobile: entity.MOBILE || '',
  email: entity.EMAIL || '',
  enabled: entity.ENABLED === 1,
  isDimission: entity.ISDIMISSION === 1,
  organizeId: entity.DEPARTMENTID || entity.COMPANYID || null,
  organizeName:
    entity.DEPARTMENTNAME ||
    entity.SUBDEPARTMENTNAME ||
    entity.COMPANYNAME ||
    entity.SUBCOMPANYNAME ||
    entity.WORKGROUPNAME ||
    '',
  sortCode: entity.SORTCODE || 0
});

exports.list = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { organizeId, keyword } = req.query || {};
  try {
    let records = [];
    if (organizeId) {
      records = await userOrganizeService.getDepartmentUsers(organizeId, true);
    } else {
      records = await userService.getDT(user);
    }
    records = (records || []).filter((row) => row.DELETEMARK === 0);
    const filtered = applyKeywordFilter(records, keyword);
    res.json({ success: true, data: filtered.map(formatUser) });
  } catch (error) {
    console.error('[UserAdminController.list]', error);
    res.status(500).json({ success: false, message: '获取用户数据失败' });
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
    res.json({ success: true, data: formatUser(entity) });
  } catch (error) {
    console.error('[UserAdminController.detail]', error);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.userName) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await userService.addUser(user, entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增用户失败' });
    }
    const created = await userService.getEntity(user, returnValue);
    res.json({ success: true, message: returnMessage, data: formatUser(created) });
  } catch (error) {
    console.error('[UserAdminController.create]', error);
    res.status(500).json({ success: false, message: '新增用户时发生错误' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少用户主键' });
  }
  const payload = req.body || {};
  try {
    const entity = await userService.getEntity(user, id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const data = buildUpdateEntity(payload, user);
    const { returnCode, returnMessage } = await userService.updateUser(user, { ID: id, ...data });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新用户失败' });
    }
    const updated = await userService.getEntity(user, id);
    res.json({ success: true, message: returnMessage, data: formatUser(updated) });
  } catch (error) {
    console.error('[UserAdminController.update]', error);
    res.status(500).json({ success: false, message: '更新用户时发生错误' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少用户主键' });
  }
  try {
    const success = await userService.setDeleted(user, [id]);
    if (!success) {
      return res.status(400).json({ success: false, message: '删除用户失败' });
    }
    res.json({ success: true, message: '用户已删除' });
  } catch (error) {
    console.error('[UserAdminController.remove]', error);
    res.status(500).json({ success: false, message: '删除用户时发生错误' });
  }
};

exports.organizes = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  try {
    const list = await organizeService.getDT();
    const data = (list || []).map((org) => ({
      id: org.ID,
      parentId: org.PARENTID,
      fullName: org.FULLNAME || org.SHORTNAME || org.CODE,
      code: org.CODE,
      category: org.CATEGORY,
      enabled: org.ENABLED === 1,
      sortCode: org.SORTCODE || 0
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[UserAdminController.organizes]', error);
    res.status(500).json({ success: false, message: '获取组织数据失败' });
  }
};
