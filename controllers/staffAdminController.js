'use strict';

const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { StaffService } = require('../services/base/staff_service');
const { OrganizeService } = require('../services/base/organize_service');

const staffService = new StaffService();
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

// 针对启用状态，若未传值则沿用原值，避免被默认 1 覆盖
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

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录或会话超时' });
    return null;
  }
  return user;
};

const buildCreateEntity = (body, currentUser) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    CODE: sanitize(body.code),
    REALNAME: sanitize(body.realName),
    USERNAME: sanitize(body.userName),
    GENDER: sanitize(body.gender),
    DUTYID: sanitize(body.dutyId),
    MOBILE: sanitize(body.mobile),
    EMAIL: sanitize(body.email),
    DESCRIPTION: sanitize(body.description),
    SORTCODE: parseNumber(body.sortCode),
    ISDIMISSION: boolToInt(body.isDimission, 0),
    ENABLED: boolToInt(body.enabled, 1),
    DELETEMARK: 0,
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
    CODE: sanitize(body.code),
    REALNAME: sanitize(body.realName),
    USERNAME: sanitize(body.userName),
    GENDER: sanitize(body.gender),
    DUTYID: sanitize(body.dutyId),
    MOBILE: sanitize(body.mobile),
    EMAIL: sanitize(body.email),
    DESCRIPTION: sanitize(body.description),
    SORTCODE: parseNumber(body.sortCode),
    ISDIMISSION: boolToInt(body.isDimission, existing?.ISDIMISSION ?? 0),
    ENABLED: resolveEnabledFlag(body.enabled, existing?.ENABLED ?? 1),
    MODIFIEDON: now,
    MODIFIEDUSERID: currentUser?.Id || null,
    MODIFIEDBY: currentUser?.RealName || null
  };
};

const buildStaffOrganizeMap = async (staffList = []) => {
  if (!staffList.length) {
    return new Map();
  }
  const staffIds = staffList.map((item) => item.ID);
  const relations = await staffService.prisma.pistafforganize.findMany({
    where: { STAFFID: { in: staffIds }, DELETEMARK: 0 },
    select: { STAFFID: true, ORGANIZEID: true }
  });
  if (!relations.length) {
    return new Map();
  }
  const organizeIds = [
    ...new Set(relations.map((row) => row.ORGANIZEID).filter((value) => Boolean(value)))
  ];
  let organizeMap = new Map();
  if (organizeIds.length) {
    const organizes = await organizeService.getDTByIds(organizeIds);
    organizeMap = new Map(
      organizes.map((org) => [org.ID, org.FULLNAME || org.SHORTNAME || org.CODE || ''])
    );
  }
  const relationMap = new Map();
  relations.forEach((row) => {
    relationMap.set(row.STAFFID, {
      ORGANIZEID: row.ORGANIZEID,
      ORGANIZENAME: organizeMap.get(row.ORGANIZEID) || ''
    });
  });
  return relationMap;
};

const parsePositive = (value, fallback = 1) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const formatStaff = (entity, relationMap) => {
  const relation = relationMap?.get(entity.ID) || {};
  return {
    id: entity.ID,
    code: entity.CODE || '',
    realName: entity.REALNAME || '',
    userName: entity.USERNAME || '',
    gender: entity.GENDER || '',
    dutyId: entity.DUTYID || '',
    mobile: entity.MOBILE || '',
    email: entity.EMAIL || '',
    description: entity.DESCRIPTION || '',
    sortCode: entity.SORTCODE || 0,
    enabled: entity.ENABLED === 1,
    isDimission: entity.ISDIMISSION === 1,
    organizeId: relation.ORGANIZEID || null,
    organizeName: relation.ORGANIZENAME || '',
    createdOn: entity.CREATEON,
    modifiedOn: entity.MODIFIEDON
  };
};

const applyKeywordFilter = (records = [], keyword) => {
  if (!keyword) {
    return records;
  }
  const normalized = keyword.toLowerCase();
  return records.filter((item) => {
    const sources = [
      item?.REALNAME,
      item?.USERNAME,
      item?.CODE,
      item?.MOBILE,
      item?.EMAIL
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return sources.some((value) => value.includes(normalized));
  });
};

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
      records = await staffService.getDTByOrganize(user, organizeId, true);
    } else {
      records = await staffService.getDT(user);
    }
    records = (records || []).filter((row) => row.DELETEMARK === 0);
    const filtered = applyKeywordFilter(records, keyword);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);
    const relationMap = await buildStaffOrganizeMap(pageItems);
    const data = pageItems.map((record) => formatStaff(record, relationMap));
    res.json({ success: true, data, total, page, pageSize });
  } catch (error) {
    console.error('[StaffAdminController.list]', error);
    res.status(500).json({ success: false, message: '获取员工数据失败' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少员工主键' });
  }
  try {
    const existing = await staffService.getEntity(user, id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '员工不存在' });
    }
    const relationMap = await buildStaffOrganizeMap([existing]);
    res.json({ success: true, data: formatStaff(existing, relationMap) });
  } catch (error) {
    console.error('[StaffAdminController.detail]', error);
    res.status(500).json({ success: false, message: '获取员工信息失败' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.realName) {
    return res.status(400).json({ success: false, message: '员工姓名不能为空' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await staffService.add(
      user,
      entity,
      payload.organizeId || ''
    );
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增员工失败' });
    }
    const created = await staffService.getEntity(user, returnValue);
    const relationMap = await buildStaffOrganizeMap([created]);
    res.json({ success: true, message: returnMessage, data: formatStaff(created, relationMap) });
  } catch (error) {
    console.error('[StaffAdminController.create]', error);
    res.status(500).json({ success: false, message: '新增员工时发生错误' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少员工主键' });
  }
  const payload = req.body || {};
  try {
    const existing = await staffService.getEntity(user, id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '员工不存在' });
    }
    const data = buildUpdateEntity(payload, user, existing);
    const { returnCode, returnMessage } = await staffService.updateStaff(user, {
      ID: id,
      ...data
    });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新员工失败' });
    }
    if (payload.organizeId) {
      await staffService.moveTo(user, id, payload.organizeId);
    }
    const updated = await staffService.getEntity(user, id);
    const relationMap = await buildStaffOrganizeMap([updated]);
    res.json({ success: true, message: returnMessage, data: formatStaff(updated, relationMap) });
  } catch (error) {
    console.error('[StaffAdminController.update]', error);
    res.status(500).json({ success: false, message: '更新员工时发生错误' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少员工主键' });
  }
  try {
    const result = await staffService.setDeleted(user, [id]);
    if (!result) {
      return res.status(400).json({ success: false, message: '删除员工失败' });
    }
    res.json({ success: true, message: '员工已删除' });
  } catch (error) {
    console.error('[StaffAdminController.remove]', error);
    res.status(500).json({ success: false, message: '删除员工时发生错误' });
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
    return res.status(400).json({ success: false, message: '缺少员工或组织参数' });
  }
  try {
    const success = await staffService.moveTo(user, id, organizeId);
    if (!success) {
      return res.status(400).json({ success: false, message: '移动员工失败' });
    }
    res.json({ success: true, message: '员工组织已更新' });
  } catch (error) {
    console.error('[StaffAdminController.move]', error);
    res.status(500).json({ success: false, message: '更新员工组织失败' });
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
    console.error('[StaffAdminController.organizes]', error);
    res.status(500).json({ success: false, message: '获取组织数据失败' });
  }
};
