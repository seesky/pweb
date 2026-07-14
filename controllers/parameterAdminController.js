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

const normalizeText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const boolToInt = (v, def = 0) => (v ? 1 : def);

const formatParameter = (entity) => ({
  id: entity.ID,
  categoryKey: entity.CATEGORYKEY || '',
  parameterId: entity.PARAMETERID || '',
  parameterCode: entity.PARAMETERCODE || '',
  parameterContent: entity.PARAMETERCONTENT || '',
  allowEdit: entity.ALLOWEDIT === 1,
  allowDelete: entity.ALLOWDELETE === 1,
  description: entity.DESCRIPTION || '',
  enabled: entity.ENABLED === 1,
  worked: entity.WORKED === 1,
  createOn: entity.CREATEON
});

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 10));
  const keyword = normalizeText(req.query.keyword);
  const where = { DELETEMARK: 0 };
  if (keyword) {
    where.OR = [
      { CATEGORYKEY: { contains: keyword } },
      { PARAMETERID: { contains: keyword } },
      { PARAMETERCODE: { contains: keyword } },
      { DESCRIPTION: { contains: keyword } }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      prisma.ciparameter.count({ where }),
      prisma.ciparameter.findMany({
        where,
        orderBy: [{ CREATEON: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatParameter), total, page, pageSize });
  } catch (error) {
    console.error('[ParameterAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取系统参数失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少参数主键' });
  try {
    const entity = await prisma.ciparameter.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '参数不存在' });
    }
    res.json({ success: true, data: formatParameter(entity) });
  } catch (error) {
    console.error('[ParameterAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取参数详情失败' });
  }
};

exports.create = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const payload = req.body || {};
  const categoryKey = normalizeText(payload.categoryKey);
  const parameterId = normalizeText(payload.parameterId);
  const parameterCode = normalizeText(payload.parameterCode);
  const parameterContent = normalizeText(payload.parameterContent);
  if (!categoryKey || !parameterId || !parameterCode) {
    return res.status(400).json({ success: false, message: '分类、参数ID和编码不能为空' });
  }
  try {
    const now = new Date();
    const record = await prisma.ciparameter.create({
      data: {
        ID: normalizeText(payload.id) || randomUUID(),
        CATEGORYKEY: categoryKey,
        PARAMETERID: parameterId,
        PARAMETERCODE: parameterCode,
        PARAMETERCONTENT: parameterContent,
        ALLOWEDIT: boolToInt(payload.allowEdit, 1),
        ALLOWDELETE: boolToInt(payload.allowDelete, 1),
        ENABLED: boolToInt(payload.enabled, 1),
        WORKED: boolToInt(payload.worked, 0),
        DESCRIPTION: normalizeText(payload.description) || null,
        DELETEMARK: 0,
        CREATEON: now,
        MODIFIEDON: now
      }
    });
    res.json({ success: true, message: '参数已创建', data: formatParameter(record) });
  } catch (error) {
    console.error('[ParameterAdmin.create]', error);
    res.status(500).json({ success: false, message: '新增参数失败' });
  }
};

exports.update = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少参数主键' });
  const payload = req.body || {};
  const categoryKey = normalizeText(payload.categoryKey);
  const parameterId = normalizeText(payload.parameterId);
  const parameterCode = normalizeText(payload.parameterCode);
  const parameterContent = normalizeText(payload.parameterContent);
  if (!categoryKey || !parameterId || !parameterCode) {
    return res.status(400).json({ success: false, message: '分类、参数ID和编码不能为空' });
  }
  try {
    const exists = await prisma.ciparameter.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!exists) {
      return res.status(404).json({ success: false, message: '参数不存在' });
    }
    await prisma.ciparameter.update({
      where: { ID: id },
      data: {
        CATEGORYKEY: categoryKey,
        PARAMETERID: parameterId,
        PARAMETERCODE: parameterCode,
        PARAMETERCONTENT: parameterContent,
        ALLOWEDIT: boolToInt(payload.allowEdit, exists.ALLOWEDIT),
        ALLOWDELETE: boolToInt(payload.allowDelete, exists.ALLOWDELETE),
        ENABLED: boolToInt(payload.enabled, exists.ENABLED),
        WORKED: boolToInt(payload.worked, exists.WORKED),
        DESCRIPTION: normalizeText(payload.description) || null,
        MODIFIEDON: new Date()
      }
    });
    const updated = await prisma.ciparameter.findFirst({ where: { ID: id } });
    res.json({ success: true, message: '参数已更新', data: formatParameter(updated) });
  } catch (error) {
    console.error('[ParameterAdmin.update]', error);
    res.status(500).json({ success: false, message: '更新参数失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: '缺少参数主键' });
  try {
    const result = await prisma.ciparameter.updateMany({
      where: { ID: id, DELETEMARK: 0 },
      data: { DELETEMARK: 1 }
    });
    if (!result.count) {
      return res.status(404).json({ success: false, message: '参数不存在或已删除' });
    }
    res.json({ success: true, message: '参数已删除' });
  } catch (error) {
    console.error('[ParameterAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除参数失败' });
  }
};
