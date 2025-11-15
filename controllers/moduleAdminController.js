'use strict';

const { v4: uuidv4 } = require('uuid');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { ModuleService } = require('../services/base/module_service');

const moduleService = new ModuleService();

const boolToInt = (value, defaultValue = 0) => (value ? 1 : defaultValue);
const normalizeBoolean = (value) => (value ? 1 : 0);
const sanitize = (value) => (value === undefined || value === null || value === '' ? null : value);
const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const formatModule = (entity) => {
  if (!entity) {
    return null;
  }
  return {
    id: entity.ID,
    parentId: entity.PARENTID,
    code: entity.CODE,
    fullName: entity.FULLNAME,
    category: entity.CATEGORY,
    moduleType: entity.MODULETYPE,
    imageIndex: entity.IMAGEINDEX,
    selectedImageIndex: entity.SELECTEDIMAGEINDEX,
    iconCss: entity.ICONCSS,
    iconUrl: entity.ICONURL,
    navigateUrl: entity.NAVIGATEURL,
    mvcNavigateUrl: entity.MVCNAVIGATEURL,
    target: entity.TARGET,
    formName: entity.FORMNAME,
    assemblyName: entity.ASSEMBLYNAME,
    permissionItemCode: entity.PERMISSIONITEMCODE,
    permissionScopeTables: entity.PERMISSIONSCOPETABLES,
    isPublic: entity.ISPUBLIC === 1,
    isMenu: entity.ISMENU === 1,
    expand: entity.EXPAND === 1,
    allowEdit: entity.ALLOWEDIT === 1,
    allowDelete: entity.ALLOWDELETE === 1,
    sortCode: entity.SORTCODE,
    enabled: entity.ENABLED === 1,
    description: entity.DESCRIPTION,
    createdOn: entity.CREATEON,
    createdBy: entity.CREATEBY,
    modifiedOn: entity.MODIFIEDON,
    modifiedBy: entity.MODIFIEDBY
  };
};

const buildTree = (records = []) => {
  const lookup = new Map();
  records.forEach((item) => {
    lookup.set(item.id, { ...item, children: [] });
  });
  const roots = [];
  lookup.forEach((node) => {
    if (node.parentId && lookup.has(node.parentId)) {
      lookup.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录或登录已过期' });
    return null;
  }
  return user;
};

const buildCreateEntity = (body, currentUser) => {
  const now = new Date();
  return {
    ID: uuidv4(),
    PARENTID: sanitize(body.parentId),
    CODE: body.code,
    FULLNAME: body.fullName,
    CATEGORY: body.category,
    MODULETYPE: toNumber(body.moduleType, 6),
    IMAGEINDEX: body.imageIndex || null,
    SELECTEDIMAGEINDEX: body.selectedImageIndex || null,
    ICONCSS: body.iconCss || null,
    ICONURL: body.iconUrl || null,
    NAVIGATEURL: body.navigateUrl || '#',
    MVCNAVIGATEURL: body.mvcNavigateUrl || '#',
    TARGET: body.target || null,
    FORMNAME: body.formName || null,
    ASSEMBLYNAME: body.assemblyName || null,
    PERMISSIONITEMCODE: body.permissionItemCode || 'Resource.AccessPermission',
    PERMISSIONSCOPETABLES: body.permissionScopeTables || null,
    ISPUBLIC: boolToInt(body.isPublic, 0),
    ISMENU: boolToInt(body.isMenu ?? true, 1),
    EXPAND: boolToInt(body.expand, 0),
    ALLOWEDIT: boolToInt(body.allowEdit ?? true, 1),
    ALLOWDELETE: boolToInt(body.allowDelete ?? true, 1),
    SORTCODE: toNumber(body.sortCode),
    DELETEMARK: 0,
    ENABLED: boolToInt(body.enabled ?? true, 1),
    DESCRIPTION: body.description || null,
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
    PARENTID: sanitize(body.parentId),
    CODE: body.code,
    FULLNAME: body.fullName,
    CATEGORY: body.category,
    MODULETYPE: toNumber(body.moduleType, 6),
    IMAGEINDEX: body.imageIndex || null,
    SELECTEDIMAGEINDEX: body.selectedImageIndex || null,
    ICONCSS: body.iconCss || null,
    ICONURL: body.iconUrl || null,
    NAVIGATEURL: body.navigateUrl || '#',
    MVCNAVIGATEURL: body.mvcNavigateUrl || '#',
    TARGET: body.target || null,
    FORMNAME: body.formName || null,
    ASSEMBLYNAME: body.assemblyName || null,
    PERMISSIONITEMCODE: body.permissionItemCode || 'Resource.AccessPermission',
    PERMISSIONSCOPETABLES: body.permissionScopeTables || null,
    ISPUBLIC: boolToInt(body.isPublic, 0),
    ISMENU: boolToInt(body.isMenu ?? true, 1),
    EXPAND: boolToInt(body.expand, 0),
    ALLOWEDIT: boolToInt(body.allowEdit ?? true, 1),
    ALLOWDELETE: boolToInt(body.allowDelete ?? true, 1),
    SORTCODE: toNumber(body.sortCode),
    ENABLED: boolToInt(body.enabled ?? true, 1),
    DESCRIPTION: body.description || null,
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
    const records = await moduleService.getDT();
    const data = (records || []).map(formatModule);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ModuleAdminController.list]', error);
    res.status(500).json({ success: false, message: '获取模块数据失败' });
  }
};

exports.tree = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  try {
    const records = await moduleService.getDT();
    const normalized = (records || []).map(formatModule);
    res.json({ success: true, data: buildTree(normalized) });
  } catch (error) {
    console.error('[ModuleAdminController.tree]', error);
    res.status(500).json({ success: false, message: '获取模块树失败' });
  }
};

