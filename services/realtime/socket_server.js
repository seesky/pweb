'use strict';

const { Server } = require('socket.io');
const { randomUUID, randomBytes } = require('node:crypto');
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
  ERROR: 'error',
  ENDPOINT_ONLINE: 'endpoint_online',
  ENDPOINT_OFFLINE: 'endpoint_offline',
  ENDPOINTS_SNAPSHOT: 'endpoints_snapshot',
  POLEIS_CONNECTED: 'poleis_connected',
  POLEIS_NAT_CONNECT_REQUEST: 'poleis_nat_connect_request',
  POLEIS_NAT_INFO: 'poleis_nat_info',
  POLEIS_NAT_PUNCH_START: 'poleis_nat_punch_start',
  POLEIS_NAT_CONNECTED: 'poleis_nat_connected',
  POLEIS_NAT_FAILED: 'poleis_nat_failed',
  // Parsec-style relay (TURN-like) fallback signaling
  POLEIS_RELAY_REQUEST: 'poleis_relay_request',  // peer asks web to allocate a relay session
  POLEIS_RELAY_OFFER: 'poleis_relay_offer',      // web pushes relay endpoint+token to the other peer
  POLEIS_RELAY_ANSWER: 'poleis_relay_answer',    // peer confirms it bound to the relay
  // Poleis P2P连接事件
  POLEIS_CONNECT_REQUEST: 'poleis_connect_request',  // 请求建立P2P连接
  POLEIS_SDP_OFFER: 'poleis_sdp_offer',              // SDP offer（服务端->客户端）
  POLEIS_SDP_ANSWER: 'poleis_sdp_answer',            // SDP answer（客户端->服务端）
  POLEIS_ICE_CANDIDATE: 'poleis_ice_candidate',      // ICE候选交换
  POLEIS_CONNECTED: 'poleis_connected',              // P2P连接成功
  POLEIS_DISCONNECT: 'poleis_disconnect',            // 断开P2P连接
  POLEIS_NAT_RETRY: 'poleis_nat_retry'               // 请求重发NAT信息（打洞协调）
};

