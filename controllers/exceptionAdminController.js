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

const formatException = (row) => ({
  id: row.ID,
  eventId: row.EVENTID || '',
  category: row.CATEGORY || '',
  priority: row.PRIORITY || '',
  severity: row.SEVERITY || '',
  title: row.TITLE || '',
  timestamp: row.TIMESTAMP,
  machineName: row.MACHINENAME || '',
  appDomainName: row.APPDOMAINNAME || '',
  processId: row.PROCESSID || '',
  processName: row.PROCESSNAME || '',
  threadName: row.THREADNAME || '',
  win32ThreadId: row.WIN32THREADID || '',
  message: row.MESSAGE || '',
  formattedMessage: row.FORMATTEDMESSAGE || '',
  createOn: row.CREATEON,
  createBy: row.CREATEBY || '',
  createUserId: row.CREATEUSERID || ''
});

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 10));
  const keyword = normalize(req.query.keyword);
  const where = {};
  if (keyword) {
    where.OR = [
      { TITLE: { contains: keyword, mode: 'insensitive' } },
      { MESSAGE: { contains: keyword, mode: 'insensitive' } },
      { FORMATTEDMESSAGE: { contains: keyword, mode: 'insensitive' } },
      { PROCESSNAME: { contains: keyword, mode: 'insensitive' } },
      { SEVERITY: { contains: keyword, mode: 'insensitive' } }
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      prisma.ciexception.count({ where }),
      prisma.ciexception.findMany({
        where,
        orderBy: [{ TIMESTAMP: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatException), total, page, pageSize });
  } catch (error) {
    console.error('[ExceptionAdmin.list]', error);
    res.status(500).json({ success: false, message: '获取异常日志失败' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, message: '缺少异常主键' });
  }
  try {
    const entity = await prisma.ciexception.findUnique({ where: { ID: id } });
    if (!entity) {
      return res.status(404).json({ success: false, message: '异常不存在' });
    }
    res.json({ success: true, data: formatException(entity) });
  } catch (error) {
    console.error('[ExceptionAdmin.detail]', error);
    res.status(500).json({ success: false, message: '获取异常详情失败' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: '请选择要删除的异常记录' });
  }
  try {
    const result = await prisma.ciexception.deleteMany({ where: { ID: { in: ids } } });
    res.json({ success: true, message: '异常记录已删除', data: result.count });
  } catch (error) {
    console.error('[ExceptionAdmin.remove]', error);
    res.status(500).json({ success: false, message: '删除异常记录失败' });
  }
};
