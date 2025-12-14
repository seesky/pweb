'use strict';

const { Server } = require('socket.io');
const { randomUUID } = require('node:crypto');
const { SocketTokenService } = require('./token_service');
const { PresenceService } = require('./presence_service');
const { AuditService } = require('./audit_service');

const SOCKET_EVENTS = {
  AUTH: 'auth',
  HEARTBEAT: 'heartbeat',
  LIST_MY: 'list_my_endpoints',
  LIST_USER: 'list_user_endpoints',
  SEND_USER: 'send_to_user',
  SEND_TERMINAL: 'send_to_terminal',
  MESSAGE: 'message',
  ERROR: 'error'
};

const buildSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });
  const tokenService = new SocketTokenService();
  const presence = new PresenceService();
  const audit = new AuditService();

  const socketIndex = new Map(); // socketId -> { userId, terminalId }
  const terminalIndex = new Map(); // terminalId -> socketId

  const emitError = (socket, message) => {
    socket.emit(SOCKET_EVENTS.ERROR, { message });
  };

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const deviceInfo = socket.handshake.auth?.deviceInfo || {};
    const terminalIdFromClient = socket.handshake.auth?.terminalId || socket.handshake.query?.terminalId;
    const payload = tokenService.verify(token);
    if (!payload?.uid) {
      return next(new Error('unauthorized'));
    }
    const terminalId = terminalIdFromClient || payload.tid || randomUUID();
    socket.data.userId = payload.uid;
    socket.data.terminalId = terminalId;
    socket.data.deviceInfo = deviceInfo;
    return next();
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;
    const terminalId = socket.data.terminalId;
    const ua = socket.handshake.headers['user-agent'] || '';
    const ip = socket.handshake.address || '';
    const os = socket.data.deviceInfo?.os || '';
    socketIndex.set(socket.id, { userId, terminalId });
    terminalIndex.set(terminalId, socket.id);
    await presence.addEndpoint(userId, terminalId, socket.id, {
      ip,
      ua,
      os,
      loginAt: Date.now()
    });
    audit.log({ action: 'connect', userId, ip, description: `terminal:${terminalId}` });

    socket.emit(SOCKET_EVENTS.AUTH, { ok: true, userId, terminalId });

    socket.on(SOCKET_EVENTS.HEARTBEAT, async () => {
      await presence.updateLastSeen(terminalId);
    });

    socket.on(SOCKET_EVENTS.LIST_MY, async (cb = () => {}) => {
      const endpoints = await presence.getEndpointsByUser(userId);
      cb({ success: true, data: endpoints });
    });

    socket.on(SOCKET_EVENTS.LIST_USER, async (payload, cb = () => {}) => {
      // basic admin check: only userId === 'Administrator' can list others
      if (userId !== 'Administrator') {
        cb({ success: false, message: 'forbidden' });
        return;
      }
      const targetId = payload?.userId;
      const endpoints = await presence.getEndpointsByUser(targetId);
      cb({ success: true, data: endpoints });
    });

    const sendToTerminal = async (targetTerminalId, messagePayload) => {
      const targetSocketId = terminalIndex.get(targetTerminalId);
      if (!targetSocketId || !io.sockets.sockets.get(targetSocketId)) {
        const endpoint = await presence.getEndpoint(targetTerminalId);
        if (!endpoint) return false;
        return false;
      }
      io.to(targetSocketId).emit(SOCKET_EVENTS.MESSAGE, {
        fromUserId: userId,
        fromTerminalId: terminalId,
        payload: messagePayload,
        ts: Date.now()
      });
      return true;
    };

    socket.on(SOCKET_EVENTS.SEND_TERMINAL, async (payload, cb = () => {}) => {
      const targetTerminalId = payload?.toTerminalId;
      if (!targetTerminalId) {
        cb({ success: false, message: 'missing target terminal' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, payload?.payload);
      audit.log({ action: 'send_terminal', userId, description: `to:${targetTerminalId}`, payload: { size: JSON.stringify(payload?.payload || '').length } });
      cb({ success: sent });
    });

    socket.on(SOCKET_EVENTS.SEND_USER, async (payload, cb = () => {}) => {
      const toUserId = payload?.toUserId;
      if (!toUserId) {
        cb({ success: false, message: 'missing target user' });
        return;
      }
      const endpoints = await presence.getEndpointsByUser(toUserId);
      let delivered = 0;
      for (const ep of endpoints) {
        const ok = await sendToTerminal(ep.terminalId, payload?.payload);
        if (ok) delivered += 1;
      }
      audit.log({ action: 'send_user', userId, description: `toUser:${toUserId} delivered:${delivered}`, payload: { size: JSON.stringify(payload?.payload || '').length } });
      cb({ success: true, delivered });
    });

    socket.on('disconnect', async () => {
      socketIndex.delete(socket.id);
      terminalIndex.delete(terminalId);
      await presence.removeBySocket(socket.id);
      audit.log({ action: 'disconnect', userId, description: `terminal:${terminalId}` });
    });
  });

  return io;
};

module.exports = {
  buildSocketServer,
  SOCKET_EVENTS
};
