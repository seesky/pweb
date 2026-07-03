'use strict';

const { PrismaClient } = require('@prisma/client');

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

const formatLog = (row) => ({
  id: row.ID,
  processId: row.PROCESSID || '',
  processName: row.PROCESSNAME || '',
  methodEngName: row.METHODENGNAME || '',
  methodName: row.METHODNAME || '',
  ipAddress: row.IPADDRESS || '',
  userRealName: row.USERREALNAME || '',
  createUserId: row.CREATEUSERID || '',
  parameters: row.PARAMETERS || '',
  createOn: row.CREATEON
});

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 20));
  const keyword = normalize(req.query.keyword);
  const where = {};
  if (keyword) {
    where.OR = [
      { PROCESSNAME: { contains: keyword } },
      { METHODNAME: { contains: keyword } },
      { USERREALNAME: { contains: keyword } }
    ];
  }
  try {
    const [recordCount, data] = await Promise.all([
      prisma.cilog.count({ where }),
      prisma.cilog.findMany({
        where,
        orderBy: { CREATEON: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({
      success: true,
      data: (data || []).map(formatLog),
      total: recordCount,
      page,
      pageSize
    });
  } catch (error) {
    console.error('[LogAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少日志主键' });
  }
  try {
    const entity = await prisma.cilog.findUnique({ where: { ID: id } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '日志不存在' });
    }
    res.json({ success: true, data: formatLog(entity) });
  } catch (error) {
    console.error('[LogAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取日志详情失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: '请选择要删除的日志' });
  }
  try {
    const result = await prisma.cilog.deleteMany({ where: { ID: { in: ids } } });
    res.json({ success: true, message: '日志已删除', data: result.count });
  } catch (error) {
    console.error('[LogAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除日志失败' });
  }
};