exports.detail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少模块主键' });
  }
  try {
    const entity = await moduleService.getEntity(id);
    if (!entity) {
      return res.status(404).json({ success: false, message: '模块不存在' });
    }
    res.json({ success: true, data: formatModule(entity) });
  } catch (error) {
    console.error('[ModuleAdminController.detail]', error);
    res.status(500).json({ success: false, message: '获取模块信息失败' });
  }
};

exports.create = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const payload = req.body || {};
  if (!payload.code || !payload.fullName) {
    return res.status(400).json({ success: false, message: '模块编码与名称不能为空' });
  }
  try {
    const entity = buildCreateEntity(payload, user);
    const { returnCode, returnMessage, returnValue } = await moduleService.add(entity);
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '新增模块失败' });
    }
    const created = await moduleService.getEntity(returnValue);
    res.json({ success: true, message: returnMessage, data: formatModule(created || entity) });
  } catch (error) {
    console.error('[ModuleAdminController.create]', error);
    res.status(500).json({ success: false, message: '新增模块时发生错误' });
  }
};

exports.update = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少模块主键' });
  }
  const payload = req.body || {};
  if (!payload.code || !payload.fullName) {
    return res.status(400).json({ success: false, message: '模块编码与名称不能为空' });
  }
  try {
    const existing = await moduleService.getEntity(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '模块不存在' });
    }
    const data = buildUpdateEntity(payload, user);
    const { returnCode, returnMessage } = await moduleService.update({ ID: id, ...data });
    if (returnCode <= 0) {
      return res.status(400).json({ success: false, message: returnMessage || '更新模块失败' });
    }
    const updated = await moduleService.getEntity(id);
    res.json({ success: true, message: returnMessage, data: formatModule(updated) });
  } catch (error) {
    console.error('[ModuleAdminController.update]', error);
    res.status(500).json({ success: false, message: '更新模块时发生错误' });
  }
};

exports.remove = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少模块主键' });
  }
  try {
    const success = await moduleService.delete(id);
    if (!success) {
      return res.status(400).json({ success: false, message: '删除模块失败' });
    }
    res.json({ success: true, message: '模块已删除' });
  } catch (error) {
    console.error('[ModuleAdminController.remove]', error);
    res.status(500).json({ success: false, message: '删除模块时发生错误' });
  }
};
