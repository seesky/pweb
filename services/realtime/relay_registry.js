'use strict';

/**
 * RelayRegistry — relay 节点池纳管 + 延迟探测 + 选择 + TURN 凭证签发。
 *
 * 设计要点（见 docs/relay-server-design.md §2）：
 *  - 持久化：Prisma `poleis_relay_node` 表。
 *  - 热路径缓存：Redis（与 presence_service 同套），Web 多实例共享 relay 状态。
 *  - 延迟选择：双端 STUN 探测上报（recordLatency），chooseForPair 综合 client/agent
 *    双端 RTT 打分；缺失时退化为 Web 侧 LASTLATENCYMS。
 *  - TURN 凭证：用每个节点的 STATICSECRET 做 HMAC-SHA1，签发 time-limited 凭证
 *    （RFC 5389 / coturn `use-auth-secret` 兼容）。
 *  - Redis 不可用时自动降级为内存缓存（开发环境零依赖运行）。
 */

const Redis = require('ioredis');
const { createHmac } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

let lastRedisErrorLog = 0;

const buildRedis = () => {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION || '';
  if (!url) return null;
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  redis.on('error', (error) => {
    const now = Date.now();
    if (now - lastRedisErrorLog >= 30000) {
      console.error(`[relay-registry] Redis connection error: ${error.message}`);
      lastRedisErrorLog = now;
    }
  });
  return redis;
};

// Redis key helpers
const K = {
  node: (id) => `relay:node:${id}`,                 // hash: 缓存单节点快照
  onlineSet: () => 'relay:nodes:online',            // set:  在线节点 ID
  latency: (terminalId) => `relay:latency:${terminalId}`, // hash: nodeId -> rttMs
  probeSet: () => 'relay:nodes:probe'               // set:  需要被探测的节点 ID（online+enabled）
};

// 内存降级缓存
const memoryState = {
  nodes: new Map(),      // id -> node object
  online: new Set(),     // id
  latency: new Map()     // terminalId -> Map(nodeId -> rttMs)
};

const TENANT = () => process.env.POLEIS_DEFAULT_TENANT || 'default';

const TTL = {
  nodeCache: 90,         // 节点快照缓存秒数
  latency: 60,           // 延迟样本 TTL 秒
  heartbeatStale: 45     // 心跳超过此秒数视为过期
};

/** 把 Prisma 行规整为对外的节点对象（去掉敏感字段，便于下发/序列化）。 */
function toPublicNode(row) {
  if (!row) return null;
  return {
    id: row.ID,
    tenantId: row.TENANTID,
    name: row.NAME,
    host: row.HOST,
    port: row.PORT,
    tlsPort: row.TLSPORT,
    region: row.REGION,
    latitude: row.LATITUDE,
    longitude: row.LONGITUDE,
    weight: row.WEIGHT,
    maxBandwidthKbps: row.MAXBANDWIDTHKBPS,
    status: row.STATUS,
    lastHeartbeat: row.LASTHEARTBEAT ? row.LASTHEARTBEAT.getTime() : null,
    lastLatencyMs: row.LASTLATENCYMS,
    activeSessions: row.ACTIVESESSIONS,
    // BigInt 无法直接 JSON.stringify，用字符串传输避免精度丢失（>9PB 时 Number 会不安全）。
    // 前端 fmtBytes 需先 Number(n) 转换。
    totalBytes: row.TOTALBYTES != null ? row.TOTALBYTES.toString() : '0',
    enabled: row.ENABLED === 1,
    hasSecret: !!row.STATICSECRET,
    realm: row.REALM || null
  };
}

class RelayRegistry {
  constructor(redisClient) {
    this.redis = redisClient || buildRedis();
    this._probeTimer = null;
  }

  // ---------- 注册 / 增删改查（持久化 + 缓存同步） ----------

