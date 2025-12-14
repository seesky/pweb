'use strict';

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { PresenceService } = require('../services/realtime/presence_service');
const presenceService = new PresenceService();

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return user;
};

const ensureAdmin = (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return null;
  if (user.Id !== 'Administrator' && !user.IsAdministrator) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }
  return user;
};

exports.onlineUsers = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const data = await presenceService.listOnlineUsers();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[RealtimeAdmin.onlineUsers]', error);
    res.status(500).json({ success: false, message: '加载在线用户失败' });
  }
};

exports.endpoints = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const data = await presenceService.listAllEndpoints();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[RealtimeAdmin.endpoints]', error);
    res.status(500).json({ success: false, message: '加载终端失败' });
  }
};

exports.removeEndpoint = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  const { terminalId } = req.params || {};
  if (!terminalId) {
    return res.status(400).json({ success: false, message: '缺少终端ID' });
  }
  try {
    await presenceService.removeEndpoint(terminalId);
    res.json({ success: true, message: '终端已移除' });
  } catch (error) {
    console.error('[RealtimeAdmin.removeEndpoint]', error);
    res.status(500).json({ success: false, message: '移除终端失败' });
  }
};
