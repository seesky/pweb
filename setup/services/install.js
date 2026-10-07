'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const { extract } = require('../extract-schema');
const root = path.resolve(__dirname, '../..');
const manifest = require('../database/manifest.json');
const hash = value => createHash('sha256').update(value).digest('hex');
function validate(input, admin = false) {
  const c = { ...input };
  for (const key of ['host', 'user', 'database', 'redisUrl', 'siteUrl']) {
    if (typeof c[key] !== 'string' || !c[key].trim() || /[\r\n\0]/.test(c[key])) throw new Error(`请填写有效的 ${key}`);
    c[key] = c[key].trim();
  }
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(c.database)) throw new Error('数据库名只允许字母、数字和下划线');
  c.port = Number(c.port || 3306);
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('数据库端口无效');
  c.password = String(c.password || '');
  const site = new URL(c.siteUrl), redis = new URL(c.redisUrl);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.search || site.hash || site.pathname !== '/') throw new Error('站点地址必须是 HTTP/HTTPS 的根地址');
  if (!['redis:', 'rediss:'].includes(redis.protocol)) throw new Error('Redis 地址无效');
  c.redisUrl = redis.href;
  if (c.production !== false && site.protocol !== 'https:') throw new Error('生产模式需要 HTTPS 访问地址；本机测试请选择开发模式');
  c.siteUrl = site.origin;
  if (admin) {
    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(c.adminName || '')) throw new Error('管理员用户名需要 3–50 个字母、数字或 _ . -');
    if (!validator.isEmail(c.adminEmail || '') || c.adminEmail.length > 200) throw new Error('管理员邮箱无效');
    const p = c.adminPassword;
    if (typeof p !== 'string' || p.length < 12 || Buffer.byteLength(p) > 72 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) throw new Error('管理员密码至少 12 字符，最多 72 字节，含大小写字母和数字');
    if (p !== c.confirmPassword) throw new Error('两次输入的密码不一致');
  }
  return c;
}
const connectionOptions = c => ({ host: c.host, port: c.port, user: c.user, password: c.password, connectTimeout: 10000, charset: 'utf8mb4' });
function databaseUrl(c) {
  const u = new URL('mysql://localhost');
  u.hostname = c.host; u.port = String(c.port); u.username = encodeURIComponent(c.user); u.password = encodeURIComponent(c.password); u.pathname = '/' + c.database;
  return u.href;
}
async function testRedis(url) {
  const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  client.on('error', () => {});
  try { await client.connect(); await client.ping(); }
  finally { if (client.isOpen) client.destroy(); }
}
async function inspect(c) {
  const db = await mysql.createConnection(connectionOptions(c));
  try {
    const [[version]] = await db.query('SELECT VERSION() AS version');
    const [tables] = await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [c.database]);
    return { version: version.version, tables: tables.length };
  } finally { await db.end(); }
}
async function check(input) {
  const c = validate(input);
  const info = await inspect(c);
  await testRedis(c.redisUrl);
  return { ...info, expectedTables: manifest.tables.length, message: info.tables ? '数据库已有表；仅允许继续本安装器创建的未完成安装。' : '连接检查通过，可以初始化空数据库。' };
}
async function verify(db) {
  const [rows] = await db.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY ORDINAL_POSITION');
  for (const table of manifest.tables) {
    const columns = rows.filter(r => r.TABLE_NAME === table.name).map(r => r.COLUMN_NAME);
    if (JSON.stringify(columns) !== JSON.stringify(table.columns)) throw new Error(`表结构校验失败：${table.name}`);
  }
}
async function seed(db, c) {
  const uid = randomUUID(), rid = randomUUID();
  await db.execute('INSERT INTO pirole (ID,CODE,REALNAME,ENABLED,DELETEMARK,ALLOWEDIT,ALLOWDELETE,CREATEON) VALUES (?,?,?,1,0,0,0,NOW())', [rid, 'Administrators', '系统管理员']);
  await db.execute('INSERT INTO piuser (ID,USERNAME,REALNAME,EMAIL,EMAILVERIFIED,ROLEID,ENABLED,DELETEMARK,CREATEON) VALUES (?,?,?,?,1,?,1,0,NOW())', [uid, c.adminName, c.adminName, c.adminEmail, rid]);
  await db.execute('INSERT INTO piuserlogon (ID,USERPASSWORD,OPENID,PASSWORDERRORCOUNT,IS2FAENABLED,CREATEON,MODIFIEDON) VALUES (?,?,?,0,0,NOW(),NOW())', [uid, await bcrypt.hash(c.adminPassword, 12), randomUUID()]);
  await db.execute('INSERT INTO piuserrole (ID,USERID,ROLEID,ENABLED,DELETEMARK,CREATEON) VALUES (?,?,?,1,0,NOW())', [randomUUID(), uid, rid]);
  await db.execute("INSERT INTO poleis_tenant (ID,NAME,EDITION,STATUS,OWNERUSERID,CREATEON) VALUES ('default','Poleis','personal','active',?,NOW())", [uid]);
  const profiles = [
    ['builtin-view-only','Read-only audit',0,0,0,0,1,0,0,0,0,1,0],
    ['builtin-personal','Personal remote access',1,1,1,1,1,1,0,0,0,0,0],
    ['builtin-it-maintenance','IT unattended maintenance',1,1,1,1,1,0,1,0,0,0,0],
    ['builtin-temporary-support','Temporary support',1,0,0,1,1,0,0,0,0,1,3600]
  ];
  for (const p of profiles) await db.execute("INSERT INTO poleis_permission_profile (ID,TENANTID,NAME,ISBUILTIN,CONTROL_INPUT,FILE_TRANSFER,CLIPBOARD,AUDIO,MULTI_MONITOR,GAMEPAD,REMOTE_REBOOT,PRIVACY_SCREEN,RECORD_SESSION,REQUIRE_CONFIRM,IDLE_TIMEOUT_SEC,CREATEON) VALUES (?,'default',?,1,?,?,?,?,?,?,?,?,?,?,?,NOW())", p);
  await db.execute("INSERT INTO poleis_device_policy (ID,TENANTID,NAME,ISBUILTIN,PRIORITY,SETTINGS,CREATEON) VALUES ('builtin-default-policy','default','默认策略',1,0,?,NOW())", [JSON.stringify({ maxBitrateKbps: 0, maxFps: 0, preferTransport: 'auto', autoUpdate: true, logRetentionDays: 14 })]);
  const menus = [
    ['module-admin','模块管理'],['user-admin','用户管理'],['staff-admin','员工管理'],['organize-admin','组织管理'],
    ['role-admin','角色管理'],['post-admin','岗位管理'],['user-permission-admin','用户权限'],['permission-item-admin','权限项'],
    ['role-permission-admin','角色权限'],['sequence-admin','序列管理'],['table-field-admin','表字段管理'],
    ['sys-config-admin','系统配置'],['parameter-admin','参数管理'],['data-item-admin','数据字典'],
    ['log-admin','日志管理'],['exception-admin','异常管理'],['message-admin','消息管理']
  ];
  for (const [index, menu] of menus.entries()) await db.execute('INSERT INTO pimodule (ID,CODE,FULLNAME,MVCNAVIGATEURL,ISMENU,ISPUBLIC,ENABLED,DELETEMARK,SORTCODE,CREATEON,MODIFIEDON) VALUES (?,?,?,?,1,0,1,0,?,NOW(),NOW())', ['setup-menu-' + menu[0], menu[0], menu[1], menu[0] === 'user-permission-admin' ? '/user-permission' : '/' + menu[0], index]);
  for (const entry of manifest.migrations) {
    const sql = await fs.readFile(path.join(root, 'prisma/migrations', entry.name, 'migration.sql'), 'utf8');
    if (hash(sql) !== entry.checksum) throw new Error('基线迁移文件已修改：' + entry.name);
    await db.execute('INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,NOW(),?,NOW(),1)', [randomUUID(), entry.checksum, entry.name]);
  }
}
async function envFile(c) {
  const sessionRedis = new URL(c.redisUrl);
  sessionRedis.pathname = sessionRedis.pathname === '/1' ? '/2' : '/1';
  const values = {
    NODE_ENV: c.production === false ? 'development' : 'production', HOST: '127.0.0.1', PORT: '3000',
    PUBLIC_BASE_URL: c.siteUrl, ALLOWED_ORIGINS: c.siteUrl,
    DATABASE_URL: databaseUrl(c), REDIS_URL: c.redisUrl, SESSION_REDIS_URL: sessionRedis.href,
    AUTH_EMAIL_VERIFICATION_REQUIRED: 'false', POLEIS_RELAY_ENABLED: 'false',
    POLEIS_SETUP_VERSION: manifest.version
  };
  if (c.production !== false) values.TRUST_PROXY = 'true';
  for (const key of ['COOKIE_SECRET','SESSION_SECRET','AUTH_JWT_SECRET','SOCKET_JWT_SECRET']) values[key] = randomBytes(48).toString('base64url');
  return '# Generated by the independent Poleis installer. Configure SMTP before enabling email verification.\n' + Object.entries(values).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n';
}
async function install(input, { configPath = path.join(root, '.env'), progress = () => {} } = {}) {
  const c = validate(input, true);
  const sql = await fs.readFile(path.join(root, 'setup/database/schema.sql'), 'utf8');
  if (hash(sql) !== manifest.sha256) throw new Error('安装结构文件校验失败');
  // Never overwrite an existing installation/configuration.
  try { await fs.access(configPath); throw new Error('配置文件已存在；安装器不会覆盖现有配置，请使用独立的安装目录'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  progress('检查 MySQL 和 Redis');
  await testRedis(c.redisUrl);
  const db = await mysql.createConnection(connectionOptions(c));
  let locked = false;
  const lockName = 'poleis-setup:' + hash(c.database).slice(0, 48);
  try {
    const [[lock]] = await db.execute('SELECT GET_LOCK(?,0) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error('此数据库正在安装，请稍后再试');
    locked = true;
    const [schemas] = await db.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [c.database]);
    if (!schemas.length) {
      if (c.createDatabase !== true) throw new Error('数据库不存在，请先创建或勾选允许创建数据库');
      await db.query(`CREATE DATABASE \`${c.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
    await db.query(`USE \`${c.database}\``);
    const [existing] = await db.query('SHOW TABLES');
    const owned = existing.some(r => Object.values(r)[0] === 'poleis_setup_state');
    if (existing.length && !owned) throw new Error('数据库已有业务表，禁止按新安装处理；请选择空数据库');
    await db.query('CREATE TABLE IF NOT EXISTS poleis_setup_state (ID int PRIMARY KEY, VERSION varchar(40) NOT NULL, PHASE varchar(20) NOT NULL, DETAILS text NULL) ENGINE=InnoDB');
    await db.execute("INSERT IGNORE INTO poleis_setup_state VALUES (1,?,'schema',NULL)", [manifest.version]);
    const [[state]] = await db.query('SELECT * FROM poleis_setup_state WHERE ID=1');
    if (state.VERSION !== manifest.version || state.PHASE === 'complete') throw new Error('数据库已安装或安装版本不匹配，禁止重新初始化');
    const [[server]] = await db.query('SELECT VERSION() AS version');
    const maria = server.version.includes('MariaDB');
    const present = new Set(existing.map(r => Object.values(r)[0]));
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const table of extract(sql)) {
        progress('创建/检查表：' + table.name);
        if (!present.has(table.name)) await db.query(maria ? table.sql.replace(/utf8mb3/g, 'utf8') : table.sql);
      }
    } finally { await db.query('SET FOREIGN_KEY_CHECKS=1'); }
    await verify(db);
    // Compare canonical DDL for resumed tables on this server, including indexes/defaults.
    // Temporary reference tables are isolated in the connection and never contain rows.
    for (const table of extract(sql)) {
      const reference = '__poleis_verify';
      let ddl = table.sql.replace('CREATE TABLE `' + table.name + '`', 'CREATE TEMPORARY TABLE `' + reference + '`');
      if (maria) ddl = ddl.replace(/utf8mb3/g, 'utf8');
      // Compare foreign keys separately: temporary tables cannot have them.
      const foreignKeys = value => [...value.matchAll(/^\s*CONSTRAINT .*FOREIGN KEY.*$/gm)]
        .map(m => m[0].trim().replace(/,$/, '').replace(/ ON (DELETE|UPDATE) (RESTRICT|NO ACTION)/g, '').replace(/\s+/g, ' ')).sort();
      const withoutForeignKeys = value => value.replace(/^\s*CONSTRAINT .*FOREIGN KEY.*\n/gm, '').replace(/,\n\)/g, '\n)');
      ddl = withoutForeignKeys(ddl);
      await db.query(ddl);
      try {
        const [[actual]] = await db.query('SHOW CREATE TABLE `' + table.name + '`');
        const [[expected]] = await db.query('SHOW CREATE TABLE `' + reference + '`');
        const normalize = value => value.replace(/CREATE TEMPORARY TABLE/g,'CREATE TABLE').replace(/`__poleis_verify`/g,'`' + table.name + '`').replace(/ AUTO_INCREMENT=\d+/g,'');
        if (normalize(withoutForeignKeys(actual['Create Table'])) !== normalize(expected['Create Table']) ||
            JSON.stringify(foreignKeys(actual['Create Table'])) !== JSON.stringify(foreignKeys(table.sql))) {
          throw new Error('表字段、索引、外键或默认值不匹配：' + table.name);
        }
      } finally { await db.query('DROP TEMPORARY TABLE `' + reference + '`'); }
    }
    progress('创建管理员和基础权限');
    if (state.PHASE === 'schema') {
      await db.beginTransaction();
      try {
        await seed(db, c);
        await db.execute("UPDATE poleis_setup_state SET PHASE='seeded',DETAILS=? WHERE ID=1", [JSON.stringify({ adminName: c.adminName, adminEmail: c.adminEmail })]);
        await db.commit();
      } catch (e) { await db.rollback(); throw e; }
    } else {
      const saved = JSON.parse(state.DETAILS);
      if (saved.adminName !== c.adminName || saved.adminEmail !== c.adminEmail) throw new Error('恢复安装必须使用之前的管理员用户名和邮箱；密码不会被重置');
    }
    progress('保存配置');
    const temp = configPath + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, await envFile(c), { mode: 0o600, flag: 'wx' });
    try { await fs.link(temp, configPath); } finally { await fs.unlink(temp); }
    await db.query("UPDATE poleis_setup_state SET PHASE='complete' WHERE ID=1");
    progress('安装完成');
    return { tables: manifest.tables.length, version: manifest.version, adminName: c.adminName };
  } finally {
    if (locked) await db.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    await db.end();
  }
}
module.exports = { validate, check, install, verify, databaseUrl, manifest };
