'use strict';

const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
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
 *      相同的密钥，对节点、时间戳、nonce 和指标做 HMAC-SHA256，放在头：
 *        X-Relay-Timestamp: <秒级时间戳>
 *        X-Relay-Nonce: <16-128 位随机字符串>
 *        X-Relay-Signature: <hex hmac>
 *      时间戳允许 ±300s 偏差防重放。
 *   2) 浏览器会话（已登录超管）。
 */
const canonicalHeartbeatBody = (body = {}) => {
  const activeSessions = body.activeSessions == null ? '' : String(body.activeSessions);
  const totalBytes = body.totalBytes == null ? '' : String(body.totalBytes);
  return `${activeSessions}:${totalBytes}`;
};

const secureHexEqual = (a, b) => {
  if (!/^[0-9a-f]+$/i.test(String(a || '')) || !/^[0-9a-f]+$/i.test(String(b || ''))) return false;
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const heartbeatAuth = async (req, res, next) => {
  const nodeId = req.params.id;
  const sig = req.get('X-Relay-Signature');
  const ts = req.get('X-Relay-Timestamp');
  const nonce = req.get('X-Relay-Nonce');
  // 路径 A：节点静态密钥签名
  if (sig && ts) {
    try {
      const tsNum = Number(ts);
      if (!Number.isFinite(tsNum)) return res.status(401).json({ success: false, message: 'Invalid timestamp' });
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - tsNum) > 300) return res.status(401).json({ success: false, message: 'Timestamp expired' });
      const node = await relayRegistry.getNodeRaw(nodeId);
      if (!node || node.deleted || !node.enabled || !node.staticSecret) return res.status(401).json({ success: false, message: 'Node unavailable or secret not configured' });
      let expected;
      let nonceToClaim = null;
      if (nonce && /^[A-Za-z0-9._~-]{16,128}$/.test(nonce)) {
        nonceToClaim = nonce;
        const signed = `${nodeId}:${ts}:${nonce}:${canonicalHeartbeatBody(req.body)}`;
        expected = crypto.createHmac('sha256', node.staticSecret).update(signed).digest('hex');
      } else if (String(process.env.RELAY_ALLOW_LEGACY_HEARTBEAT_AUTH || '').toLowerCase() === 'true') {
        expected = crypto.createHmac('sha1', node.staticSecret).update(`${nodeId}:${ts}`).digest('hex');
      } else {
        return res.status(401).json({ success: false, message: 'Valid nonce required' });
      }
      if (!secureHexEqual(sig, expected)) {
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
      if (nonceToClaim && !(await relayRegistry.claimHeartbeatNonce(nodeId, nonceToClaim))) {
        return res.status(401).json({ success: false, message: 'Nonce already used' });
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
const configuredMutationLimit = Number(process.env.RELAY_ADMIN_RATE_LIMIT || 60);
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number.isInteger(configuredMutationLimit) && configuredMutationLimit > 0 ? configuredMutationLimit : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many relay management requests' }
});
router.get('/nodes', controller.listNodes);
router.post('/nodes', mutationLimiter, controller.createNode);
router.put('/nodes/:id', mutationLimiter, controller.updateNode);
router.delete('/nodes/:id', mutationLimiter, controller.deleteNode);
router.post('/nodes/:id/drain', mutationLimiter, controller.drainNode);
router.get('/nodes/:id/metrics', controller.metrics);

module.exports = router;
