'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../../app');
const server = http.createServer(app).listen(0, '127.0.0.1', async () => {
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: process.env.SETUP_TEST_USER, password: process.env.SETUP_TEST_PASSWORD })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    const cookies = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    assert(cookies.includes('poleis.sid='));
    const admin = await fetch(base + '/admin/ops', { headers: { Cookie: cookies }, redirect: 'manual' });
    assert.equal(admin.status, 200);
    assert((await admin.text()).includes('/user-admin'), 'Fresh admin must have system navigation');
    console.log('Real HTTP login, session and admin console passed');
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
});
