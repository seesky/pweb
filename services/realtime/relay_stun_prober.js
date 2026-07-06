'use strict';

/**
 * Web 侧主动 STUN 探测器。
 *
 * 对每个已注册的中继节点（coturn）周期性发送 STUN Binding Request（RFC 5389），
 * 根据是否收到 Binding Response 及 RTT 判定节点可达性，调用 relayRegistry.recordProbe 更新状态。
 *
 * 这样无需在 coturn 机器上部署 sidecar 心跳，Web 平台自身即可维持节点 online/offline 状态。
 * coturn 默认监听 3478 同时响应 TURN 与 STUN 请求，因此无需额外配置。
 */

const dgram = require('node:dgram');
const net = require('node:net');
const crypto = require('node:crypto');

const STUN_MAGIC_COOKIE = 0x2112A442;

/** 构造一个 STUN Binding Request（RFC 5389 §6）。 */
function buildStunBindingRequest() {
  // 20 字节头：Type(2) + Length(2) + MagicCookie(4) + TransactionId(12)
  const buf = Buffer.alloc(20);
  buf.writeUInt16BE(0x0001, 0);          // Type: Binding Request
  buf.writeUInt16BE(0, 2);               // Length: 0 (无属性)
  buf.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  crypto.randomBytes(12).copy(buf, 8);   // Transaction ID
  return buf;
}

/** 校验返回包是否为对请求的 STUN Binding Response（Success 或 Error）。返回 true/false。 */
function isStunBindingResponse(msg, txId) {
  if (!Buffer.isBuffer(msg) || msg.length < 20) return false;
  const msgType = msg.readUInt16BE(0);
  // RFC 5389: 0x0100 = Binding Success Response；0x0110 = Binding Error Response
  if (msgType !== 0x0100 && msgType !== 0x0110) return false;
  const cookie = msg.readUInt32BE(4);
  if (cookie !== STUN_MAGIC_COOKIE) return false;
  // 校验 transaction id 一致
  if (txId && !msg.subarray(8, 20).equals(txId)) return false;
  return true;
}

/**
 * 向单个节点发送一次 STUN Binding 探测。
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, rttMs: number|null}>}
 */
function probeOnce(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4' });
    const start = Date.now();
    const req = buildStunBindingRequest();
    const txId = req.subarray(8, 20);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_) { /* ignore */ }
      resolve(result);
    };
    socket.on('message', (msg) => {
      if (isStunBindingResponse(msg, txId)) {
        finish({ ok: msg.readUInt16BE(0) === 0x0100, rttMs: Date.now() - start });
      }
    });
    socket.on('error', () => finish({ ok: false, rttMs: null }));
    socket.on('close', () => finish({ ok: false, rttMs: null }));
    socket.send(req, 0, req.length, port, host, (err) => {
      if (err) return finish({ ok: false, rttMs: null });
    });
    setTimeout(() => finish({ ok: false, rttMs: null }), timeoutMs);
  });
}

/**
 * TCP 连接探测：coturn 在 3478 同时监听 TCP，TCP 能建立连接即代表节点可达。
 * 用于 UDP 出站受限的环境（如部分云主机/容器沙箱）的回退判定。
 * 不返回精确 RTT（TCP 握手 RTT 仅作近似）。
 * @returns {Promise<{ok: boolean, rttMs: number|null}>}
 */
function probeTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) { /* ignore */ }
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish({ ok: true, rttMs: Date.now() - start }));
    socket.on('timeout', () => finish({ ok: false, rttMs: null }));
    socket.on('error', () => finish({ ok: false, rttMs: null }));
  });
}

/**
 * 综合探测：先 UDP STUN（精确延迟），失败则 TCP 连接回退（仅判定可达）。
 * coturn 默认 3478 同时监听 UDP+TCP，因此 TCP 回退对判定 online/offline 完全有效。
 */
async function probeReachable(host, port, timeoutMs = 3000) {
  const udp = await probeOnce(host, port, timeoutMs);
  if (udp.ok) return udp;
  // UDP 不通，回退 TCP
  const tcp = await probeTcp(host, port, timeoutMs);
  return tcp; // ok=true 时 rttMs 为 TCP 握手近似延迟
}

/**
 * 周期性探测所有已注册节点，更新 registry 状态。
 * 适用于 relayRegistry.startHealthCheck 的增强：探测可达节点 → online + 延迟；
 * 探测失败节点 → offline。
 */
class RelayStunProber {
  constructor(registry, intervalMs = 15000, perNodeTimeoutMs = 3000) {
    this.registry = registry;
    this.intervalMs = intervalMs;
    this.perNodeTimeoutMs = perNodeTimeoutMs;
    this._timer = null;
    this._busy = false;
    this._consecutiveFailures = new Map();
  }

  start() {
    if (this._timer) return;
    // 立即跑一轮，然后周期执行
    this._tick().catch(() => {});
    this._timer = setInterval(() => this._tick().catch(() => {}), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _tick() {
    if (this._busy) return; // 上一轮未结束，跳过
    this._busy = true;
    try {
      // listAll 已包含未启用/离线节点，全部探测以发现恢复
      const nodes = await this.registry.listAllForProbe();
      if (!nodes || !nodes.length) return;
      // 并发探测，但限制并发数避免端口耗尽
      const CONCURRENCY = 8;
      for (let i = 0; i < nodes.length; i += CONCURRENCY) {
        const batch = nodes.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((n) => this._probeNode(n)));
      }
    } catch (_) {
      /* ignore */
    } finally {
      this._busy = false;
    }
  }

  async _probeNode(node) {
    try {
      const { ok, rttMs } = await probeReachable(node.host, node.port, this.perNodeTimeoutMs);
      if (ok) {
        this._consecutiveFailures.delete(node.id);
        await this.registry.recordProbe(node.id, rttMs, true);
        return;
      }
      const failures = (this._consecutiveFailures.get(node.id) || 0) + 1;
      this._consecutiveFailures.set(node.id, failures);
      if (failures >= 3) {
        await this.registry.recordProbe(node.id, 0, false);
      }
    } catch (_) {
      const failures = (this._consecutiveFailures.get(node.id) || 0) + 1;
      this._consecutiveFailures.set(node.id, failures);
      if (failures >= 3) {
        await this.registry.recordProbe(node.id, 0, false);
      }
    }
  }
}

module.exports = { RelayStunProber, probeOnce, probeTcp, probeReachable, buildStunBindingRequest, isStunBindingResponse };
