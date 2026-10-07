'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
async function main() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['bin/www'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PUBLIC_BASE_URL: base }, stdio: ['ignore','pipe','pipe'] });
  child.stdout.resume(); child.stderr.resume();
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error('Web process exited before becoming ready');
      try { ready = (await fetch(base + '/login', { signal: AbortSignal.timeout(1000) })).status === 200; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'Web process did not become ready');
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ account: process.env.SETUP_TEST_USER, password: process.env.SETUP_TEST_PASSWORD }) });
    assert.equal(response.status, 200, 'HTTP login status');
    assert.equal((await response.json()).success, true);
    const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const consoleResponse = await fetch(base + '/admin/ops', { headers: { cookie }, redirect: 'manual' });
    assert.equal(consoleResponse.status, 200, 'Administrator console access');
    assert((await consoleResponse.text()).includes('模块管理'), 'System menus present');
    const users = await fetch(base + '/user-admin/users', { headers: { cookie } });
    assert.equal(users.status, 200, 'Administrator-only API access');
    console.log('Full Web startup, HTTP login, administrator console and user API passed');
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