  /** 新增或更新节点（管理员后台）。返回对外节点对象。 */
  async upsert(input) {
    const id = input.id || require('node:crypto').randomUUID();
    // 构建只含传入字段的更新数据（避免覆盖未传入的必填字段）
    const update = {};
    if (input.tenantId != null) update.TENANTID = input.tenantId;
    if (input.name != null) update.NAME = input.name;
    if (input.host != null) update.HOST = input.host;
    if (input.port != null) update.PORT = Number(input.port);
    if (input.tlsPort != null) update.TLSPORT = input.tlsPort ? Number(input.tlsPort) : null;
    if (input.region != null) update.REGION = input.region || null;
    if (input.latitude != null) update.LATITUDE = input.latitude ? Number(input.latitude) : null;
    if (input.longitude != null) update.LONGITUDE = input.longitude ? Number(input.longitude) : null;
    if (input.weight != null) update.WEIGHT = Number(input.weight);
    if (input.maxBandwidthKbps != null) update.MAXBANDWIDTHKBPS = Number(input.maxBandwidthKbps);
    if (input.staticSecret !== undefined) update.STATICSECRET = input.staticSecret || null;
    if (input.realm !== undefined) update.REALM = input.realm || null;
    if (input.status != null) update.STATUS = input.status;
    if (input.enabled != null) update.ENABLED = input.enabled ? 1 : 0;
    update.MODIFIEDON = new Date();

    // create 时补齐必填字段默认值
    const create = {
      ID: id,
      CREATEON: new Date(),
      TENANTID: update.TENANTID || TENANT(),
      NAME: update.NAME || 'unnamed-relay',
      HOST: update.HOST || '0.0.0.0',
      PORT: update.PORT || 3478,
      ...update
    };

    const row = await prisma.poleis_relay_node.upsert({
      where: { ID: id },
      create,
      update
    });
    await this._cacheNode(row);
    return toPublicNode(row);
  }

  async remove(id) {
    await prisma.poleis_relay_node.update({
      where: { ID: id },
      data: { DELETEMARK: 1, ENABLED: 0, MODIFIEDON: new Date() }
    }).catch(() => {});
    await this._evictNode(id);
  }

  async get(id) {
    if (this.redis) {
      const raw = await this.redis.hgetall(K.node(id));
      if (raw && raw.id) return this._decodeNode(raw);
    }
    const row = await prisma.poleis_relay_node.findUnique({ where: { ID: id } });
    if (row) await this._cacheNode(row);
    return toPublicNode(row);
  }

  /** 取节点原始字段（含 staticSecret），仅供内部心跳签名校验使用。 */
  async getNodeRaw(id) {
    const row = await prisma.poleis_relay_node.findUnique({
      where: { ID: id },
      select: { ID: true, HOST: true, PORT: true, STATICSECRET: true, ENABLED: true, STATUS: true }
    });
    if (!row) return null;
    return {
      id: row.ID,
      host: row.HOST,
      port: row.PORT,
      staticSecret: row.STATICSECRET,
      enabled: row.ENABLED === 1,
      status: row.STATUS
    };
  }

  async listAll() {
    const rows = await prisma.poleis_relay_node.findMany({
      where: { DELETEMARK: 0 },
      orderBy: [{ REGION: 'asc' }, { NAME: 'asc' }]
    });
    return rows.map(toPublicNode);
  }

  // ---------- 心跳 / 健康探测 ----------

  /** TURN 节点（或 sidecar）上报心跳与指标。 */
  async heartbeat(nodeId, metrics = {}) {
    const data = {
      LASTHEARTBEAT: new Date(),
      ACTIVESESSIONS: metrics.activeSessions != null ? Number(metrics.activeSessions) : 0,
      TOTALBYTES: metrics.totalBytes != null ? BigInt(metrics.totalBytes) : undefined,
      MODIFIEDON: new Date()
    };
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    try {
      // 先读当前状态：draining 节点的心跳不应将其改回 online。
      const existing = await prisma.poleis_relay_node.findUnique({
        where: { ID: nodeId },
        select: { STATUS: true }
      });
      if (!existing) return null;
      // 仅当节点非 draining 时才置 online；draining 保持 draining（只刷新心跳/指标）。
      if (existing.STATUS !== 'draining') {
        data.STATUS = 'online';
      }
      const row = await prisma.poleis_relay_node.update({ where: { ID: nodeId }, data });
      await this._cacheNode(row);
      // draining 节点不加入 onlineSet（chooseForPair/listOnline 不选 draining）
      if (existing.STATUS !== 'draining') await this._markOnline(nodeId);
      return toPublicNode(row);
    } catch (e) {
      // 节点不存在或更新失败
      return null;
    }
  }

