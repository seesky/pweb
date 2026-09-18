'use strict';

/**
 * Relay 节点管理控制器。平台超管管理全局节点；个人空间本人和企业
 * owner/admin 仅管理当前工作区节点。
 */

const { relayRegistry } = require('../services/realtime/relay_registry');
const { resolveRelayProbeTarget } = require('../services/realtime/relay_host_policy');

const ALLOWED_STATUS = ['online', 'offline', 'draining'];

// 创建/更新节点的输入校验与规整
function normalizeInput(body, isCreate) {
  const out = {};
  if (body.name != null) out.name = String(body.name).trim();
  if (body.host != null) out.host = String(body.host).trim();
  if (body.port != null) out.port = Number(body.port);
  if (body.tlsPort != null) out.tlsPort = body.tlsPort ? Number(body.tlsPort) : null;
  if (body.region != null) out.region = body.region ? String(body.region).trim() : null;
  if (body.latitude != null) out.latitude = body.latitude === '' ? null : Number(body.latitude);
  if (body.longitude != null) out.longitude = body.longitude === '' ? null : Number(body.longitude);
  if (body.weight != null) out.weight = Number(body.weight);
  if (body.maxBandwidthKbps != null) out.maxBandwidthKbps = Number(body.maxBandwidthKbps);
  if (body.staticSecret != null) out.staticSecret = body.staticSecret ? String(body.staticSecret) : null;
  if (body.realm != null) out.realm = body.realm ? String(body.realm).trim() : null;
  if (body.status != null && ALLOWED_STATUS.includes(body.status)) out.status = body.status;
  if (body.enabled != null) {
    out.enabled = typeof body.enabled === 'string'
      ? !['0', 'false', 'no', 'off'].includes(body.enabled.trim().toLowerCase())
      : !!body.enabled;
  }
  return out;
}

function validateInput(input, body, isCreate) {
  if (isCreate && (!input.name || !input.host)) return 'name and host are required';
  if (input.name != null && (!input.name || input.name.length > 100)) return 'name must be 1-100 characters';
  if (input.host != null && (!input.host || input.host.length > 200)) return 'invalid host';
  const validPort = (value) => Number.isInteger(value) && value >= 1 && value <= 65535;
  if (input.port != null && !validPort(input.port)) return 'invalid port';
  if (input.tlsPort != null && !validPort(input.tlsPort)) return 'invalid TLS port';
  if (input.latitude != null && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) return 'invalid latitude';
  if (input.longitude != null && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)) return 'invalid longitude';
  if (input.weight != null && (!Number.isInteger(input.weight) || input.weight < 0 || input.weight > 1000)) return 'weight must be an integer between 0 and 1000';
  if (input.maxBandwidthKbps != null && (!Number.isInteger(input.maxBandwidthKbps) || input.maxBandwidthKbps < 0 || input.maxBandwidthKbps > 1000000000)) return 'invalid bandwidth limit';
  if (input.staticSecret != null && (input.staticSecret.length < 16 || input.staticSecret.length > 200)) return 'static secret must be 16-200 characters';
  if (input.realm != null && input.realm.length > 100) return 'realm is too long';
  if (body.status != null && !ALLOWED_STATUS.includes(body.status)) return 'invalid status';
  return null;
}

async function validateHostIfPresent(input) {
  if (input.host == null) return null;
  try {
    const resolved = await resolveRelayProbeTarget(input.host);
    input.host = resolved.host;
    return null;
  } catch (error) {
    return error.message || 'relay host is not allowed';
  }
}

function ownsNode(node, access) {
  if (!node || !access) return false;
  if (access.scope === 'global') return node.scope === 'global';
  return node.scope === 'tenant' && node.tenantId === access.tenantId;
}

async function getOwnedNode(id, req, res) {
  const node = await relayRegistry.get(id);
  if (!node || !ownsNode(node, req.relayAccess)) {
    res.status(404).json({ success: false, message: 'relay node not found' });
    return null;
  }
  return node;
}

exports.listNodes = async (req, res) => {
  try {
    const data = await relayRegistry.listAll(req.relayAccess);
    res.json({ success: true, data, context: req.relayAccess });
  } catch (error) {
    console.error('[RelayAdmin.listNodes]', error);
    res.status(500).json({ success: false, message: 'Failed to load relay nodes' });
  }
};

