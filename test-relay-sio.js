const io = require('socket.io-client');
const { SocketTokenService } = require('./services/realtime/token_service');
const { relayRegistry } = require('./services/realtime/relay_registry');

(async () => {
  console.log('=== 补充验证 2: socket.io relay 事件 ===\n');

  // 注册节点并置 online
  const node = await relayRegistry.upsert({ name: 'relay-sio-test', host: '203.0.113.99', port: 3478, region: 'cn-test', staticSecret: 'sio-secret' });
  await relayRegistry.heartbeat(node.id, { activeSessions: 0 });
  console.log('注册节点:', node.id, node.name);

  // 签发合法 token（用 Administrator 的 userId）
  const tokenService = new SocketTokenService();
  const terminalId = 'test-term-sio-' + Date.now();
  const token = tokenService.issue('26F43BC9-AE6D-42D2-BAC9-F4237A949484', terminalId, 3600, { username: 'Administrator' });
  console.log('签发 token:', token.slice(0, 30) + '...');

  // 连接 socket.io
  const socket = io('http://127.0.0.1:3000', {
    transports: ['websocket'],
    auth: { token, terminalId, deviceInfo: { os: 'test' } }
  });

  let gotRelayList = false;
  let gotAuth = false;
  let latencyReported = false;

  socket.on('connect', () => { console.log('✓ socket.io 已连接, sid:', socket.id); });
  socket.on('connect_error', (e) => { console.log('✗ connect_error:', e.message); });

  socket.on('auth', (data) => {
    gotAuth = data.ok;
    console.log(data.ok ? '✓ auth 认证成功' : '✗ auth 失败: ' + JSON.stringify(data));
  });

  socket.on('poleis_relay_list', (data) => {
    gotRelayList = true;
    console.log('✓ 收到 poleis_relay_list:', data.nodes?.length, '个候选节点');
    if (data.nodes && data.nodes.length > 0) {
      data.nodes.forEach(n => console.log('   -', n.host + ':' + n.port, n.region, '(' + n.id.slice(0,8) + ')'));
      const testNode = data.nodes.find(n => n.id === node.id);
      console.log('   测试节点存在:', testNode ? '✓' : '✗ 未找到');
    }
  });

  // 等待事件
  await new Promise(r => setTimeout(r, 3000));

  // 测试延迟上报
  socket.emit('poleis_relay_latency', { samples: [{ nodeId: node.id, rttMs: 25 }] }, (resp) => {
    latencyReported = resp?.success;
    console.log(latencyReported ? '✓ poleis_relay_latency 上报成功' : '✗ 上报失败: ' + JSON.stringify(resp));
  });

  await new Promise(r => setTimeout(r, 1000));

  // 清理
  socket.disconnect();
  await relayRegistry.remove(node.id);

  console.log('\n=== socket.io relay 事件验证结果 ===');
  console.log('  auth 认证:        ', gotAuth ? '✓' : '✗');
  console.log('  relay_list 下发:  ', gotRelayList ? '✓' : '✗');
  console.log('  latency 上报:     ', latencyReported ? '✓' : '✗');
  const allOk = gotAuth && gotRelayList && latencyReported;
  console.log('\n总结:', allOk ? '✓ 全部通过' : '✗ 部分失败');
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