  /** Web 侧主动探测单个节点（STUN Binding 自检），更新 LASTLATENCYMS/STATUS。 */
  async recordProbe(nodeId, rttMs, ok) {
    const data = {
      LASTLATENCYMS: ok ? Math.round(rttMs) : null,
      MODIFIEDON: new Date()
    };
    try {
      // 先读当前状态：draining 节点被探测成功时不应改回 online。
      const existing = await prisma.poleis_relay_node.findUnique({
        where: { ID: nodeId },
        select: { STATUS: true }
      });
      if (!existing) return;
      if (existing.STATUS === 'draining') {
        // draining 节点：只更新延迟/心跳，保持 draining 状态不变。
        if (ok) data.LASTHEARTBEAT = new Date();
        await prisma.poleis_relay_node.update({ where: { ID: nodeId }, data });
        // 不调 _markOnline（draining 不进 onlineSet）
        return;
      }
      // 非 draining：正常更新 STATUS
      data.STATUS = ok ? 'online' : 'offline';
      if (ok) data.LASTHEARTBEAT = new Date();
      await prisma.poleis_relay_node.update({ where: { ID: nodeId }, data });
      if (ok) await this._markOnline(nodeId);
      else await this._markOffline(nodeId);
    } catch (e) { /* ignore */ }
  }

  /** 启动后台周期探测：把长时间未心跳的 online 节点置 offline。 */
  startHealthCheck(intervalMs = 15000) {
    if (this._probeTimer) return;
    this._probeTimer = setInterval(() => this._sweepStale().catch(() => {}), intervalMs);
    if (this._probeTimer.unref) this._probeTimer.unref();
  }

  stopHealthCheck() {
    if (this._probeTimer) { clearInterval(this._probeTimer); this._probeTimer = null; }
  }

  async _sweepStale() {
    // 仅清理「从未被 STUN prober 探测成功过」或「长时间无心跳」的 online 节点。
    // 避免与 RelayStunProber 的周期探测冲突：prober 每 15s 探测并更新 LASTLATENCYMS，
    // 若 LASTLATENCYMS 在最近 2 个探测周期内有值，说明 prober 仍在管理该节点可达性，
    // 此处不重复置 offline，防止状态闪烁。
    const cutoff = new Date(Date.now() - TTL.heartbeatStale * 1000);
    const stale = await prisma.poleis_relay_node.findMany({
      where: {
        STATUS: 'online',
        ENABLED: 1,
        LASTHEARTBEAT: { lt: cutoff },
        // 排除最近被 prober 探测过的节点（LASTLATENCYMS 非空即可，
        // 因为 prober 探测失败时会置 LASTLATENCYMS=null 并标 offline，
        // 所以 LASTLATENCYMS 有值 = 最近探测成功过）
        LASTLATENCYMS: null
      },
      select: { ID: true }
    });
    for (const s of stale) {
      await this.recordProbe(s.ID, 0, false);
    }
  }

  // ---------- 在线节点列举（热路径：Redis 优先） ----------

  /** 返回在线且启用的节点列表。可按 region 过滤。 */
  async listOnline(region) {
    let ids;
    if (this.redis) {
      ids = await this.redis.smembers(K.onlineSet());
    } else {
      ids = Array.from(memoryState.online);
    }
    if (!ids || !ids.length) {
      // 缓存空：回源 Prisma 并回填
      const rows = await prisma.poleis_relay_node.findMany({
        where: { STATUS: 'online', ENABLED: 1, DELETEMARK: 0 }
      });
      for (const r of rows) await this._cacheNode(r);
      ids = rows.map((r) => r.ID);
    }
    const nodes = await Promise.all(ids.map((id) => this.get(id)));
    // 过滤掉非 online 状态（draining / offline）和缓存过期后返回 null 的节点。
    // 这确保 chooseForPair / listForProbe 不会选中正在排空(draining)的节点。
    let result = nodes.filter((n) => n && n.status === 'online' && n.enabled);
    if (region) result = result.filter((n) => n.region === region);
    return result;
  }

  /** 返回供终端 STUN 探测用的候选列表（精简字段）。
   *  按设计文档 §2.5 第一层筛选：LASTLATENCYMS 升序、WEIGHT 降序取 Top-K。 */
  async listForProbe(limit = 10) {
    const nodes = await this.listOnline();
    return nodes
      .slice()
      .sort((a, b) => {
        // LASTLATENCYMS 升序（null 视为最大延迟，排末尾）
        const la = a.lastLatencyMs != null ? a.lastLatencyMs : Infinity;
        const lb = b.lastLatencyMs != null ? b.lastLatencyMs : Infinity;
        if (la !== lb) return la - lb;
        // 同延迟时 WEIGHT 降序
        return (b.weight || 0) - (a.weight || 0);
      })
      .slice(0, limit)
      .map((n) => ({ id: n.id, host: n.host, port: n.port, region: n.region }));
  }

