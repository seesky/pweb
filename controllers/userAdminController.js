'use strict';

const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { UserService } = require('../services/base/user_service');
const { UserOrganizeService } = require('../services/base/user_organize_service');
const { OrganizeService } = require('../services/base/organize_service');

const userService = new UserService();
const userOrganizeService = new UserOrganizeService();
const organizeService = new OrganizeService();

const boolToInt = (value, defaultValue = 0) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return 1;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return 0;
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return defaultValue;
    return value > 0 ? 1 : 0;
  }
  return value ? 1 : 0;
};

// 未传 enabled 时沿用当前值，避免默认 1 覆盖停用
const resolveEnabledFlag = (incoming, current) => {
  if (incoming === undefined || incoming === null) {
    return boolToInt(current, 1);
  }
  return boolToInt(incoming, boolToInt(current, 1));
};

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

const parsePositive = (value, fallback = 1) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '鏈櫥褰曟垨浼氳瘽澶辨晥' });
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
    ENABLED: resolveEnabledFlag(body.enabled, 1),
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

const buildUpdateEntity = (body, currentUser, existing) => {
  const now = new Date();
  return {
    USERNAME: body.userName,
    REALNAME: sanitize(body.realName),
    CODE: sanitize(body.code),
    MOBILE: sanitize(body.mobile),
    EMAIL: sanitize(body.email),
    DEPARTMENTID: sanitize(body.organizeId),
    ENABLED: resolveEnabledFlag(body.enabled, existing?.ENABLED ?? 1),
    ISDIMISSION: boolToInt(body.isDimission, existing?.ISDIMISSION ?? 0),
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
  const page = parsePositive(req.query?.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query?.pageSize, 10));
  try {
    let records = [];
    if (organizeId) {
      records = await userOrganizeService.getDepartmentUsers(organizeId, true);
    } else {
      records = await userService.getDT(user);
    }
    records = (records || []).filter((row) => row.DELETEMARK === 0);
    const filtered = applyKeywordFilter(records, keyword);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const data = filtered.slice(start, start + pageSize).map(formatUser);
    res.json({ success: true, data, total, page, pageSize });
  } catch (error) {
    console.error('[UserAdminController.list]', error);
    res.status(500).json({ success: false, message: '鑾峰彇鐢ㄦ埛鏁版嵁澶辫触' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缂哄皯鐢ㄦ埛涓婚敭' });
  }
  try {
    const entity = await userService.getEntity(user, id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '鐢ㄦ埛涓嶅瓨鍦?' });
    }
    res.json({ success: true, data: formatUser(entity) });
  } catch (error) {
    console.error('[UserAdminController.detail]', error);
    res.status(500).json({ success: false, message: '鑾峰彇鐢ㄦ埛淇℃伅澶辫触' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.userName) {
    return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶄笉鑳戒负绌?' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await userService.addUser(user, entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '鏂板鐢ㄦ埛澶辫触' });
    }
    const created = await userService.getEntity(user, returnValue);
    res.json({ success: true, message: returnMessage, data: formatUser(created) });
  } catch (error) {
    console.error('[UserAdminController.create]', error);
    res.status(500).json({ success: false, message: '鏂板鐢ㄦ埛鏃跺彂鐢熼敊璇?' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缂哄皯鐢ㄦ埛涓婚敭' });
  }
  const payload = req.body || {};
  try {
    const existing = await userService.getEntity(user, id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '鐢ㄦ埛涓嶅瓨鍦?' });
    }
    const data = buildUpdateEntity(payload, user, existing);
    const { returnCode, returnMessage } = await userService.updateUser(user, { ID: id, ...data });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '鏇存柊鐢ㄦ埛澶辫触' });
    }
    const updated = await userService.getEntity(user, id);
    res.json({ success: true, message: returnMessage, data: formatUser(updated) });
  } catch (error) {
    console.error('[UserAdminController.update]', error);
    res.status(500).json({ success: false, message: '鏇存柊鐢ㄦ埛鏃跺彂鐢熼敊璇?' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缂哄皯鐢ㄦ埛涓婚敭' });
  }
  try {
    const success = await userService.setDeleted(user, [id]);
    if (!success) {
      return res.status(400).json({ success: false, message: '鍒犻櫎鐢ㄦ埛澶辫触' });
    }
    res.json({ success: true, message: '鐢ㄦ埛宸插垹闄?' });
  } catch (error) {
    console.error('[UserAdminController.remove]', error);
    res.status(500).json({ success: false, message: '鍒犻櫎鐢ㄦ埛鏃跺彂鐢熼敊璇?' });
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
    res.status(500).json({ success: false, message: '鑾峰彇缁勭粐鏁版嵁澶辫触' });
  }
};
