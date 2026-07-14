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

const toNullableNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const formatSequence = (entity) => ({
  id: entity.ID,
  fullName: entity.FULLNAME || '',
  prefix: entity.PREFIX || '',
  separate: entity.SEPARATE || '',
  sequence: entity.SEQUENCE ?? null,
  reduction: entity.REDUCTION ?? null,
  step: entity.STEP ?? null,
  description: entity.DESCRIPTION || '',
  createdOn: entity.CREATEON
});

const buildCreateEntity = (payload) => {
  const now = new Date();
  return {
    ID: randomUUID(),
    FULLNAME: payload.fullName,
    PREFIX: payload.prefix || null,
    SEPARATE: payload.separate || null,
    SEQUENCE: toNullableNumber(payload.sequence, 10000000),
    REDUCTION: toNullableNumber(payload.reduction, 9999999),
    STEP: toNullableNumber(payload.step, 1),
    DESCRIPTION: payload.description || null,
    DELETEMARK: 0,
    CREATEON: now
  };
};

const buildUpdateEntity = (payload) => ({
  FULLNAME: payload.fullName,
  PREFIX: payload.prefix || null,
  SEPARATE: payload.separate || null,
  SEQUENCE: toNullableNumber(payload.sequence, 10000000),
  REDUCTION: toNullableNumber(payload.reduction, 9999999),
  STEP: toNullableNumber(payload.step, 1),
  DESCRIPTION: payload.description || null
});

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 10));
  const keyword = (req.query.keyword || '').trim();
  const where = { DELETEMARK: 0 };
  if (keyword) {
    where.OR = [
      { FULLNAME: { contains: keyword } },
      { PREFIX: { contains: keyword } },
      { SEPARATE: { contains: keyword } },
      { DESCRIPTION: { contains: keyword } }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      prisma.cisequence.count({ where }),
      prisma.cisequence.findMany({
        where,
        orderBy: [{ FULLNAME: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatSequence), total, page, pageSize });
  } catch (error) {
    console.error('[SequenceAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取序列列表失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少序列主键' });
  }
  try {
    const entity = await prisma.cisequence.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '序列不存在' });
    }
    res.json({ success: true, data: formatSequence(entity) });
  } catch (error) {
    console.error('[SequenceAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取序列详情失败' });
  }
};

exports.create = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const payload = req.body || {};
  const fullName = (payload.fullName || '').trim();
  if (!fullName) {
    return res.status(400).json({ success: false, message: '序列名称不能为空' });
  }
  try {
    const exists = await prisma.cisequence.findFirst({
      where: { FULLNAME: fullName, DELETEMARK: 0 }
    });
    if (exists) {
      return res.status(400).json({ success: false, message: '序列名称已存在' });
    }
    const entity = buildCreateEntity({ ...payload, fullName });
    const created = await prisma.cisequence.create({ data: entity });
    res.json({ success: true, message: '序列已创建', data: formatSequence(created) });
  } catch (error) {
    console.error('[SequenceAdmin.create]', error);
    res.status(500).json({ success: false, message: '新增序列失败' });
  }
};

exports.update = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少序列主键' });
  }
  const payload = req.body || {};
  const fullName = (payload.fullName || '').trim();
  if (!fullName) {
    return res.status(400).json({ success: false, message: '序列名称不能为空' });
  }
  try {
    const existing = await prisma.cisequence.findFirst({ where: { ID: id, DELETEMARK: 0 } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '序列不存在' });
    }
    const duplicate = await prisma.cisequence.findFirst({
      where: { ID: { not: id }, FULLNAME: fullName, DELETEMARK: 0 }
    });
    if (duplicate) {
      return res.status(400).json({ success: false, message: '序列名称已存在' });
    }
    const data = buildUpdateEntity({ ...payload, fullName });
    await prisma.cisequence.update({
      where: { ID: id },
      data
    });
    const updated = await prisma.cisequence.findFirst({ where: { ID: id } });
    res.json({ success: true, message: '序列已更新', data: formatSequence(updated) });
  } catch (error) {
    console.error('[SequenceAdmin.update]', error);
    res.status(500).json({ success: false, message: '更新序列失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少序列主键' });
  }
  try {
    const result = await prisma.cisequence.updateMany({
      where: { ID: id, DELETEMARK: 0 },
      data: { DELETEMARK: 1 }
    });
    if (!result.count) {
      return res.status(404).json({ success: false, message: '序列不存在或已删除' });
    }
    res.json({ success: true, message: '序列已删除' });
  } catch (error) {
    console.error('[SequenceAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除序列失败' });
  }
};
