'use strict';
// Explicit live test: only new, randomly named databases on the local server.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { createInstaller } = require('../server');
const { extract } = require('../extract-schema');
const { manifest, install } = require('../services/install');
async function main() {
  const settings = dotenv.parse(await fs.readFile(path.resolve(__dirname, '../../.env')));
  const source = new URL(settings.DATABASE_URL);
  if (!['127.0.0.1','localhost','[::1]'].includes(source.hostname)) throw new Error('Live test requires a local MySQL connection');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poleis-setup-test-'));
  const database = 'poleis_setup_test_' + randomBytes(5).toString('hex');
  const configPath = path.join(dir, '.env');
  const input = { host: source.hostname, port: source.port || 3306, user: decodeURIComponent(source.username), password: decodeURIComponent(source.password),
    database, createDatabase: true, redisUrl: process.env.SETUP_TEST_REDIS_URL || settings.REDIS_URL || 'redis://127.0.0.1:6379/0', siteUrl: 'http://localhost:3000', production: false,
    adminName: 'SetupAdmin', adminEmail: 'setup-test@example.com', adminPassword: 'TestA1' + randomBytes(18).toString('hex') };
  input.confirmPassword = input.adminPassword;
  const { app, token } = createInstaller({ configPath });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (route, body, headers = {}) => fetch(base + '/api/' + route, { method: body ? 'POST' : 'GET', headers: { 'x-setup-token': token, 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let db;
  try {
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/api/status')).status, 403);
    assert.equal((await call('check', input, { origin: 'https://evil.example' })).status, 403);
    const check = await call('check', input);
    assert.equal(check.status, 200, JSON.stringify(await check.json()));
    assert.equal((await call('install', input)).status, 202);
    assert.equal((await call('install', input)).status, 409);
    let state;
    const until = Date.now() + 120000;
    do {
      state = await (await call('status')).json();
      if (state.phase !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < until);
    assert.equal(state.phase, 'complete', JSON.stringify(state));
    db = await mysql.createConnection({ host: input.host, port: input.port, user: input.user, password: input.password, database });
    const [[version]] = await db.query('SELECT VERSION() AS version');
    const [[admin]] = await db.query('SELECT u.ID,u.EMAILVERIFIED,l.USERPASSWORD,r.CODE FROM piuser u JOIN piuserlogon l ON l.ID=u.ID JOIN piuserrole ur ON ur.USERID=u.ID JOIN pirole r ON r.ID=ur.ROLEID WHERE u.USERNAME=?', [input.adminName]);
    assert.equal(admin.CODE, 'Administrators'); assert.equal(admin.EMAILVERIFIED, 1);
    assert(await bcrypt.compare(input.adminPassword, admin.USERPASSWORD));
    assert.equal((await call('install', { ...input, adminPassword: 'DifferentA1234', confirmPassword: 'DifferentA1234' })).status, 409);
    const [[count]] = await db.query('SELECT COUNT(*) n FROM piuser'); assert.equal(count.n, 1);
    const [[migrations]] = await db.query('SELECT COUNT(*) n FROM _prisma_migrations'); assert.equal(migrations.n, manifest.migrations.length);
    // Independently instantiate the source DDL and compare all columns/indexes/FKs.
    const reference = database + '_ref';
    await db.query(`CREATE DATABASE \`${reference}\``);
    await db.query(`USE \`${reference}\``);
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    const sql = await fs.readFile(path.resolve(__dirname, '../database/schema.sql'), 'utf8');
    for (const table of extract(sql)) await db.query(version.version.includes('MariaDB') ? table.sql.replace(/utf8mb3/g, 'utf8') : table.sql);
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    for (const table of manifest.tables) {
      const [[actual]] = await db.query(`SHOW CREATE TABLE \`${database}\`.\`${table.name}\``);
      const [[expected]] = await db.query(`SHOW CREATE TABLE \`${reference}\`.\`${table.name}\``);
      const normalize = value => value.replace(/ AUTO_INCREMENT=\d+/g, '');
      assert.equal(normalize(actual['Create Table']), normalize(expected['Create Table']), table.name);
    }
    const env = dotenv.parse(await fs.readFile(configPath));
    assert.equal(new URL(env.DATABASE_URL).pathname, '/' + database);
    assert.equal(new Set(['COOKIE_SECRET','SESSION_SECRET','AUTH_JWT_SECRET','SOCKET_JWT_SECRET'].map(k => env[k])).size, 4);
    // Test real login and authority using the existing Web login controller in a child process.
    const { spawnSync } = require('node:child_process');
    const child = spawnSync(process.execPath, ['setup/test/verify-login.js'], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, ...env, SETUP_TEST_USER: input.adminName, SETUP_TEST_PASSWORD: input.adminPassword }, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const web = spawnSync(process.execPath, ['setup/test/verify-web.js'], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, ...env, SETUP_TEST_USER: input.adminName, SETUP_TEST_PASSWORD: input.adminPassword }, encoding: 'utf8', timeout: 30000 });
    assert.equal(web.status, 0, web.stdout + web.stderr);
    // A new installer process must also refuse the existing database even with
    // another config destination; a config file alone is not the install lock.
    await assert.rejects(install(input, { configPath: path.join(dir, 'another.env') }), /已安装/);
    const resumeInput = { ...input, database: database + '_resume' };
    const resumePath = path.join(dir, 'resume.env');
    await assert.rejects(install(resumeInput, { configPath: resumePath, progress(message) {
      if (message === '创建/检查表：pirole') throw new Error('Injected interruption');
    } }), /Injected interruption/);
    await install(resumeInput, { configPath: resumePath });
    // A configuration write failure leaves seeded data recoverable without
    // resetting the administrator password on the next attempt.
    const seededInput = { ...input, database: database + '_seeded' };
    await assert.rejects(install(seededInput, { configPath: path.join(dir, 'missing-parent/config.env') }), /ENOENT/);
    const replacement = 'NewPasswordA12345';
    await install({ ...seededInput, adminPassword: replacement, confirmPassword: replacement }, { configPath: path.join(dir, 'seeded.env') });
    const [[saved]] = await db.query(`SELECT USERPASSWORD FROM \`${seededInput.database}\`.piuserlogon`);
    assert(await bcrypt.compare(input.adminPassword, saved.USERPASSWORD));
    assert(!await bcrypt.compare(replacement, saved.USERPASSWORD));
    const occupied = database + '_occupied';
    await db.query(`CREATE DATABASE \`${occupied}\``);
    await db.query(`CREATE TABLE \`${occupied}\`.sentinel (id int PRIMARY KEY)`);
    await db.query(`INSERT INTO \`${occupied}\`.sentinel VALUES (7)`);
    await assert.rejects(install({ ...input, database: occupied }, { configPath: path.join(dir, 'occupied.env') }), /已有业务表/);
    const [[sentinel]] = await db.query(`SELECT id FROM \`${occupied}\`.sentinel`); assert.equal(sentinel.id, 7);
    // An existing business database is never adopted or modified.
    await assert.rejects(install({ ...input, database: reference }, { configPath: path.join(dir, 'existing.env') }), /已有业务表/);
    // Simulate a crash during DDL: the installer must resume and validate existing tables.
    const resumed = database + '_structure';
    await db.query(`CREATE DATABASE \`${resumed}\``);
    await db.query(`USE \`${resumed}\``);
    await db.query('CREATE TABLE poleis_setup_state (ID int PRIMARY KEY, VERSION varchar(40) NOT NULL, PHASE varchar(20) NOT NULL, DETAILS text NULL) ENGINE=InnoDB');
    await db.execute("INSERT INTO poleis_setup_state VALUES (1,?,'schema',NULL)", [manifest.version]);
    const first = extract(sql)[0];
    await db.query(first.sql);
    await db.query('ALTER TABLE _prisma_migrations MODIFY checksum varchar(63) NOT NULL');
    await assert.rejects(install({ ...input, database: resumed }, { configPath: path.join(dir, 'resumed.env') }), /不匹配/);
    await db.query('ALTER TABLE _prisma_migrations MODIFY checksum varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL');
    await install({ ...input, database: resumed }, { configPath: path.join(dir, 'resumed.env') });
    const [[resumedCount]] = await db.query('SELECT COUNT(*) n FROM piuser');
    assert.equal(resumedCount.n, 1);
    // Simulate config write failure after the admin transaction has committed.
    await db.query("UPDATE poleis_setup_state SET PHASE='seeded' WHERE ID=1");
    const [[before]] = await db.query('SELECT USERPASSWORD FROM piuserlogon');
    await install({ ...input, database: resumed, adminPassword: 'DifferentA1234', confirmPassword: 'DifferentA1234' }, { configPath: path.join(dir, 'recovered.env') });
    const [[after]] = await db.query('SELECT USERPASSWORD FROM piuserlogon');
    assert.equal(before.USERPASSWORD, after.USERPASSWORD);
    console.log(JSON.stringify({ passed: true, database, referenceDatabase: reference, configPath, version: version.version, tablesCompared: manifest.tables.length, checks: ['GUI assets','token authentication','cross-origin rejection','actual installation','concurrent/repeat protection','94 full DDL comparisons','password hash','administrator role','migration history','independent secrets','Web login and admin authority','restart protection','interrupted installation recovery','seeded recovery preserves password','nonempty database remains untouched'] }, null, 2));
  } finally {
    if (db) await db.end();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
