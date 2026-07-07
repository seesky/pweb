#!/usr/bin/env node
/**
 * Poleis Relay TURN 服务器功能 — 一键测试脚本
 *
 * 用法： node test-relay-flow.js
 *
 * 测试流程：
 *   1. 登录获取 session cookie（用 Administrator 账号）
 *   2. 注册一个 TURN relay 节点
 *   3. 列举节点
 *   4. 心跳上报（模拟 coturn sidecar）
 *   5. 查看实时指标
 *   6. drain 节点
 *   7. relay_registry 延迟选择 + TURN 凭证签发（直接调服务）
 *   8. 清理（删除测试节点）
 *
 * 前置条件：
 *   - web 端在 http://127.0.0.1:3000 运行
 *   - Administrator 账号密码正确（下方 ADMIN_PASSWORD 配置）
 */

const http = require('http');
const { relayRegistry } = require('./services/realtime/relay_registry');

const WEB_HOST = '127.0.0.1';
const WEB_PORT = 3000;
const ADMIN_ACCOUNT = 'Administrator';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456'; // ← 改成你的管理员密码

// 复用 HTTP 连接 + cookie jar
const cookieJar = new Map(); // name -> value

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookieJar.size > 0) {
      headers['Cookie'] = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request({ hostname: WEB_HOST, port: WEB_PORT, path, method, headers }, (res) => {
      // 收集 Set-Cookie
      const setCookies = res.headers['set-cookie'] || [];
      for (const sc of setCookies) {
        const m = sc.match(/^([^=;]+)=([^;]*)/);
        if (m) cookieJar.set(m[1].trim(), m[2].trim());
      }
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch {}
        resolve({ status: res.statusCode, body: buf, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const log = (step, msg, obj) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${step}: ${msg}`, obj ? JSON.stringify(obj) : '');
};

async function main() {
  console.log('========================================');
  console.log('  Poleis Relay TURN 功能测试');
  console.log('========================================\n');

  // ---------- 1. 登录 ----------
  log('1', '登录 Administrator ...');
  let res = await request('POST', '/auth/login', { account: ADMIN_ACCOUNT, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !res.json?.success) {
    console.error('   登录失败！status:', res.status, 'body:', res.body);
    console.error('   请检查 ADMIN_PASSWORD 环境变量或修改脚本中的密码');
    process.exit(1);
  }
  log('1', '✓ 登录成功', { user: res.json.data?.userName || res.json.data?.realName });

  // ---------- 2. 注册 TURN 节点 ----------
  const testNode = {
    name: 'relay-test-turn-1',
    host: '127.0.0.1',
    port: 3478,
    region: 'cn-test',
    weight: 100,
    staticSecret: 'test-turn-secret-abc123',
    enabled: true
  };
  log('2', '注册 TURN 节点 ...', testNode);
  res = await request('POST', '/relay-admin/nodes', testNode);
  if (res.status !== 200 || !res.json?.success) {
    console.error('   注册失败！', res.status, res.body);
    process.exit(1);
  }
  const nodeId = res.json.data.id;
  log('2', '✓ 节点已注册', { id: nodeId, name: res.json.data.name });

  // ---------- 3. 列举节点 ----------
  log('3', '列举所有 relay 节点 ...');
  res = await request('GET', '/relay-admin/nodes');
  if (res.status !== 200 || !res.json?.success) {
    console.error('   列举失败！', res.status, res.body);
    process.exit(1);
  }
  log('3', `✓ 共 ${res.json.data.length} 个节点`);
  res.json.data.forEach(n => {
    console.log(`     - ${n.name} | ${n.host}:${n.port} | region=${n.region || '-'} | status=${n.status} | enabled=${n.enabled}`);
  });

  // ---------- 4. 心跳上报（模拟 coturn sidecar） ----------
  log('4', '上报心跳（模拟 coturn sidecar）...');
  res = await request('POST', `/relay-admin/nodes/${nodeId}/heartbeat`, {
    activeSessions: 3,
    totalBytes: 1024000
  });
  if (res.status !== 200 || !res.json?.success) {
    console.error('   心跳失败！', res.status, res.body);
    process.exit(1);
  }
  log('4', '✓ 心跳已记录', { status: res.json.data.status, activeSessions: res.json.data.activeSessions });

  // ---------- 5. 查看实时指标 ----------
  log('5', '查看节点实时指标 ...');
  res = await request('GET', `/relay-admin/nodes/${nodeId}/metrics`);
  if (res.status !== 200 || !res.json?.success) {
    console.error('   指标查询失败！', res.status, res.body);
    process.exit(1);
  }
  log('5', '✓ 指标', res.json.data);

  // ---------- 6. relay_registry 延迟选择 + TURN 凭证签发 ----------
  log('6', 'relay_registry 延迟选择 + TURN 凭证签发（直接调服务）...');
  // 模拟 client/agent 上报延迟
  await relayRegistry.recordLatency('test-client-term', [{ nodeId, rttMs: 12 }]);
  await relayRegistry.recordLatency('test-agent-term', [{ nodeId, rttMs: 18 }]);
  const alloc = await relayRegistry.allocateForPair('test-client-term', 'test-agent-term', 'test-session-001');
  if (!alloc) {
    console.error('   分配失败！');
    process.exit(1);
  }
  log('6', '✓ 分配结果', {
    nodeId: alloc.nodeId,
    host: `${alloc.host}:${alloc.port}`,
    username: alloc.username,
    credential: alloc.credential,
    realm: alloc.realm,
    legacy: alloc.legacy
  });

  // ---------- 7. drain 节点 ----------
  log('7', 'drain 节点（停止接受新会话）...');
  res = await request('POST', `/relay-admin/nodes/${nodeId}/drain`);
  if (res.status !== 200 || !res.json?.success) {
    console.error('   drain 失败！', res.status, res.body);
    process.exit(1);
  }
  log('7', '✓ 节点已 drain', { status: res.json.data.status });

  // ---------- 8. 删除测试节点 ----------
  log('8', '删除测试节点 ...');
  res = await request('DELETE', `/relay-admin/nodes/${nodeId}`);
  if (res.status !== 200 || !res.json?.success) {
    console.error('   删除失败！', res.status, res.body);
    process.exit(1);
  }
  log('8', '✓ 节点已删除');

  console.log('\n========================================');
  console.log('  ✓ 所有测试通过！');
  console.log('========================================');
  console.log('\n下一步：部署真实 coturn 并在后台注册，');
  console.log('参考 docs/relay-deploy.md');
}

main().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
