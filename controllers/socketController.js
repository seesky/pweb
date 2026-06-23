'use strict';

const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { SocketTokenService } = require('../services/realtime/token_service');
const { PresenceService } = require('../services/realtime/presence_service');

const prisma = new PrismaClient();
const tokenService = new SocketTokenService();
const presenceService = new PresenceService();

// Socket token lifetime. The desktop client only fetches this token at
// login/startup and reuses it across socket.io reconnects, so a short lifetime
// makes any reconnect after expiry fail the auth middleware ("unauthorized"),
// which the client surfaces as an endless "无法连接服务器" retry. Keep it long
// (1 year) so reconnects keep authenticating; the client falls back to a
// cookie→token refresh / re-login when it does eventually expire.
const SOCKET_TOKEN_EXPIRES_SECONDS = 60 * 60 * 24 * 365; // 1 year

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return user;
};

exports.issueToken = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    // Resolve the registered username/email for display in clients. Fall back to
    // the session values if the profile lookup fails (e.g. the super-admin login).
    let username = user.UserName || '';
    let email = '';
    try {
      const profile = await prisma.piuser.findUnique({ where: { ID: user.Id } });
      if (profile) {
        username = profile.USERNAME || username;
        email = profile.EMAIL || '';
      }
    } catch (lookupError) {
      console.error('[SocketController.issueToken] profile lookup failed', lookupError);
    }
    const token = tokenService.issue(user.Id, null, SOCKET_TOKEN_EXPIRES_SECONDS, { username, email });
    res.json({ success: true, token, expiresIn: SOCKET_TOKEN_EXPIRES_SECONDS, username, email });
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
