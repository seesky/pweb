'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');

const prisma = new PrismaClient();

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: 'Unauthorized or session expired' });
    return null;
  }
  return current;
};

const parsePositive = (value, fallback = 1) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const normalize = (value) => (value === undefined || value === null ? '' : String(value).trim());

const isAdminUser = (user = {}) =>
  user.IsAdministrator === true ||
  user.IsAdministrator === 1 ||
  String(user.IsAdministrator).toLowerCase() === 'true';

const formatMessage = (row) => ({
  id: row.ID,
  title: row.TITLE || '',
  content: row.MSGCONTENT || '',
  receiverId: row.RECEIVERID || '',
  receiverName: row.RECEIVERREALNAME || '',
  isNew: row.ISNEW === 1,
  readCount: row.READCOUNT || 0,
  readDate: row.READDATE,
  categoryCode: row.CATEGORYCODE || '',
  functionCode: row.FUNCTIONCODE || '',
  targetUrl: row.TARGETURL || '',
  ipAddress: row.IPADDRESS || '',
  createdOn: row.CREATEON,
  createdBy: row.CREATEBY || '',
  createUserId: row.CREATEUSERID || ''
});

exports.list = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const isAdmin = isAdminUser(current);
  const page = parsePositive(req.query.page, 1);
  const pageSize = Math.min(100, parsePositive(req.query.pageSize, 10));
  const keyword = normalize(req.query.keyword);
  const where = { DELETEMARK: 0 };
  if (!isAdmin && current.Id) {
    where.OR = [{ RECEIVERID: current.Id }, { CREATEUSERID: current.Id }];
  }
  if (keyword) {
    where.AND = [
      {
        OR: [
          { TITLE: { contains: keyword } },
          { MSGCONTENT: { contains: keyword } },
          { RECEIVERREALNAME: { contains: keyword } }
        ]
      }
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      prisma.cimessage.count({ where }),
      prisma.cimessage.findMany({
        where,
        orderBy: [{ CREATEON: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    res.json({ success: true, data: rows.map(formatMessage), total, page, pageSize });
  } catch (error) {
    console.error('[MessageAdmin.list]', error);
    res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
};

exports.detail = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const isAdmin = isAdminUser(current);
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'Message id is required' });
  try {
    const where = { ID: id, DELETEMARK: 0 };
    if (!isAdmin && current.Id) {
      where.OR = [{ RECEIVERID: current.Id }, { CREATEUSERID: current.Id }];
    }
    const entity = await prisma.cimessage.findFirst({ where });
    if (!entity) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }
    res.json({ success: true, data: formatMessage(entity) });
  } catch (error) {
    console.error('[MessageAdmin.detail]', error);
    res.status(500).json({ success: false, message: 'Failed to load message detail' });
  }
};

exports.send = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  const payload = req.body || {};
  const title = normalize(payload.title);
  const content = normalize(payload.content);
  const receiverId = normalize(payload.receiverId);
  const receiverName = normalize(payload.receiverName);
  if (!title || !receiverId) {
    return res.status(400).json({ success: false, message: 'Title and receiver are required' });
  }
  try {
    const now = new Date();
    const record = await prisma.cimessage.create({
      data: {
        ID: randomUUID(),
        PARENTID: payload.parentId || null,
        FUNCTIONCODE: payload.functionCode || null,
        CATEGORYCODE: payload.categoryCode || 'Send',
        OBJECTID: payload.objectId || null,
        TITLE: title,
        MSGCONTENT: content || null,
        RECEIVERID: receiverId,
        RECEIVERREALNAME: receiverName || null,
        ISNEW: 1,
        READCOUNT: 0,
        TARGETURL: payload.targetUrl || null,
        IPADDRESS: payload.ipAddress || null,
        DELETEMARK: 0,
        ENABLED: 1,
        DESCRIPTION: payload.description || null,
        SORTCODE: payload.sortCode || null,
        CREATEON: now,
        CREATEUSERID: current.Id || null,
        CREATEBY: current.RealName || null
      }
    });
    res.json({ success: true, message: 'Message sent', data: formatMessage(record) });
  } catch (error) {
    console.error('[MessageAdmin.send]', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};

exports.markRead = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  if (!current.Id) {
    return res.status(400).json({ success: false, message: 'Current user lacks ID; cannot mark read' });
  }
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'Please select messages' });
  }
  try {
    await prisma.cimessage.updateMany({
      where: { ID: { in: ids }, RECEIVERID: current.Id },
      data: { ISNEW: 0, READDATE: new Date(), READCOUNT: { increment: 1 } }
    });
    res.json({ success: true, message: 'Marked as read' });
  } catch (error) {
    console.error('[MessageAdmin.markRead]', error);
    res.status(500).json({ success: false, message: 'Operation failed' });
  }
};

exports.remove = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) return;
  if (!current.Id) {
    return res.status(400).json({ success: false, message: 'Current user lacks ID; cannot delete messages' });
  }
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'Please select messages to delete' });
  }
  try {
    const result = await prisma.cimessage.deleteMany({
      where: {
        ID: { in: ids },
        OR: [{ RECEIVERID: current.Id }, { CREATEUSERID: current.Id }]
      }
    });
    res.json({ success: true, message: 'Messages deleted', data: result.count });
  } catch (error) {
    console.error('[MessageAdmin.remove]', error);
    res.status(500).json({ success: false, message: 'Failed to delete messages' });
  }
};
