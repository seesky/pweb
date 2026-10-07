'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { check, install } = require('./services/install');
function createInstaller({ configPath, token = randomBytes(32).toString('hex') } = {}) {
  const app = express();
  let checking = false;
  const status = { phase: 'idle', steps: [], error: null, result: null };
  configPath = path.resolve(configPath || path.join(__dirname, '../.env'));
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
    next();
  });
  app.use('/api', (req, res, next) => {
    const supplied = Buffer.from(req.get('x-setup-token') || '');
    const wanted = Buffer.from(token);
    if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) return res.status(403).json({ error: '安装令牌无效，请使用终端显示的链接' });
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: '禁止跨站安装请求' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/status', (req, res) => res.json({ ...status, configured: fs.existsSync(configPath) }));
  const safeError = e => e.code ? `操作失败（${e.code}），请检查连接、权限或数据库兼容性。` : e.message;
  app.post('/api/check', async (req, res) => {
    if (checking || status.phase === 'running' || status.phase === 'complete') return res.status(409).json({ error: '安装或检查正在运行，或安装已完成' });
    checking = true;
    try { res.json(await check(req.body)); }
    catch (e) { res.status(400).json({ error: safeError(e) }); }
    finally { checking = false; }
  });
  app.post('/api/install', (req, res) => {
    if (checking || status.phase === 'running' || status.phase === 'complete' || fs.existsSync(configPath)) return res.status(409).json({ error: '安装运行中、已完成或配置文件已存在；禁止覆盖' });
    status.phase = 'running'; status.steps = []; status.error = null;
    const input = req.body;
    res.status(202).json({ accepted: true });
    install(input, { configPath, progress: message => { status.steps.push(message); } })
      .then(result => { status.result = result; status.phase = 'complete'; })
      .catch(e => { status.error = safeError(e); status.phase = 'failed'; })
      .finally(() => { delete input.adminPassword; delete input.confirmPassword; delete input.password; });
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((err, req, res, next) => res.status(400).json({ error: '请求格式无效' }));
  return { app, token, status };
}
if (require.main === module) {
  const host = process.env.SETUP_HOST || '127.0.0.1';
  const port = Number(process.env.SETUP_PORT || 3080);
  const { app, token } = createInstaller({ configPath: process.env.SETUP_CONFIG_PATH });
  const server = app.listen(port, host, () => {
    console.log(`Poleis 独立安装向导：http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.address().port}/#${token}`);
    console.log('安装完成后按 Ctrl+C 退出，再执行 npm start。');
  });
  server.on('error', e => { console.error(`安装服务无法启动：${e.code}`); process.exitCode = 1; });
}
module.exports = { createInstaller };
