'use strict';

const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();

const security = require('../middleware/security');
const controller = require('../controllers/relayAdminController');
const { relayRegistry } = require('../services/realtime/relay_registry');

// Relay 节点管理为平台超管能力（跨租户基础设施）。
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
      return next();
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Auth error' });
    }
  }
  // 路径 B：浏览器会话
  if (!security.getCurrentUser(req, res)) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  return next();
};

// 心跳路由（自定义认证，不走全局 requireAuthenticated）
router.post('/nodes/:id/heartbeat', heartbeatAuth, controller.heartbeat);

// 其余管理路由：需会话 + 平台超管
router.use(security.requireAuthenticated);

router.get('/nodes', security.requirePlatformAdmin, controller.listNodes);
router.post('/nodes', security.requirePlatformAdmin, controller.createNode);
router.put('/nodes/:id', security.requirePlatformAdmin, controller.updateNode);
router.delete('/nodes/:id', security.requirePlatformAdmin, controller.deleteNode);
router.post('/nodes/:id/drain', security.requirePlatformAdmin, controller.drainNode);
router.get('/nodes/:id/metrics', security.requirePlatformAdmin, controller.metrics);

module.exports = router;
