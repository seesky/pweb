'use strict';

const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const { randomUUID, randomBytes } = require('node:crypto');
const { SocketTokenService } = require('./token_service');
const { PresenceService } = require('./presence_service');
const { AuditService } = require('./audit_service');
const { AssistanceService } = require('./assistance_service');
const { platformService } = require('../management/platform_service');
const { resolveTenantId } = require('../management/tenant_context');
const socketControl = require('./socket_control');
const prisma = new PrismaClient();

const SOCKET_EVENTS = {
  AUTH: 'auth',
  HEARTBEAT: 'heartbeat',
  LIST_MY: 'list_my_endpoints',
  LIST_USER: 'list_user_endpoints',
  LIST_ACCESSIBLE: 'list_accessible_devices',
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
  ASSIST_REGISTER: 'assist_register',
  ASSIST_REFRESH: 'assist_refresh',
  ASSIST_UNREGISTER: 'assist_unregister',
  ASSIST_CONNECT: 'assist_connect',
  ASSIST_GRANTED: 'assist_granted',
  ASSIST_REVOKED: 'assist_revoked',
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
  const allowedOrigins = String(process.env.ALLOWED_ORIGINS || process.env.PUBLIC_BASE_URL || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production' && !allowedOrigins.length) {
    throw new Error('ALLOWED_ORIGINS or PUBLIC_BASE_URL is required in production');
  }
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
        return callback(new Error('origin not allowed'));
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    maxHttpBufferSize: 1024 * 1024
  });
  const tokenService = new SocketTokenService();
  const presence = new PresenceService();
  const assistance = new AssistanceService();
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
  // 同理清理远程协助配对数据（partner/grant 生命周期 = socket 连接，断线即删；
  // 此处兜底清除上次非正常退出残留的幽灵配对）。
  assistance.clearAllPartners().then(() => {
    console.log('[socket.io] Cleared stale assistance data on startup');
  }).catch((err) => {
    console.error('[socket.io] Failed to clear assistance data:', err);
  });

  const socketIndex = new Map(); // socketId -> { userId, terminalId }
  const terminalIndex = new Map(); // terminalId -> Set<socketId>
  const natSessions = new Map(); // sessionId -> { clientTerminalId, agentTerminalId, createdAt, state }
  const platformSessionIndex = new Map(); // signaling session/pair -> poleis_session.ID
  const relayPairTokens = new Map(); // sorted "termA|termB" -> { token, createdAt }
  const authorizedPairs = new Map(); // sorted terminal pair -> expiry timestamp
  const pairKey = (a, b) => [String(a || ''), String(b || '')].sort().join('|');
  const authorizePair = (a, b, ttlMs = 10 * 60 * 1000) => {
    if (a && b) authorizedPairs.set(pairKey(a, b), Date.now() + ttlMs);
  };
  const isPairAuthorized = (a, b) => {
    const key = pairKey(a, b);
    const expiresAt = authorizedPairs.get(key) || 0;
    if (expiresAt <= Date.now()) {
      authorizedPairs.delete(key);
      return false;
    }
    return true;
  };

  const forgetPlatformSession = (sessionId) => {
    if (!sessionId) return;
    for (const [key, value] of platformSessionIndex.entries()) {
      if (value === sessionId) platformSessionIndex.delete(key);
    }
  };

  const completePlatformSessionsForPair = async (terminalA, terminalB, extra = {}) => {
    if (!terminalA || !terminalB) return [];
    const pairA = `${terminalA}|${terminalB}`;
    const pairB = `${terminalB}|${terminalA}`;
    const sessionIds = new Set([
      platformSessionIndex.get(pairA),
      platformSessionIndex.get(pairB)
    ].filter(Boolean));
    const completed = [];
    for (const sessionId of sessionIds) {
      await platformService.completeSession(sessionId, 'ended', extra);
      completed.push(sessionId);
      forgetPlatformSession(sessionId);
    }
    platformSessionIndex.delete(pairA);
    platformSessionIndex.delete(pairB);
    const fallbackCompleted = await platformService.completeActiveSessionsBetween(
      terminalA,
      terminalB,
      'ended',
      extra
    );
    for (const sessionId of fallbackCompleted) {
      forgetPlatformSession(sessionId);
      completed.push(sessionId);
    }
    return completed;
  };

  const closeNatSession = (sessionId) => {
    if (!sessionId) return null;
    const session = natSessions.get(sessionId);
    if (session && relay && session.relayToken) relay.revokeSession(session.relayToken);
    natSessions.delete(sessionId);
    return session || null;
  };

  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const [sessionId, session] of natSessions.entries()) {
      if (!session.createdAt || session.createdAt < cutoff) {
        const platformSessionId = platformSessionIndex.get(sessionId);
        const isConnected = session.state === 'POLEIS_NAT_CONNECTED' || session.state === 'connected';
        if (platformSessionId && !isConnected) {
          platformService.completeSession(platformSessionId, 'failed', {
            failReason: 'nat session timeout'
          }).catch((err) => console.error('[socket.io] failed to timeout nat session:', err));
          forgetPlatformSession(platformSessionId);
        }
        closeNatSession(sessionId);
      }
    }
  }, 60 * 1000).unref();

  const emitError = (socket, message) => {
    socket.emit(SOCKET_EVENTS.ERROR, { message });
  };

  // 服务端主动向某终端推送一条 MESSAGE（系统身份），用于管理员强制断开等场景。
  const serverEmitToTerminal = async (targetTerminalId, payload) => {
    if (!targetTerminalId) return false;
    let targetSocketIds = Array.from(terminalIndex.get(targetTerminalId) || []);
    if (!targetSocketIds.length) {
      const endpoints = await presence.getEndpointsByTerminal(targetTerminalId);
      targetSocketIds = endpoints.map((ep) => ep.socketId).filter(Boolean);
    }
    let delivered = 0;
    for (const sid of targetSocketIds) {
      if (!io.sockets.sockets.get(sid)) continue;
      io.to(sid).emit(SOCKET_EVENTS.MESSAGE, {
        fromUserId: 'system',
        fromTerminalId: 'system',
        payload,
        ts: Date.now()
      });
      delivered += 1;
    }
    return delivered > 0;
  };

  // 管理员从 Web 强制断开一个进行中的会话：通知双方终端并把会话标记为结束。
  socketControl.registerForceDisconnect(async (sessionId) => {
    const session = await platformService.getSession(sessionId);
    if (!session) return { ok: false, reason: 'NOT_FOUND' };
    if (session.result !== 'active') return { ok: false, reason: 'NOT_ACTIVE' };
    const msg = { type: 'POLEIS_DISCONNECT', fromTerminalId: 'system', reason: 'admin_force' };
    await serverEmitToTerminal(session.targetTerminal, msg);
    await serverEmitToTerminal(session.controllerTerminal, msg);
    await platformService.completeSession(sessionId, 'ended', { failReason: '管理员强制断开' })
      .catch((err) => console.error('[socket.io] force-disconnect complete failed:', err));
    forgetPlatformSession(sessionId);
    return { ok: true };
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const deviceInfo = socket.handshake.auth?.deviceInfo || {};
    const terminalIdFromClient = socket.handshake.auth?.terminalId || socket.handshake.query?.terminalId;
    const payload = tokenService.verify(token);
    if (!payload) {
      return next(new Error('unauthorized'));
    }
    socket.data.deviceInfo = deviceInfo;
    if (payload.kind === 'device') {
      // 企业版被控主机：设备身份 token，无需用户登录。终端/租户以 token 为准。
      if (!payload.did || !payload.tid) return next(new Error('unauthorized'));
      socket.data.isDevice = true;
      socket.data.deviceId = payload.did;
      socket.data.deviceTenantId = payload.tenant || null;
      socket.data.terminalId = payload.tid;
      socket.data.userId = 'device:' + payload.did; // 合成 id，仅用于路由/索引
      const device = await prisma.poleis_device.findFirst({
        where: {
          ID: payload.did,
          TERMINALID: payload.tid,
          TENANTID: payload.tenant || undefined,
          ENABLED: 1,
          DELETEMARK: 0
        },
        select: { ID: true }
      });
      if (!device) return next(new Error('unauthorized'));
      return next();
    }
    if (!payload.uid) {
      return next(new Error('unauthorized'));
    }
    const user = await prisma.piuser.findFirst({
      where: { ID: payload.uid, ENABLED: 1, DELETEMARK: 0 },
      select: { ID: true }
    });
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = payload.uid;
    socket.data.terminalId = terminalIdFromClient || payload.tid || randomUUID();
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
    // 设备落到正确租户：
    //  - 设备 token（企业被控主机）：用 token 内的企业租户（已 enroll，租户钉死）。
    //  - 用户 token：连接用户所属租户（个人=u:<userId> / 单租户=default / 企业成员=企业）。
    // 解析一次，online/heartbeat 复用。saas 下账号未加入任何企业则跳过纳管。
    let deviceTenantId = null;
    if (socket.data.isDevice) {
      deviceTenantId = socket.data.deviceTenantId;
    } else {
      try {
        deviceTenantId = await resolveTenantId({ Id: userId });
      } catch (err) {
        console.error('[socket.io] resolve device tenant failed:', err);
      }
    }
    const devicePlatform = deviceTenantId ? platformService.forTenant(deviceTenantId) : null;
    if (devicePlatform) {
      devicePlatform.upsertDeviceFromPresence({
        userId,
        terminalId,
        ip,
        os,
        deviceInfo: socket.data.deviceInfo,
        status: 'online'
      }).catch((err) => console.error('[socket.io] device presence upsert failed:', err));
    }
    const onlinePayload = { terminalId, userId, ip, ua, os, lastSeen: Date.now() };
    io.to(userRoom).emit(SOCKET_EVENTS.ENDPOINT_ONLINE, onlinePayload);
    audit.log({ action: 'connect', userId, ip, description: `terminal:${terminalId}` });

    socket.emit(SOCKET_EVENTS.AUTH, { ok: true, userId, terminalId });
    const snapshot = await presence.getEndpointsByUser(userId);
    socket.emit(SOCKET_EVENTS.ENDPOINTS_SNAPSHOT, { success: true, data: snapshot });

    socket.on(SOCKET_EVENTS.HEARTBEAT, async () => {
      await presence.updateLastSeen(terminalId, socket.id);
      if (devicePlatform) {
        devicePlatform.upsertDeviceFromPresence({
          userId,
          terminalId,
          ip,
          os,
          deviceInfo: socket.data.deviceInfo,
          status: 'online'
        }).catch((err) => console.error('[socket.io] device heartbeat upsert failed:', err));
      }
    });

    socket.on(SOCKET_EVENTS.LIST_MY, async (cb = () => {}) => {
      const endpoints = await presence.getEndpointsByUser(userId);
      cb({ success: true, data: endpoints });
    });

    // 控制端发现：当前用户在各 workspace 内可连接的设备（个人自有 + 企业被授权）。
    // 设备身份(被控端)不需要此列表。
    socket.on(SOCKET_EVENTS.LIST_ACCESSIBLE, async (cb = () => {}) => {
      if (socket.data.isDevice) { cb({ success: false, message: 'device endpoint' }); return; }
      try {
        const data = await platformService.listAccessibleDevices(userId);
        cb({ success: true, data });
      } catch (err) {
        console.error('[socket.io] list_accessible_devices failed:', err);
        cb({ success: false, message: 'failed to list accessible devices' });
      }
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
      const ownEndpoints = await presence.getEndpointsByUser(userId);
      if (!ownEndpoints.some((endpoint) => endpoint.terminalId === targetTerminalId)) {
        cb({ success: false, message: 'forbidden' });
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
      if (toUserId !== userId) {
        cb({ success: false, message: 'forbidden' });
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

    socket.on(SOCKET_EVENTS.ASSIST_REGISTER, async (payload, cb = () => {}) => {
      try {
        const result = await assistance.registerPartner({
          desiredPartnerId: payload?.desiredPartnerId,
          terminalId,
          userId,
          socketId: socket.id,
          saltHex: payload?.saltHex,
          pwdHashHex: payload?.pwdHashHex
        });
        audit.log({ action: 'assist_register', userId, description: `terminal:${terminalId} partner:${result.partnerId}` });
        cb({ success: true, partnerId: result.partnerId });
      } catch (err) {
        audit.log({ action: 'assist_register_failed', userId, description: String(err?.message || err) });
        cb({ success: false, code: 'INVALID_REQUEST', message: 'invalid assistance registration' });
      }
    });

    socket.on(SOCKET_EVENTS.ASSIST_REFRESH, async (payload, cb = () => {}) => {
      try {
        const ok = await assistance.refreshPassword({
          terminalId,
          saltHex: payload?.saltHex,
          pwdHashHex: payload?.pwdHashHex
        });
        audit.log({ action: ok ? 'assist_refresh' : 'assist_refresh_failed', userId, description: `terminal:${terminalId}` });
        cb({ success: ok, code: ok ? undefined : 'NOT_REGISTERED' });
      } catch (err) {
        cb({ success: false, code: 'INVALID_REQUEST' });
      }
    });

    // Host turned off "允许远程协助接入": stop advertising so assist_connect returns
    // OFFLINE immediately (no grant issued). Scoped to this socket's terminal.
    socket.on(SOCKET_EVENTS.ASSIST_UNREGISTER, async (payload, cb = () => {}) => {
      await assistance.removeByTerminal(terminalId, socket.id);
      audit.log({ action: 'assist_unregister', userId, description: `terminal:${terminalId}` });
      cb({ success: true });
    });

    socket.on(SOCKET_EVENTS.ASSIST_CONNECT, async (payload, cb = () => {}) => {
      const partnerId = String(payload?.partnerId || '').replace(/\D/g, '').slice(0, 9);
      const password = String(payload?.password || '');
      if (!partnerId || !password) {
        cb({ success: false, code: 'INVALID_REQUEST' });
        return;
      }
      if (assistance.isRateLimited(partnerId, userId)) {
        audit.log({ action: 'assist_connect_rate_limited', userId, description: `partner:${partnerId}` });
        cb({ success: false, code: 'RATE_LIMITED' });
        return;
      }
      const partner = await assistance.lookupPartner(partnerId);
      if (!partner) {
        assistance.recordFailure(partnerId, userId);
        audit.log({ action: 'assist_connect_offline', userId, description: `partner:${partnerId}` });
        cb({ success: false, code: 'OFFLINE' });
        return;
      }
      if (!assistance.verifyPassword(partner, password)) {
        assistance.recordFailure(partnerId, userId);
        audit.log({ action: 'assist_connect_bad_password', userId, description: `partner:${partnerId}` });
        cb({ success: false, code: 'BAD_PASSWORD' });
        return;
      }

      assistance.clearFailures(partnerId, userId);
      const grantToken = await assistance.issueGrant({
        hostTerminalId: partner.terminalId,
        controllerTerminalId: terminalId,
        controllerUserId: userId,
        partnerId
      });
      const assistPlatformSessionId = await platformService.createSession({
        controllerUserId: userId,
        controllerTerminal: terminalId,
        targetTerminal: partner.terminalId,
        transport: 'assist'
      }).catch((err) => {
        console.error('[socket.io] failed to create assist session:', err);
        return null;
      });
      if (assistPlatformSessionId) {
        platformSessionIndex.set(`assist:${grantToken}`, assistPlatformSessionId);
        platformSessionIndex.set(`${terminalId}|${partner.terminalId}`, assistPlatformSessionId);
      }
      const granted = await sendToTerminal(partner.terminalId, {
        type: 'ASSIST_GRANTED',
        grantToken,
        controllerTerminalId: terminalId,
        controllerUserId: userId,
        partnerId,
        ts: Date.now()
      });
      audit.log({
        action: granted ? 'assist_connect' : 'assist_connect_host_unreachable',
        userId,
        description: `partner:${partnerId} host:${partner.terminalId}`
      });
      if (!granted) {
        cb({ success: false, code: 'OFFLINE' });
        return;
      }
      cb({
        success: true,
        hostTerminalId: partner.terminalId,
        hostUserId: partner.userId,
        grantToken
      });
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
      let validGrant = false;
      if (payload?.grantToken) {
        const grant = await assistance.consumeGrant(payload.grantToken);
        validGrant = !!(
          grant &&
          grant.hostTerminalId === targetTerminalId &&
          grant.controllerTerminalId === terminalId &&
          grant.controllerUserId === userId
        );
      }
      const authz = await platformService.isAuthorized({
        controllerUserId: userId,
        targetTerminalId,
        ip
      }).catch((err) => {
        console.error('[socket.io] authorization check failed:', err);
        return { allowed: false, reason: 'AUTHZ_ERROR' };
      });
      if (!authz.allowed && !validGrant) {
        audit.log({
          category: 'authz',
          action: 'poleis_connect_denied',
          userId,
          ip,
          description: `to:${targetTerminalId} reason:${authz.reason}`
        });
        cb({ success: false, message: authz.reason || 'forbidden' });
        return;
      }
      authorizePair(terminalId, targetTerminalId);
      const connectPlatformSessionId = await platformService.createSession({
        controllerUserId: userId,
        controllerTerminal: terminalId,
        targetTerminal: targetTerminalId,
        profileId: authz.profileId,
        transport: 'p2p'
      }).catch((err) => {
        console.error('[socket.io] failed to create connect session:', err);
        return null;
      });
      if (connectPlatformSessionId) {
        platformSessionIndex.set(`${terminalId}|${targetTerminalId}`, connectPlatformSessionId);
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_CONNECT_REQUEST',
        fromTerminalId: terminalId,
        fromUserId: userId,
        grantToken: validGrant ? payload.grantToken : '',
        // 把生效的权限模板能力位下发给 agent，由 agent 真正强制（只读/文件/剪贴板/确认/超时等）
        profile: authz.profile || null,
        // 生效的设备策略（客户端运行配置：码率/帧率/传输偏好/自动更新/日志保留）
        policy: authz.policy || null
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
      if (!isPairAuthorized(terminalId, targetTerminalId)) {
        cb({ success: false, message: 'forbidden' });
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
      if (!isPairAuthorized(terminalId, targetTerminalId)) {
        cb({ success: false, message: 'forbidden' });
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
      if (!isPairAuthorized(terminalId, targetTerminalId)) {
        cb({ success: false, message: 'forbidden' });
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
      if (existing) {
        const validParticipants =
          (existing.clientTerminalId === terminalId && existing.agentTerminalId === targetTerminalId) ||
          (existing.agentTerminalId === terminalId && existing.clientTerminalId === targetTerminalId);
        if (!validParticipants) {
          cb({ success: false, message: 'forbidden' });
          return;
        }
      }

      let connectAuthz = null;
      let validGrant = false;
      if (eventType === 'POLEIS_NAT_CONNECT_REQUEST') {
        if (payload?.grantToken) {
          const grant = await assistance.consumeGrant(payload.grantToken);
          validGrant = !!(
            grant &&
            grant.hostTerminalId === targetTerminalId &&
            grant.controllerTerminalId === terminalId &&
            grant.controllerUserId === userId
          );
        }
        connectAuthz = await platformService.isAuthorized({
          controllerUserId: userId,
          targetTerminalId,
          ip
        }).catch((err) => {
          console.error('[socket.io] authorization check failed:', err);
          return { allowed: false, reason: 'AUTHZ_ERROR' };
        });
        if (!connectAuthz.allowed && !validGrant) {
          audit.log({
            category: 'authz',
            action: 'poleis_nat_connect_denied',
            userId,
            ip,
            description: `session:${sessionId} to:${targetTerminalId} reason:${connectAuthz.reason}`
          });
          cb({ success: false, message: connectAuthz.reason || 'forbidden' });
          return;
        }
        authorizePair(terminalId, targetTerminalId);
        natSessions.set(sessionId, {
          clientTerminalId: terminalId,
          agentTerminalId: targetTerminalId,
          createdAt: Date.now(),
          state: 'requested'
        });
        const natPlatformSessionId = await platformService.createSession({
          controllerUserId: userId,
          controllerTerminal: terminalId,
          targetTerminal: targetTerminalId,
          profileId: connectAuthz.profileId,
          transport: 'p2p'
        }).catch((err) => {
          console.error('[socket.io] failed to create nat session:', err);
          return null;
        });
        if (natPlatformSessionId) platformSessionIndex.set(sessionId, natPlatformSessionId);
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
        error: payload?.error,
        grantToken: validGrant ? payload.grantToken : '',
        // 仅连接请求阶段带上权限模板能力位 + 设备策略，供 agent 强制 / 配置
        profile: connectAuthz ? (connectAuthz.profile || null) : undefined,
        policy: connectAuthz ? (connectAuthz.policy || null) : undefined
      });
      const platformSessionId = platformSessionIndex.get(sessionId);
      if (platformSessionId) {
        const eventNameMap = {
          POLEIS_NAT_CONNECT_REQUEST: 'request',
          POLEIS_NAT_INFO: 'nat_info',
          POLEIS_NAT_PUNCH_START: 'nat_punch',
          POLEIS_NAT_CONNECTED: 'connected',
          POLEIS_NAT_FAILED: 'failed'
        };
        await platformService.addSessionEvent(platformSessionId, eventNameMap[eventType] || eventType.toLowerCase(), {
          targetTerminalId,
          role: payload?.role,
          error: payload?.error || null
        }).catch((err) => console.error('[socket.io] failed to record session event:', err));
        if (eventType === 'POLEIS_NAT_FAILED') {
          await platformService.completeSession(platformSessionId, 'failed', {
            failReason: payload?.error?.message || payload?.error || 'nat failed'
          }).catch((err) => console.error('[socket.io] failed to complete failed session:', err));
          forgetPlatformSession(platformSessionId);
          closeNatSession(sessionId);
        }
      } else if (eventType === 'POLEIS_NAT_FAILED') {
        await platformService.completeActiveSessionsBetween(terminalId, targetTerminalId, 'failed', {
          failReason: payload?.error?.message || payload?.error || 'nat failed'
        }).catch((err) => console.error('[socket.io] failed to fallback-complete failed nat session:', err));
        closeNatSession(sessionId);
      }
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
      let connectedPlatformSessionId =
        platformSessionIndex.get(`${terminalId}|${targetTerminalId}`) ||
        platformSessionIndex.get(`${targetTerminalId}|${terminalId}`);
      if (!connectedPlatformSessionId) {
        connectedPlatformSessionId = await platformService.findActiveSession(terminalId, targetTerminalId)
          .catch((err) => {
            console.error('[socket.io] failed to find connected active session:', err);
            return null;
          });
        if (connectedPlatformSessionId) {
          platformSessionIndex.set(`${terminalId}|${targetTerminalId}`, connectedPlatformSessionId);
        }
      }
      for (const session of natSessions.values()) {
        const samePair =
          (session.clientTerminalId === terminalId && session.agentTerminalId === targetTerminalId) ||
          (session.clientTerminalId === targetTerminalId && session.agentTerminalId === terminalId);
        if (samePair) session.state = 'connected';
      }
      if (connectedPlatformSessionId) {
        await platformService.addSessionEventOnce(connectedPlatformSessionId, 'connected', {
          targetTerminalId
        }).catch((err) => console.error('[socket.io] failed to record connected event:', err));
      }
      await platformService.addSessionEventToActiveBetween(terminalId, targetTerminalId, 'connected', {
        targetTerminalId
      }).catch((err) => console.error('[socket.io] failed to fallback-record connected event:', err));
      audit.log({ action: 'poleis_connected', userId, description: `with:${targetTerminalId}` });
      cb({ success: sent });
    });

    socket.on(SOCKET_EVENTS.POLEIS_DISCONNECT, async (payload, cb = () => {}) => {
      // 断开P2P连接通知
      const targetTerminalId = payload?.toTerminalId;
      const sessionId = payload?.sessionId;
      if (!targetTerminalId) {
        cb({ success: false, message: 'missing target terminal' });
        return;
      }
      if (sessionId) {
        const platformSessionId = platformSessionIndex.get(sessionId);
        if (platformSessionId) {
          await platformService.completeSession(platformSessionId, 'ended', {
            failReason: payload?.reason || null,
            transport: payload?.transport,
            targetTerminalId
          }).catch((err) => console.error('[socket.io] failed to end nat session:', err));
          forgetPlatformSession(platformSessionId);
        }
        closeNatSession(sessionId);
      }
      const sent = await sendToTerminal(targetTerminalId, {
        type: 'POLEIS_DISCONNECT',
        fromTerminalId: terminalId,
        sessionId
      });
      await completePlatformSessionsForPair(terminalId, targetTerminalId, {
        transport: payload?.transport,
        failReason: payload?.reason || null,
        targetTerminalId
      }).catch((err) => console.error('[socket.io] failed to end session:', err));
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
      const relayPlatformSessionId = platformSessionIndex.get(sessionId);
      if (relayPlatformSessionId) {
        platformService.addSessionEvent(relayPlatformSessionId, 'relay_fallback', {
          targetTerminalId
        }).catch((err) => console.error('[socket.io] failed to record relay event:', err));
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
      await assistance.removeByTerminal(terminalId, socket.id);
      for (const [sessionId, session] of natSessions.entries()) {
        if (session.clientTerminalId === terminalId || session.agentTerminalId === terminalId) {
          const disconnectedPlatformSessionId = platformSessionIndex.get(sessionId);
          if (disconnectedPlatformSessionId) {
            platformService.completeSession(disconnectedPlatformSessionId, 'ended', {
              failReason: 'terminal disconnected'
            }).catch((err) => console.error('[socket.io] failed to end disconnected session:', err));
            forgetPlatformSession(disconnectedPlatformSessionId);
            platformSessionIndex.delete(sessionId);
          }
          platformService.completeActiveSessionsBetween(session.clientTerminalId, session.agentTerminalId, 'ended', {
            failReason: 'terminal disconnected'
          }).then((sessionIds) => sessionIds.forEach(forgetPlatformSession))
            .catch((err) => console.error('[socket.io] failed to fallback-end disconnected sessions:', err));
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
      if (!terminalIndex.has(terminalId)) {
        platformService.completeActiveSessionsForTerminal(terminalId, 'ended', {
          failReason: 'terminal disconnected'
        }).then((sessionIds) => sessionIds.forEach(forgetPlatformSession))
          .catch((err) => console.error('[socket.io] failed to end terminal sessions:', err));
        platformService.markDeviceOffline(terminalId).catch((err) =>
          console.error('[socket.io] device offline update failed:', err)
        );
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