  /** 列出全部已启用节点（含 offline，排除 draining）供主动 STUN 探测发现恢复。
   *  draining 节点正在排空，不应被探测改回 online，故排除。 */
  async listAllForProbe() {
    const rows = await prisma.poleis_relay_node.findMany({
      where: { ENABLED: 1, STATUS: { not: 'draining' } },
      select: { ID: true, HOST: true, PORT: true, STATUS: true }
    });
    return rows.map((r) => ({ id: r.ID, host: r.HOST, port: r.PORT, status: r.STATUS }));
  }

  // ---------- 延迟上报 ----------

  /** 终端上报自己到各节点的 STUN RTT 样本。 */
  async recordLatency(terminalId, samples) {
    if (!terminalId || !Array.isArray(samples) || !samples.length) return;
    const pairs = [];
    for (const s of samples) {
      if (s && s.nodeId && typeof s.rttMs === 'number' && s.rttMs >= 0) {
        pairs.push(s.nodeId, String(Math.round(s.rttMs)));
      }
    }
    if (!pairs.length) return;
    if (this.redis) {
      const key = K.latency(terminalId);
      await this.redis.hset(key, ...pairs);
      await this.redis.expire(key, TTL.latency);
    } else {
      let m = memoryState.latency.get(terminalId);
      if (!m) { m = new Map(); memoryState.latency.set(terminalId, m); }
      for (let i = 0; i < pairs.length; i += 2) m.set(pairs[i], Number(pairs[i + 1]));
    }
  }

  async _getLatencyMap(terminalId) {
    if (this.redis) {
      const obj = await this.redis.hgetall(K.latency(terminalId));
      const m = new Map();
      for (const k of Object.keys(obj)) m.set(k, Number(obj[k]));
      return m;
    }
    return memoryState.latency.get(terminalId) || new Map();
  }

  // ---------- 选择（核心） ----------

  /**
   * 为 client/agent 一对终端选择最佳 relay 节点。
   * 算法见设计文档 §2.5：双端 RTT 之和 + 不对称惩罚 - 静态权重。
   * @returns {object|null} 选中节点（含 TURN 凭证）或 null
   */
  async chooseForPair(clientTerminalId, agentTerminalId, opts = {}) {
    const region = opts.region || null;
    const candidates = await this.listOnline(region);
    if (!candidates.length) return null;

    const [clientRtt, agentRtt] = await Promise.all([
      this._getLatencyMap(clientTerminalId),
      this._getLatencyMap(agentTerminalId)
    ]);

    const rtt = (map, id) => {
      const v = map.get(id);
      if (typeof v === 'number') return v;
      return null; // 未知
    };

    const scored = candidates.map((n) => {
      const c = rtt(clientRtt, n.id);
      const a = rtt(agentRtt, n.id);
      let score;
      if (c != null && a != null) {
        // 双端已知：和 + 不对称惩罚
        score = c + a + Math.abs(c - a) * 0.5;
      } else if (c != null || a != null) {
        // 单端已知：用已知端 + 另一端用 Web 侧 LASTLATENCYMS 兜底
        const known = c != null ? c : a;
        const fallback = n.lastLatencyMs != null ? n.lastLatencyMs : 150;
        score = known + fallback + Math.abs(known - fallback) * 0.5;
      } else {
        // 双端未知：用 Web 侧 LASTLATENCYMS，无则 150ms 默认
        const f = n.lastLatencyMs != null ? n.lastLatencyMs : 150;
        score = f * 2;
      }
      // 静态权重：权重越高越优先（减分）
      score -= n.weight * 0.1;
      // 负载惩罚：活跃会话越多越靠后
      score += (n.activeSessions || 0) * 0.5;
      return { node: n, score, cRtt: c, aRtt: a };
    });

    scored.sort((x, y) => x.score - y.score);
    const best = scored[0];
    if (!best) return null;
    return best.node;
  }

  // ---------- TURN 凭证签发 ----------

