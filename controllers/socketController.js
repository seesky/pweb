'use strict';

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { SocketTokenService } = require('../services/realtime/token_service');
const { PresenceService } = require('../services/realtime/presence_service');

const tokenService = new SocketTokenService();
const presenceService = new PresenceService();

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return user;
};

exports.issueToken = (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const token = tokenService.issue(user.Id, null, 60 * 30);
    res.json({ success: true, token, expiresIn: 60 * 30 });
  } catch (error) {
    console.error('[SocketController.issueToken]', error);
    res.status(500).json({ success: false, message: 'Failed to issue token' });
  }
};

exports.myEndpoints = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const endpoints = await presenceService.getEndpointsByUser(user.Id);
    res.json({ success: true, data: endpoints });
  } catch (error) {
    console.error('[SocketController.myEndpoints]', error);
    res.status(500).json({ success: false, message: 'Failed to load endpoints' });
  }
};

exports.userEndpoints = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  if (user.Id !== 'Administrator') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  const { userId } = req.params;
  try {
    const endpoints = await presenceService.getEndpointsByUser(userId);
    res.json({ success: true, data: endpoints });
  } catch (error) {
    console.error('[SocketController.userEndpoints]', error);
    res.status(500).json({ success: false, message: 'Failed to load endpoints' });
  }
};
