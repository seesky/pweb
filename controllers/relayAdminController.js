'use strict';

/**
 * Relay 节点管理控制器（平台超管）。
 * 对应设计文档 §2.3 / §4.1。跨租户的 relay 基础设施管理。
 */

const { relayRegistry } = require('../services/realtime/relay_registry');

const ALLOWED_STATUS = ['online', 'offline', 'draining'];

// 创建/更新节点的输入校验与规整
function normalizeInput(body, isCreate) {
  const out = {};
  if (body.name != null) out.name = String(body.name).trim();
  if (body.host != null) out.host = String(body.host).trim();
  if (body.port != null) out.port = Number(body.port);
  if (body.tlsPort != null) out.tlsPort = body.tlsPort ? Number(body.tlsPort) : null;
  if (body.region != null) out.region = body.region ? String(body.region).trim() : null;
  if (body.latitude != null) out.latitude = body.latitude ? Number(body.latitude) : null;
  if (body.longitude != null) out.longitude = body.longitude ? Number(body.longitude) : null;
  if (body.weight != null) out.weight = Number(body.weight);
  if (body.maxBandwidthKbps != null) out.maxBandwidthKbps = Number(body.maxBandwidthKbps);
  if (body.staticSecret != null) out.staticSecret = body.staticSecret ? String(body.staticSecret) : null;
  if (body.realm != null) out.realm = body.realm ? String(body.realm).trim() : null;
  if (body.status != null && ALLOWED_STATUS.includes(body.status)) out.status = body.status;
  if (body.enabled != null) out.enabled = !!body.enabled;
  if (body.tenantId != null) out.tenantId = String(body.tenantId);
  return out;
}

exports.listNodes = async (req, res) => {
  try {
    const data = await relayRegistry.listAll();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[RelayAdmin.listNodes]', error);
    res.status(500).json({ success: false, message: 'Failed to load relay nodes' });
  }
};

exports.createNode = async (req, res) => {
  const input = normalizeInput(req.body || {}, true);
  if (!input.name || !input.host) {
    return res.status(400).json({ success: false, message: 'name 与 host 必填' });
  }
  if (input.port != null && (input.port < 1 || input.port > 65535)) {
    return res.status(400).json({ success: false, message: 'port 非法' });
  }
  try {
    const node = await relayRegistry.upsert(input);
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
  try {
    const existing = await relayRegistry.get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'relay node not found' });
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
    const existing = await relayRegistry.get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'relay node not found' });
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
    const node = await relayRegistry.get(id);
    if (!node) return res.status(404).json({ success: false, message: 'relay node not found' });
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
  try {
    const node = await relayRegistry.heartbeat(id, {
      activeSessions: req.body?.activeSessions,
      totalBytes: req.body?.totalBytes
    });
    if (!node) return res.status(404).json({ success: false, message: 'relay node not found' });
    res.json({ success: true, data: node });
  } catch (error) {
    console.error('[RelayAdmin.heartbeat]', error);
    res.status(500).json({ success: false, message: 'Failed to record heartbeat' });
  }
};
