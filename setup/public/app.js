'use strict';
const token = location.hash.slice(1) || sessionStorage.getItem('poleis-setup-token') || '';
if (token) sessionStorage.setItem('poleis-setup-token', token);
// Keep the fragment across reloads; fragments are never sent to the server.
const form = document.querySelector('#setup');
const summary = document.querySelector('#summary');
const progress = document.querySelector('#progress');
let running = false;
function values() {
  const result = Object.fromEntries(new FormData(form));
  result.production = form.elements.production.checked;
  result.createDatabase = form.elements.createDatabase.checked;
  return result;
}
async function api(route, body) {
  const response = await fetch('/api/' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Setup-Token': token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function disable(value) { for (const element of form.elements) element.disabled = value; }
document.querySelector('#check').addEventListener('click', async () => {
  const output = document.querySelector('#connection');
  const button = document.querySelector('#check');
  button.disabled = true; output.textContent = '正在测试连接…';
  try { const data = await api('check', values()); output.textContent = `${data.message} 数据库版本：${data.version}，现有表：${data.tables}。`; }
  catch (e) { output.textContent = e.message; }
  finally { if (!running) button.disabled = false; }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const input = values();
  disable(true); running = true; summary.textContent = '正在提交安装…';
  try { await api('install', input); summary.textContent = '安装正在进行，请勿关闭安装服务。'; await poll(); }
  catch (e) { summary.textContent = e.message; running = false; disable(false); }
});
async function poll() {
  try {
    const state = await api('status');
    progress.textContent = state.steps.join('\n');
    if (state.phase === 'complete') {
      running = false; disable(true);
      form.elements.adminPassword.value = ''; form.elements.confirmPassword.value = ''; form.elements.password.value = '';
      summary.textContent = `安装完成，已建立 ${state.result.tables} 张表。管理员：${state.result.adminName}。请退出安装器，再执行 npm start。`;
    } else if (state.phase === 'running') { running = true; disable(true); setTimeout(poll, 700); }
    else if (state.configured) { disable(true); summary.textContent = '配置文件已存在。安装器不会覆盖现有配置，请启动业务服务或使用新的安装目录。'; }
    else { running = false; disable(false); if (state.error) summary.textContent = state.error + ' 修正后可重新提交；已创建的管理员密码不会被重置。'; }
  } catch (e) { summary.textContent = e.message; if (running) setTimeout(poll, 1500); else disable(true); }
}
poll();
