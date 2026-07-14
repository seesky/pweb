'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');

const prisma = new PrismaClient();

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

const normalize = (value) => (value === undefined || value === null ? '' : String(value).trim());
const boolToInt = (value, fallback = 0) => (value === undefined || value === null ? fallback : value ? 1 : 0);
const numberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const contains = (keyword) => ({ contains: keyword });

const formatPlugin = (row) => ({
  id: row.ID,
  guid: row.GUID || '',
  name: row.NAME || '',
  assemblyName: row.ASSEMBLYNAME || '',
  className: row.CLASSNAME || '',
  version: row.VERSION || '',
  developer: row.DEVELOPER || '',
  addinSize: row.ADDINSIZE ?? null,
  downloadCount: row.DOWNLOADCOUNT || 0,
  description: row.DESCRIPTION || '',
  enabled: row.ENABLED === 1,
  createdOn: row.CREATEON,
  modifiedOn: row.MODIFIEDON
});

const buildData = (payload, current, existing) => {
  const now = new Date();
  const data = {
    GUID: normalize(payload.guid) || null,
    NAME: normalize(payload.name),
    ASSEMBLYNAME: normalize(payload.assemblyName) || null,
    CLASSNAME: normalize(payload.className) || null,
    VERSION: normalize(payload.version) || null,
    DEVELOPER: normalize(payload.developer) || null,
    ADDINSIZE: numberOrNull(payload.addinSize),
    DOWNLOADCOUNT: numberOrNull(payload.downloadCount) ?? 0,
    DESCRIPTION: normalize(payload.description) || null,
    ENABLED: boolToInt(payload.enabled, existing?.ENABLED ?? 1),
    DELETEMARK: 0,
    MODIFIEDON: now,
    MODIFIEDUSERID: current?.Id || null,
    MODIFIEDBY: current?.RealName || null
  };
  if (!existing) {
    data.ID = randomUUID();
    data.CREATEON = now;
    data.CREATEUSERID = current?.Id || null;
    data.CREATEBY = current?.RealName || null;
  }
  return data;
};

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;

  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 10));
  const keyword = normalize(req.query.keyword);
  const where = { DELETEMARK: 0 };
  if (keyword) {
    where.OR = [
      { NAME: contains(keyword) },
      { ASSEMBLYNAME: contains(keyword) },
      { CLASSNAME: contains(keyword) },
      { VERSION: contains(keyword) },
      { DEVELOPER: contains(keyword) },
      { DESCRIPTION: contains(keyword) }
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      prisma.piplatformaddin.count({ where }),
      prisma.piplatformaddin.findMany({
        where,
        orderBy: [{ CREATEON: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatPlugin), total, page, pageSize });
  } catch (error) {
    console.error('[PlatformPluginAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取平台插件列表失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;

  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少插件主键' });

  try {
    const entity = await prisma.piplatformaddin.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '平台插件不存在' });
    }
    res.json({ success: true, data: formatPlugin(entity) });
  } catch (error) {
    console.error('[PlatformPluginAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取平台插件详情失败' });
  }
};

exports.create = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;

  const payload = req.body || {};
  if (!normalize(payload.name)) {
    return res.status(400).json({ success: false, message: '插件名称不能为空' });
  }

  try {
    const created = await prisma.piplatformaddin.create({ data: buildData(payload, current) });
    res.json({ success: true, message: '平台插件已创建', data: formatPlugin(created) });
  } catch (error) {
    console.error('[PlatformPluginAdmin.create]', error);
    res.status(500).json({ success: false, message: '新增平台插件失败' });
  }
};

exports.update = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;

  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少插件主键' });
  const payload = req.body || {};
  if (!normalize(payload.name)) {
    return res.status(400).json({ success: false, message: '插件名称不能为空' });
  }

  try {
    const existing = await prisma.piplatformaddin.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '平台插件不存在' });
    }
    await prisma.piplatformaddin.update({
      where: { ID: id },
      data: buildData(payload, current, existing)
    });
    const updated = await prisma.piplatformaddin.findUnique({ where: { ID: id } });
    res.json({ success: true, message: '平台插件已更新', data: formatPlugin(updated) });
  } catch (error) {
    console.error('[PlatformPluginAdmin.update]', error);
    res.status(500).json({ success: false, message: '更新平台插件失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;

  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少插件主键' });

  try {
    const result = await prisma.piplatformaddin.updateMany({
      where: { ID: id, DELETEMARK: 0 },
      data: {
        DELETEMARK: 1,
        MODIFIEDON: new Date(),
        MODIFIEDUSERID: current?.Id || null,
        MODIFIEDBY: current?.RealName || null
      }
    });
    if (!result.count) {
      return res.status(404).json({ success: false, message: '平台插件不存在或已删除' });
    }
    res.json({ success: true, message: '平台插件已删除' });
  } catch (error) {
    console.error('[PlatformPluginAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除平台插件失败' });
  }
};