  /**
   * 为指定节点 + 会话签发 time-limited TURN 凭证（coturn use-auth-secret 兼容）。
   * username 格式："<expiryEpoch>:<sessionId>"
   * credential  = Base64(HMAC-SHA1(secret, username))。
   * @returns {{username, credential, realm, expiresAt}|null}
   */
  async signCredentials(nodeId, sessionId, ttlSeconds = 3600) {
    const row = await prisma.poleis_relay_node.findUnique({ where: { ID: nodeId } });
    if (!row || !row.STATICSECRET || row.ENABLED !== 1) return null;
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiry}:${sessionId}`;
    const credential = createHmac('sha1', row.STATICSECRET)
      .update(username)
      .digest('base64');
    // realm 必须与 coturn turnserver.conf 中 realm= 配置一致，
    // 否则 long-term credential 的 MESSAGE-INTEGRITY 校验会失败。
    // 优先用数据库 REALM 字段；未配置时回落到默认值。
    return {
      username,
      credential,
      realm: row.REALM || 'poleis',
      expiresAt: expiry
    };
  }

  /** 简易分配：选择 + 签凭证一步到位（供 socket_server 注入 NatInfo）。 */
  async allocateForPair(clientTerminalId, agentTerminalId, sessionId, opts = {}) {
    const node = await this.chooseForPair(clientTerminalId, agentTerminalId, opts);
    if (!node) return null;
    const creds = await this.signCredentials(node.id, sessionId, opts.ttlSeconds || 3600);
    if (!creds) {
      // 节点未配 secret：阶段 A 过渡期，返回 PRLY 风格占位（host/port + token）
      // 阶段 C 上线后 secret 必配，此处会拿到真凭证。
      return {
        nodeId: node.id,
        host: node.host,
        port: node.port,
        token: require('node:crypto').randomBytes(16).toString('hex'),
        username: null,
        credential: null,
        realm: null,
        expiresAt: null,
        legacy: true
      };
    }
    return {
      nodeId: node.id,
      host: node.host,
      port: node.port,
      tlsPort: node.tlsPort,
      token: null,
      username: creds.username,
      credential: creds.credential,
      realm: creds.realm,
      expiresAt: creds.expiresAt,
      legacy: false
    };
  }

  // ---------- 缓存内部实现 ----------

  async _cacheNode(row) {
    const pub = toPublicNode(row);
    if (this.redis) {
      const flat = this._encodeNode(pub);
      await this.redis.hset(K.node(row.ID), ...flat);
      await this.redis.expire(K.node(row.ID), TTL.nodeCache);
      if (pub.status === 'online' && pub.enabled) {
        await this.redis.sadd(K.onlineSet(), row.ID);
        await this.redis.sadd(K.probeSet(), row.ID);
      } else {
        await this.redis.srem(K.onlineSet(), row.ID);
        await this.redis.srem(K.probeSet(), row.ID);
      }
    } else {
      memoryState.nodes.set(row.ID, pub);
      if (pub.status === 'online' && pub.enabled) memoryState.online.add(row.ID);
      else memoryState.online.delete(row.ID);
    }
  }

  async _evictNode(id) {
    if (this.redis) {
      await this.redis.del(K.node(id));
      await this.redis.srem(K.onlineSet(), id);
      await this.redis.srem(K.probeSet(), id);
    } else {
      memoryState.nodes.delete(id);
      memoryState.online.delete(id);
    }
  }

  async _markOnline(id) {
    if (this.redis) { await this.redis.sadd(K.onlineSet(), id); await this.redis.sadd(K.probeSet(), id); }
    else memoryState.online.add(id);
  }

  async _markOffline(id) {
    if (this.redis) { await this.redis.srem(K.onlineSet(), id); await this.redis.srem(K.probeSet(), id); }
    else memoryState.online.delete(id);
  }

  _encodeNode(n) {
    const flat = [];
    for (const [k, v] of Object.entries(n)) {
      flat.push(k, v == null ? '' : String(v));
    }
    return flat;
  }

  _decodeNode(raw) {
    const n = {};
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (v === '' || v == null) { n[k] = null; continue; }
      switch (k) {
        case 'port': case 'tlsPort': case 'weight': case 'maxBandwidthKbps':
        case 'lastLatencyMs': case 'activeSessions':
          n[k] = Number(v); break;
        case 'totalBytes': n[k] = v; break; // 保持字符串，避免 BigInt 精度丢失
        case 'lastHeartbeat': n[k] = Number(v) || null; break;
        case 'expiresAt': n[k] = Number(v) || null; break;
        case 'enabled': n[k] = v === 'true'; break;
        case 'hasSecret': n[k] = v === 'true'; break;
        case 'latitude': case 'longitude': n[k] = Number(v); break;
        default: n[k] = v;
      }
    }
    return n;
  }
}

// 单例（与 platformService 风格一致）
const relayRegistry = new RelayRegistry();
relayRegistry.startHealthCheck();

module.exports = { RelayRegistry, relayRegistry };