const buildSocketServer = (httpServer, options = {}) => {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });
  const tokenService = new SocketTokenService();
  const presence = new PresenceService();
  const audit = new AuditService();
  const relay = options.relay || null;
  // Public endpoint that peers should send relay UDP traffic to. Defaults to env
  // (set RELAY_PUBLIC_HOST to the web server's reachable IP/domain in prod).
  // 0.0.0.0 / :: are listen wildcards, NOT routable destinations — treat them as
  // unset so we fall back to the address the client actually connected to.
  let relayPublicHost = process.env.RELAY_PUBLIC_HOST || '';
  if (relayPublicHost === '0.0.0.0' || relayPublicHost === '::') relayPublicHost = '';
  const relayPublicPort = Number(process.env.RELAY_UDP_PORT || 3479);
  // GameViewer-style synchronized punch start (report §7.5). The web server is
  // the natural coordination point: injecting the SAME relative countdown into
  // both peers' NatInfo makes them begin their punch strategies together (helps
  // Linear-Linear where two predicted ports must line up in time). 0 disables.
  const punchStartCountdownMs = Math.max(0, Number(process.env.POLEIS_PUNCH_COUNTDOWN_MS || 0));

  // 服务启动时清理旧的在线状态数据，防止重启后显示幽灵设备
  presence.clearAllEndpoints().then(() => {
    console.log('[socket.io] Cleared stale presence data on startup');
  }).catch((err) => {
    console.error('[socket.io] Failed to clear presence data:', err);
  });

  const socketIndex = new Map(); // socketId -> { userId, terminalId }
  const terminalIndex = new Map(); // terminalId -> Set<socketId>
  const natSessions = new Map(); // sessionId -> { clientTerminalId, agentTerminalId, createdAt, state }
  const relayPairTokens = new Map(); // sorted "termA|termB" -> { token, createdAt }
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const [sessionId, session] of natSessions.entries()) {
      if (!session.createdAt || session.createdAt < cutoff) {
        if (relay && session.relayToken) relay.revokeSession(session.relayToken);
        natSessions.delete(sessionId);
      }
    }
  }, 60 * 1000).unref();

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
    const userRoom = `user:${userId}`;
    const ua = socket.data.deviceInfo?.ua || socket.handshake.headers['user-agent'] || '';
    const ip = socket.handshake.address || '';
    const os = socket.data.deviceInfo?.os || '';
    socket.join(userRoom);
    socketIndex.set(socket.id, { userId, terminalId });
    if (!terminalIndex.has(terminalId)) terminalIndex.set(terminalId, new Set());
    terminalIndex.get(terminalId).add(socket.id);
    await presence.addEndpoint(userId, terminalId, socket.id, {
      ip,
      ua,
      os,
      loginAt: Date.now()
    });
    const onlinePayload = { terminalId, userId, ip, ua, os, lastSeen: Date.now() };
    io.to(userRoom).emit(SOCKET_EVENTS.ENDPOINT_ONLINE, onlinePayload);
    audit.log({ action: 'connect', userId, ip, description: `terminal:${terminalId}` });

    socket.emit(SOCKET_EVENTS.AUTH, { ok: true, userId, terminalId });
    const snapshot = await presence.getEndpointsByUser(userId);
    socket.emit(SOCKET_EVENTS.ENDPOINTS_SNAPSHOT, { success: true, data: snapshot });

    socket.on(SOCKET_EVENTS.HEARTBEAT, async () => {
      await presence.updateLastSeen(terminalId, socket.id);
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
      let targetSocketIds = Array.from(terminalIndex.get(targetTerminalId) || []);
      if (!targetSocketIds.length) {
        const endpoints = await presence.getEndpointsByTerminal(targetTerminalId);
        targetSocketIds = endpoints.map((ep) => ep.socketId).filter(Boolean);
      }
      if (!targetSocketIds.length) return false;
      let delivered = 0;
      for (const sid of targetSocketIds) {
        if (!io.sockets.sockets.get(sid)) continue;
        io.to(sid).emit(SOCKET_EVENTS.MESSAGE, {
          fromUserId: userId,
          fromTerminalId: terminalId,
          payload: messagePayload,
          ts: Date.now()
        });
        delivered += 1;
      }
      return delivered > 0;
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

    // Poleis P2P连接事件处理器
    socket.on(SOCKET_EVENTS.POLEIS_CONNECT_REQUEST, async (payload, cb = () => {}) => {
      // 客户端请求连接到远程终端
      const targetTerminalId = payload?.toTerminalId;
      if (!targetTerminalId) {
        cb({ success: false, message: 'missing target terminal' });
        return;
      }
      // 转发连接请求到目标终端
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_CONNECT_REQUEST',
        fromTerminalId: terminalId,
        fromUserId: userId
      });
      audit.log({ action: 'poleis_connect', userId, description: `request to:${targetTerminalId}` });
      cb({ success: sent });
    });

    // Poleis exchanges its NatInfo as the base64-encoded "SDP". Inject the
    // Parsec-style relay allocation (one token per terminal pair) into that JSON
    // so both peers learn the same relay endpoint+token via the normal SDP
    // exchange and can fall back to the relay without any extra round trip.
    const augmentSdpWithRelay = (toTerminalId, sdpB64) => {
      if (typeof sdpB64 !== 'string' || !sdpB64.length) return sdpB64;
      // Inject the relay allocation (one token per terminal pair) only when a
      // relay is configured and reachable.
      let relayFields = null;
      if (relay) {
        const host = relayPublicHost || (socket.handshake.headers.host || '').split(':')[0] || '';
        if (host) {
          const pairKey = [terminalId, toTerminalId].sort().join('|');
          let entry = relayPairTokens.get(pairKey);
          if (!entry) {
            entry = { token: randomBytes(16).toString('hex'), createdAt: Date.now() };
            relayPairTokens.set(pairKey, entry);
            relay.authorizeSession(entry.token);
          }
          relayFields = { relay_host: host, relay_port: relayPublicPort, relay_token: entry.token };
        }
      }
      // Nothing to inject -> leave the blob untouched (unknown fields, e.g. the
      // peer's candidate_groups, always pass through this exchange intact).
      if (!relayFields && punchStartCountdownMs <= 0) return sdpB64;
      try {
        const obj = JSON.parse(Buffer.from(sdpB64, 'base64').toString('utf8'));
        if (!obj || typeof obj !== 'object') return sdpB64;
        if (relayFields) Object.assign(obj, relayFields);
        if (punchStartCountdownMs > 0) obj.punch_start_countdown_ms = punchStartCountdownMs;
        return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
      } catch (e) {
        return sdpB64; // not augmentable (e.g. non-JSON SDP)
      }
    };

    socket.on(SOCKET_EVENTS.POLEIS_SDP_OFFER, async (payload, cb = () => {}) => {
      // 服务端发送SDP offer到客户端
      const targetTerminalId = payload?.toTerminalId;
      const sdp = payload?.sdp;
      if (!targetTerminalId || !sdp) {
        cb({ success: false, message: 'missing target or sdp' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_SDP_OFFER',
        fromTerminalId: terminalId,
        sdp: augmentSdpWithRelay(targetTerminalId, sdp)
      });
      audit.log({ action: 'poleis_sdp_offer', userId, description: `to:${targetTerminalId}` });
      cb({ success: sent });
    });

    socket.on(SOCKET_EVENTS.POLEIS_SDP_ANSWER, async (payload, cb = () => {}) => {
      // 客户端发送SDP answer到服务端
      const targetTerminalId = payload?.toTerminalId;
      const sdp = payload?.sdp;
      if (!targetTerminalId || !sdp) {
        cb({ success: false, message: 'missing target or sdp' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_SDP_ANSWER',
        fromTerminalId: terminalId,
        sdp: augmentSdpWithRelay(targetTerminalId, sdp)
      });
      audit.log({ action: 'poleis_sdp_answer', userId, description: `to:${targetTerminalId}` });
      cb({ success: sent });
    });

    socket.on(SOCKET_EVENTS.POLEIS_ICE_CANDIDATE, async (payload, cb = () => {}) => {
      // ICE候选交换
      const targetTerminalId = payload?.toTerminalId;
      const candidate = payload?.candidate;
      if (!targetTerminalId || !candidate) {
        cb({ success: false, message: 'missing target or candidate' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_ICE_CANDIDATE',
        fromTerminalId: terminalId,
        candidate
      });
      cb({ success: sent });
    });

    const relayNatSignal = async (eventType, payload, cb = () => {}) => {
      const targetTerminalId = payload?.toTerminalId;
      const sessionId = payload?.sessionId;
      if (!targetTerminalId || !sessionId) {
        cb({ success: false, message: 'missing target terminal or sessionId' });
        return;
      }

      const serialized = JSON.stringify(payload?.nat || payload?.error || {});
      if (serialized.length > 32768) {
        cb({ success: false, message: 'nat payload too large' });
        return;
      }

      const existing = natSessions.get(sessionId);
      if (!existing && eventType !== 'POLEIS_NAT_CONNECT_REQUEST') {
        cb({ success: false, message: 'unknown nat session' });
        return;
      }

      if (eventType === 'POLEIS_NAT_CONNECT_REQUEST') {
        natSessions.set(sessionId, {
          clientTerminalId: terminalId,
          agentTerminalId: targetTerminalId,
          createdAt: Date.now(),
          state: 'requested'
        });
      } else if (existing) {
        existing.state = eventType;
      }

      const session = natSessions.get(sessionId);
      // Allocate a one-time relay token for this NAT session (Parsec-style relay
      // fallback) and ride it along inside the exchanged NatInfo so both peers
      // learn the same relay endpoint without an extra round trip.
      if (relay && session && !session.relayToken) {
        session.relayToken = randomBytes(16).toString('hex');
        relay.authorizeSession(session.relayToken);
      }

      let natToSend = payload?.nat;
      if (typeof natToSend === 'string' && natToSend.length &&
          ((relay && session && session.relayToken) || punchStartCountdownMs > 0)) {
        try {
          const obj = JSON.parse(natToSend);
          if (relay && session && session.relayToken) {
            const host = relayPublicHost ||
                         (socket.handshake.headers.host || '').split(':')[0] || '';
            if (host) {
              obj.relay_host = host;
              obj.relay_port = relayPublicPort;
              obj.relay_token = session.relayToken;
            }
          }
          // Synchronized punch start (same value to both peers). candidate_groups
          // and other unknown fields pass through this re-serialization intact.
          if (punchStartCountdownMs > 0) obj.punch_start_countdown_ms = punchStartCountdownMs;
          natToSend = JSON.stringify(obj);
        } catch (e) {
          // leave natToSend unchanged on parse failure
        }
      }

      const sent = await sendToTerminal(targetTerminalId, {
        type: eventType,
        sessionId,
        fromTerminalId: terminalId,
        fromUserId: userId,
        role: payload?.role,
        nat: natToSend,
        error: payload?.error
      });
      audit.log({ action: eventType.toLowerCase(), userId, description: `session:${sessionId} to:${targetTerminalId}` });
      cb({ success: sent });
    };

    socket.on(SOCKET_EVENTS.POLEIS_NAT_CONNECT_REQUEST, (payload, cb = () => {}) =>
      relayNatSignal('POLEIS_NAT_CONNECT_REQUEST', payload, cb));

    socket.on(SOCKET_EVENTS.POLEIS_NAT_INFO, (payload, cb = () => {}) =>
      relayNatSignal('POLEIS_NAT_INFO', payload, cb));

    socket.on(SOCKET_EVENTS.POLEIS_NAT_PUNCH_START, (payload, cb = () => {}) =>
      relayNatSignal('POLEIS_NAT_PUNCH_START', payload, cb));

    socket.on(SOCKET_EVENTS.POLEIS_NAT_CONNECTED, (payload, cb = () => {}) =>
      relayNatSignal('POLEIS_NAT_CONNECTED', payload, cb));

    socket.on(SOCKET_EVENTS.POLEIS_NAT_FAILED, (payload, cb = () => {}) =>
      relayNatSignal('POLEIS_NAT_FAILED', payload, cb));

    socket.on(SOCKET_EVENTS.POLEIS_CONNECTED, async (payload, cb = () => {}) => {
      // P2P连接建立成功通知
      const targetTerminalId = payload?.toTerminalId;
      if (!targetTerminalId) {
        cb({ success: false, message: 'missing target terminal' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_CONNECTED',
        fromTerminalId: terminalId
      });
      audit.log({ action: 'poleis_connected', userId, description: `with:${targetTerminalId}` });
      cb({ success: sent });
    });

    socket.on(SOCKET_EVENTS.POLEIS_DISCONNECT, async (payload, cb = () => {}) => {
      // 断开P2P连接通知
      const targetTerminalId = payload?.toTerminalId;
      if (!targetTerminalId) {
        cb({ success: false, message: 'missing target terminal' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_DISCONNECT',
        fromTerminalId: terminalId
      });
      audit.log({ action: 'poleis_disconnect', userId, description: `from:${targetTerminalId}` });
      cb({ success: sent });
    });

    socket.on(SOCKET_EVENTS.POLEIS_NAT_RETRY, async (payload, cb = () => {}) => {
      // 请求对方重发NAT信息（用于打洞协调）
      const targetTerminalId = payload?.toTerminalId;
      if (!targetTerminalId) {
        cb({ success: false, message: 'missing target terminal' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_NAT_RETRY',
        fromTerminalId: terminalId,
        fromUserId: userId
      });
      audit.log({ action: 'poleis_nat_retry', userId, description: `to:${targetTerminalId}` });
      cb({ success: sent });
    });

    // Parsec-style relay fallback: a peer asks the web to allocate a relay
    // session for an existing NAT session. The web authorizes a one-time token
    // on the UDP relay, returns the relay endpoint+token to the requester, and
    // pushes a relay_offer (same token+endpoint) to the other peer so both BIND
    // to the same relay session and tunnel their QUIC stream through it.
    socket.on(SOCKET_EVENTS.POLEIS_RELAY_REQUEST, async (payload, cb = () => {}) => {
      const targetTerminalId = payload?.toTerminalId;
      const sessionId = payload?.sessionId;
      if (!targetTerminalId || !sessionId) {
        cb({ success: false, message: 'missing target terminal or sessionId' });
        return;
      }
      if (!relay) {
        cb({ success: false, message: 'relay not available' });
        return;
      }
      const existing = natSessions.get(sessionId);
      // Reuse a token already allocated for this NAT session if present.
      let token = existing && existing.relayToken;
      if (!token) {
        token = randomBytes(16).toString('hex');
      }
      relay.authorizeSession(token);
      if (existing) {
        existing.relayToken = token;
        existing.state = 'relay';
      }
      const host = relayPublicHost || socket.handshake.headers['x-forwarded-host'] ||
                   (socket.handshake.headers.host || '').split(':')[0] || '';
      const relayInfo = { token, relayHost: host, relayPort: relayPublicPort };

      // Push relay_offer to the peer (the agent side binds with role=agent).
      await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_RELAY_OFFER',
        sessionId,
        fromTerminalId: terminalId,
        fromUserId: userId,
        relay: relayInfo
      });
      audit.log({ action: 'poleis_relay_request', userId, description: `session:${sessionId} to:${targetTerminalId}` });
      cb({ success: true, relay: relayInfo });
    });

    socket.on(SOCKET_EVENTS.POLEIS_RELAY_ANSWER, async (payload, cb = () => {}) => {
      if (!relay) {
        cb({ success: false, message: 'relay disabled' });
        return;
      }
      const targetTerminalId = payload?.toTerminalId;
      const sessionId = payload?.sessionId;
      if (!targetTerminalId || !sessionId) {
        cb({ success: false, message: 'missing target terminal or sessionId' });
        return;
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_RELAY_ANSWER',
        sessionId,
        fromTerminalId: terminalId,
        fromUserId: userId,
        ok: payload?.ok !== false
      });
      cb({ success: sent });
    });

    socket.on('disconnect', async () => {
      socketIndex.delete(socket.id);
      const set = terminalIndex.get(terminalId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          terminalIndex.delete(terminalId);
        }
      }
      await presence.removeBySocket(socket.id);
      for (const [sessionId, session] of natSessions.entries()) {
        if (session.clientTerminalId === terminalId || session.agentTerminalId === terminalId) {
          if (relay && session.relayToken) relay.revokeSession(session.relayToken);
          natSessions.delete(sessionId);
        }
      }
      for (const [pairKey, entry] of relayPairTokens.entries()) {
        if (pairKey.split('|').includes(terminalId)) {
          if (relay && entry.token) relay.revokeSession(entry.token);
          relayPairTokens.delete(pairKey);
        }
      }
      io.to(userRoom).emit(SOCKET_EVENTS.ENDPOINT_OFFLINE, { terminalId, userId, socketId: socket.id });
      audit.log({ action: 'disconnect', userId, description: `terminal:${terminalId}`, payload: { socketId: socket.id } });
    });
  });

  return io;
};

module.exports = {
  buildSocketServer,
  SOCKET_EVENTS
};
