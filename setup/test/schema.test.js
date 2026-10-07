'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { extract } = require('../extract-schema');
const { validate, manifest, databaseUrl } = require('../services/install');
test('distributed schema contains complete definitions and no production rows', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), manifest.sha256);
  assert.equal(extract(sql).length, 94);
  assert(!/^(INSERT|REPLACE|DROP|UPDATE)\s/im.test(sql));
  assert(!/AUTO_INCREMENT=\d+/.test(sql));
  for (const migration of manifest.migrations) {
    const body = fs.readFileSync(path.join(__dirname, '../../prisma/migrations', migration.name, 'migration.sql'));
    assert.equal(createHash('sha256').update(body).digest('hex'), migration.checksum);
  }
});
test('rejects unsafe input and insecure production addresses', () => {
  const c = { host: '127.0.0.1', user: 'user', password: 'a@b:#', database: 'poleis', redisUrl: 'redis://localhost:6379/0', siteUrl: 'https://example.com' };
  assert.throws(() => validate({ ...c, database: 'poleis`; DROP DATABASE x' }));
  assert.throws(() => validate({ ...c, siteUrl: 'http://example.com' }));
  assert.throws(() => validate({ ...c, port: 65536 }));
  assert.throws(() => validate({ ...c, adminName: 'Administrator', adminEmail: 'test@example.com', adminPassword: 'A1' + '中'.repeat(30), confirmPassword: 'A1' + '中'.repeat(30) }, true));
  assert.equal(decodeURIComponent(new URL(databaseUrl(validate(c))).password), c.password);
});
