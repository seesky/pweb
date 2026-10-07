'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { validate, databaseUrl, manifest } = require('../setup/services/install');
const { extract } = require('../setup/extract-schema');
const { createInstaller } = require('../setup/server');
const input = { host: '127.0.0.1', user: 'poleis', database: 'poleis', port: 3306, password: 'p@ss:#%"', redisUrl: 'redis://localhost:6379/0', siteUrl: 'http://localhost:3000', production: false, adminName: 'Administrator', adminEmail: 'admin@example.com', adminPassword: 'StrongPassword123', confirmPassword: 'StrongPassword123' };
test('installer rejects invalid names, unsafe production URL and bcrypt truncation', () => {
  assert.throws(() => validate({ ...input, database: 'poleis`; DROP DATABASE x' }));
  assert.throws(() => validate({ ...input, production: true }));
  assert.throws(() => validate({ ...input, adminPassword: 'Aa1' + '中'.repeat(24), confirmPassword: 'Aa1' + '中'.repeat(24) }, true));
  assert.throws(() => validate({ ...input, confirmPassword: 'different' }, true));
});
test('database URL round trips credentials containing reserved characters', () => {
  const u = new URL(databaseUrl(validate(input)));
  assert.equal(decodeURIComponent(u.password), input.password);
  const DbCommonLibaray = require('../utilities/publiclibrary/db_common_libaray');
  assert.equal(DbCommonLibaray.prototype.parseDatabaseUrl(u.href).password, input.password);
  const Db = require('../utilities/publiclibrary/db_common_libaray');
  const parsed = Db.prototype.parseDatabaseUrl(databaseUrl(validate(input)));
  assert.equal(parsed.password, input.password);
  assert.equal(parsed.user, input.user);
});
test('published baseline has every manifest table and contains no production statements', () => {
  const sql = fs.readFileSync(require.resolve('../setup/database/schema.sql'), 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), manifest.sha256);
  assert.equal(extract(sql).length, 94);
  assert.deepEqual(extract(sql).map(t => t.name), manifest.tables.map(t => t.name));
  assert(!/^(INSERT|DROP|USE|REPLACE|UPDATE|DELETE|ALTER)\s/im.test(sql));
  assert(!/AUTO_INCREMENT=\d+/.test(sql));
});
test('installer requires token and refuses an existing config without touching it', async () => {
  const { app, token } = createInstaller({ configPath: __filename });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/status')).status, 403);
    assert.equal((await fetch(base + '/api/install', { method: 'POST', headers: { 'x-setup-token': token, 'content-type': 'application/json' }, body: JSON.stringify(input) })).status, 409);
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
