'use strict';

const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();

const security = require('../middleware/security');
const controller = require('../controllers/relayAdminController');
const { relayRegistry } = require('../services/realtime/relay_registry');
const { resolveTenantContext } = require('../services/management/tenant_context');

const resolveRelayAccess = async (req, res, next) => {
  try {
    const user = security.getCurrentUser(req, res);
    if (!user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (security.isPlatformAdmin(user)) {
      req.relayAccess = { scope: 'global', tenantId: null, workspaceType: 'platform', canManage: true };
      return next();
    }
    const context = await resolveTenantContext(req, user);
    const tenant = context?.tenant;
    if (!tenant?.id) return res.status(403).json({ success: false, message: 'No active workspace' });
    const canManage = tenant.type === 'personal' || context.role === 'owner' || context.role === 'admin';
    if (!canManage) return res.status(403).json({ success: false, message: 'Enterprise administrator permission required' });
    req.relayAccess = {
      scope: 'tenant',
      tenantId: tenant.id,
      workspaceType: tenant.type,
      workspaceName: tenant.name,
      canManage: true
    };
    return next();
  } catch (error) {
    console.error('[RelayAdmin.resolveAccess]', error);
    return res.status(500).json({ success: false, message: 'Failed to resolve relay scope' });
  }
};

// Relay 节点按管理者上下文分层：平台超管=global，个人空间本人/企业管理员=tenant。
// 注意：心跳上报接口允许「节点静态密钥签名」认证（供 coturn sidecar 直接调用），
// 因此心跳路由挂载在 requireAuthenticated 之前；其余管理路由需会话 + 平台超管。

/**
 * 心跳上报：节点 sidecar 上报。
 * 认证方式二选一：
 *   1) 节点静态密钥签名（供 coturn sidecar）：sidecar 用与 coturn static-auth-secret
 *      相同的密钥，对 `${nodeId}:${timestamp}` 做 HMAC-SHA1，放在头：
 *        X-Relay-Timestamp: <秒级时间戳>
 *        X-Relay-Signature: <hex hmac>
 *      时间戳允许 ±300s 偏差防重放。
 *   2) 浏览器会话（已登录超管）。
 */
const heartbeatAuth = async (req, res, next) => {
  const nodeId = req.params.id;
  const sig = req.get('X-Relay-Signature');
  const ts = req.get('X-Relay-Timestamp');
  // 路径 A：节点静态密钥签名
  if (sig && ts) {
    try {
      const tsNum = Number(ts);
      if (!Number.isFinite(tsNum)) return res.status(401).json({ success: false, message: 'Invalid timestamp' });
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - tsNum) > 300) return res.status(401).json({ success: false, message: 'Timestamp expired' });
      const node = await relayRegistry.getNodeRaw(nodeId);
      if (!node || !node.staticSecret) return res.status(401).json({ success: false, message: 'Node secret not configured' });
      const expected = crypto.createHmac('sha1', node.staticSecret).update(`${nodeId}:${ts}`).digest('hex');
      const got = String(sig).toLowerCase();
      const expectedBuf = Buffer.from(expected);
      const gotBuf = Buffer.from(got);
      if (gotBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(gotBuf, expectedBuf)) {
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
      req.relayNodeAuthenticated = true;
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Auth error' });
    }
  }
  // 路径 B：浏览器会话
  if (!security.getCurrentUser(req, res)) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  return resolveRelayAccess(req, res, next);
};

// 心跳路由（自定义认证，不走全局 requireAuthenticated）
router.post('/nodes/:id/heartbeat', heartbeatAuth, controller.heartbeat);

// 其余管理路由：需会话，并解析 global / 当前工作区作用域。
router.use(security.requireAuthenticated);

router.use(resolveRelayAccess);
router.get('/nodes', controller.listNodes);
router.post('/nodes', controller.createNode);
router.put('/nodes/:id', controller.updateNode);
router.delete('/nodes/:id', controller.deleteNode);
router.post('/nodes/:id/drain', controller.drainNode);
router.get('/nodes/:id/metrics', controller.metrics);

module.exports = router;