exports.createNode = async (req, res) => {
  const input = normalizeInput(req.body || {}, true);
  const validationError = validateInput(input, req.body || {}, true);
  if (validationError) return res.status(400).json({ success: false, message: validationError });
  if (!input.staticSecret && !process.env.RELAY_DEFAULT_STATIC_SECRET) {
    return res.status(400).json({ success: false, message: 'static secret is required' });
  }
  const hostError = await validateHostIfPresent(input);
  if (hostError) return res.status(400).json({ success: false, message: hostError });
  try {
    const configuredMaxNodes = req.relayAccess.scope === 'global'
      ? Number(process.env.RELAY_MAX_GLOBAL_NODES || 100)
      : Number(process.env.RELAY_MAX_TENANT_NODES || 10);
    const maxNodes = Number.isInteger(configuredMaxNodes) && configuredMaxNodes >= 0
      ? configuredMaxNodes
      : (req.relayAccess.scope === 'global' ? 100 : 10);
    const count = await relayRegistry.countAll(req.relayAccess);
    if (Number.isFinite(maxNodes) && maxNodes >= 0 && count >= maxNodes) {
      return res.status(409).json({ success: false, message: 'relay node quota exceeded' });
    }
    const node = await relayRegistry.upsert({
      ...input,
      scope: req.relayAccess.scope,
      tenantId: req.relayAccess.tenantId || 'default'
    });
    res.json({ success: true, data: node });
  } catch (error) {
    console.error('[RelayAdmin.createNode]', error);
    res.status(500).json({ success: false, message: 'Failed to create relay node' });
  }
};

exports.updateNode = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ success: false, message: 'missing id' });
  const input = normalizeInput(req.body || {}, false);
  const validationError = validateInput(input, req.body || {}, false);
  if (validationError) return res.status(400).json({ success: false, message: validationError });
  if (input.staticSecret === null && !process.env.RELAY_DEFAULT_STATIC_SECRET) {
    return res.status(400).json({ success: false, message: 'static secret cannot be cleared without a platform default' });
  }
  const hostError = await validateHostIfPresent(input);
  if (hostError) return res.status(400).json({ success: false, message: hostError });
  try {
    const existing = await getOwnedNode(id, req, res);
    if (!existing) return;
    const node = await relayRegistry.upsert({ id, ...input });
    if (!node) return res.status(404).json({ success: false, message: 'relay node not found' });
    res.json({ success: true, data: node });
  } catch (error) {
    console.error('[RelayAdmin.updateNode]', error);
    res.status(500).json({ success: false, message: 'Failed to update relay node' });
  }
};

exports.deleteNode = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ success: false, message: 'missing id' });
  try {
    const existing = await getOwnedNode(id, req, res);
    if (!existing) return;
    await relayRegistry.remove(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[RelayAdmin.deleteNode]', error);
    res.status(500).json({ success: false, message: 'Failed to delete relay node' });
  }
};

// 置 draining：不再分配新会话，存量自然结束
exports.drainNode = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ success: false, message: 'missing id' });
  try {
    const existing = await getOwnedNode(id, req, res);
    if (!existing) return;
    const node = await relayRegistry.upsert({ id, status: 'draining' });
    if (!node) return res.status(404).json({ success: false, message: 'relay node not found' });
    res.json({ success: true, data: node });
  } catch (error) {
    console.error('[RelayAdmin.drainNode]', error);
    res.status(500).json({ success: false, message: 'Failed to drain relay node' });
  }
};

// 实时指标（在线会话数/带宽/延迟/状态）
exports.metrics = async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ success: false, message: 'missing id' });
  try {
    const node = await getOwnedNode(id, req, res);
    if (!node) return;
    res.json({
      success: true,
      data: {
        id: node.id,
        name: node.name,
        status: node.status,
        activeSessions: node.activeSessions,
        totalBytes: node.totalBytes,
        lastLatencyMs: node.lastLatencyMs,
        lastHeartbeat: node.lastHeartbeat,
        enabled: node.enabled
      }
    });
  } catch (error) {
    console.error('[RelayAdmin.metrics]', error);
    res.status(500).json({ success: false, message: 'Failed to load relay metrics' });
  }
};

// TURN 节点/sidecar 上报心跳（可被平台管理员或节点自身调用）
exports.heartbeat = async (req, res) => {
  const id = req.params.id || req.body?.id;
  if (!id) return res.status(400).json({ success: false, message: 'missing id' });
  const activeSessions = req.body?.activeSessions;
  const totalBytes = req.body?.totalBytes;
  if (activeSessions != null && (!Number.isInteger(Number(activeSessions)) || Number(activeSessions) < 0)) {
    return res.status(400).json({ success: false, message: 'invalid activeSessions' });
  }
  if (totalBytes != null && !/^\d{1,30}$/.test(String(totalBytes))) {
    return res.status(400).json({ success: false, message: 'invalid totalBytes' });
  }
  try {
    if (!req.relayNodeAuthenticated) {
      const existing = await getOwnedNode(id, req, res);
      if (!existing) return;
    }
    const node = await relayRegistry.heartbeat(id, {
      activeSessions,
      totalBytes
    });
    if (!node) return res.status(404).json({ success: false, message: 'relay node not found' });
    res.json({ success: true, data: node });
  } catch (error) {
    console.error('[RelayAdmin.heartbeat]', error);
    res.status(500).json({ success: false, message: 'Failed to record heartbeat' });
  }
};
