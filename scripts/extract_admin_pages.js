'use strict';
/*
 * 一次性提取脚本：把 views/admin-pages/*.jade 的 JS 内容提取成
 * public/javascripts/admin-pages/*.js（IIFE 包裹 + 末尾注册组件）。
 *
 * 用法： node scripts/extract_admin_pages.js
 * 运行后可删除本脚本。
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'views', 'admin-pages');
const OUT_DIR = path.join(__dirname, '..', 'public', 'javascripts', 'admin-pages');

// type → { src(文件名), out(输出文件名), component(组件名), pmAlias(需要哪些PM别名) }
const PAGES = [
  { type: 'module-admin',           src: 'moduleAdmin.jade',           out: 'moduleAdmin.js',           component: 'ModuleAdminPage' },
  { type: 'staff-admin',            src: 'staffAdmin.jade',            out: 'staffAdmin.js',            component: 'StaffAdminPage' },
  { type: 'user-admin',             src: 'userAdmin.jade',             out: 'userAdmin.js',             component: 'UserAdminPage' },
  { type: 'organize-admin',         src: 'organizeAdmin.jade',         out: 'organizeAdmin.js',         component: 'OrganizeAdminPage' },
  { type: 'role-admin',             src: 'roleAdmin.jade',             out: 'roleAdmin.js',             component: 'RoleAdminPage' },
  { type: 'post-admin',             src: 'postAdmin.jade',             out: 'postAdmin.js',             component: 'PostAdminPage' },
  { type: 'user-permission-admin',  src: 'userPermissionAdmin.jade',   out: 'userPermissionAdmin.js',   component: 'UserPermissionAdminPage' },
  { type: 'permission-item-admin',  src: 'permissionItemAdmin.jade',   out: 'permissionItemAdmin.js',   component: 'PermissionItemAdminPage' },
  { type: 'role-permission-admin',  src: 'rolePermissionAdmin.jade',   out: 'rolePermissionAdmin.js',   component: 'RolePermissionAdminPage' },
  { type: 'table-field-admin',      src: 'tableFieldAdmin.jade',       out: 'tableFieldAdmin.js',       component: 'TableFieldAdminPage' },
  { type: 'sys-config-admin',       src: 'sysConfigAdmin.jade',        out: 'sysConfigAdmin.js',        component: 'SysConfigAdminPage' },
  { type: 'parameter-admin',        src: 'parameterAdmin.jade',        out: 'parameterAdmin.js',        component: 'ParameterAdminPage' },
  { type: 'log-admin',              src: 'logAdmin.jade',              out: 'logAdmin.js',              component: 'LogAdminPage' },
  { type: 'exception-admin',        src: 'exceptionAdmin.jade',        out: 'exceptionAdmin.js',        component: 'ExceptionAdminPage' },
  { type: 'data-item-admin',        src: 'dataItemAdmin.jade',         out: 'dataItemAdmin.js',         component: 'DataItemAdminPage' },
  { type: 'message-admin',          src: 'messageAdmin.jade',          out: 'messageAdmin.js',          component: 'MessageAdminPage' },
  { type: 'online-manage',          src: 'onlineManage.jade',          out: 'onlineManage.js',          component: 'OnlineManagePage' },
  // 有 PM_* 跨文件依赖的三个文件。
  // pm-shared.js 提供了：PM.H/icon/GRADS/CARD_SX/formatDate/isToday/timeAgo/formatDuration/
  // KpiCard/Panel/StatusChip/Empty。这里建立本地别名，使原 jade 代码里的
  // PM_H / pmIcon / PM_GRADS / PM_CARD_SX / pmFormatDate / pmTimeAgo /
  // pmFormatDuration / pmIsToday / PmKpiCard / PmPanel / PmStatusChip / PmEmpty
  // 等标识符无需改名即可运行。
  { type: 'console',        src: 'peerManage.jade',    out: 'peerManage.js',    component: 'PeerManagePage',    pmAlias: 'full' },
  { type: 'platform-admin', src: 'platformAdmin.jade', out: 'platformAdmin.js', component: 'PlatformAdminPage', pmAlias: 'full' },
  { type: 'relay-admin',    src: 'relayAdmin.jade',    out: 'relayAdmin.js',    component: 'RelayAdminPage',    pmAlias: 'full' },
];

// peerManage.jade 顶部原本定义了 PM_H/pmIcon/PM_SECTIONS，提取后这几行要删掉
// （改用 pm-shared.js 提供的 window.PM.*）。这里用精确匹配删除。
const PEER_MANAGE_LINES_TO_DROP = [
  '  const PM_H = React.createElement;',
  '  const pmIcon = (name, props) => PM_H(MaterialUI.Icon, Object.assign({ fontSize: \'small\' }, props || {}), name);',
  '  const PM_SECTIONS = [',
];

function buildPmAlias(alias) {
  if (!alias) return '';
  // 'full' 模式：建立所有共享符号的本地别名，使原 jade 代码里的
  // PM_H / pmIcon / PM_GRADS / PM_CARD_SX / pmFormatDate / pmTimeAgo /
  // pmFormatDuration / pmIsToday / PmKpiCard / PmPanel / PmStatusChip / PmEmpty
  // 标识符无需改名即可运行（这些符号已迁移到 pm-shared.js 的 window.PM.*）。
  if (alias === 'full') {
    return [
      '  const PM_H = window.PM.H;',
      '  const pmIcon = window.PM.icon;',
      '  const PM_GRADS = window.PM.GRADS;',
      '  const PM_CARD_SX = window.PM.CARD_SX;',
      '  const PM_SECTIONS = window.PM_SECTIONS;',
      '  const pmFormatDate = window.PM.formatDate;',
      '  const pmIsToday = window.PM.isToday;',
      '  const pmTimeAgo = window.PM.timeAgo;',
      '  const pmFormatDuration = window.PM.formatDuration;',
      '  const PmKpiCard = window.PM.KpiCard;',
      '  const PmPanel = window.PM.Panel;',
      '  const PmStatusChip = window.PM.StatusChip;',
      '  const PmEmpty = window.PM.Empty;',
      ''
    ].join('\n');
  }
  // 兼容旧的数组模式（目前未使用，保留以防需要）
  const lines = [];
  if (alias.includes('H'))        lines.push("  const PM_H = window.PM.H;");
  if (alias.includes('icon'))     lines.push("  const pmIcon = window.PM.icon;");
  if (alias.includes('SECTIONS')) lines.push("  const PM_SECTIONS = window.PM_SECTIONS;");
  return lines.join('\n') + '\n';
}

function extractBody(srcFile) {
  let raw = fs.readFileSync(srcFile, 'utf8');
  // 去 UTF-8 BOM
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  // 首行是 script. ，去掉
  const lines = raw.split(/\r?\n/);
  if (lines[0] && lines[0].trim() === 'script.') {
    lines.shift();
  }
  return lines.join('\n');
}

// peerManage.jade 特殊处理：删除顶部已迁移到 pm-shared.js 的工具定义区。
// 该区间从 "const PM_H = React.createElement;" 开始，到 PM_SECTIONS 数组
// 闭合 "];" 结束（连续区间，含 PM_GRADS/PM_CARD_SX/pmIcon/pmFormatDate/
// pmIsToday/pmTimeAgo/pmFormatDuration/PmKpiCard/PmPanel/PmStatusChip/PmEmpty/
// PM_SECTIONS）。删除后这些符号由 pm-shared.js 的 window.PM.* 提供（顶部别名引入）。
function stripPeerManageDefinitions(body) {
  let lines = body.split('\n');
  const startIdx = lines.findIndex((l) => l === '  const PM_H = React.createElement;');
  if (startIdx === -1) {
    console.warn('  [warn] 未找到 peerManage 的 PM_H 定义起点，跳过剥离');
    return body;
  }
  // 从 startIdx 起找 PM_SECTIONS 数组的闭合 ];">
  // PM_SECTIONS 数组以 "const PM_SECTIONS = [" 开始，其后的首个独占一行的 "];" 为闭合
  let i = startIdx;
  let endIdx = -1;
  let inSectionsArray = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line === '  const PM_SECTIONS = [') {
      inSectionsArray = true;
    }
    if (inSectionsArray && line === '  ];') {
      endIdx = i;
      break;
    }
    i++;
  }
  if (endIdx === -1) {
    console.warn('  [warn] 未找到 PM_SECTIONS 数组闭合，跳过剥离');
    return body;
  }
  // 删除 [startIdx, endIdx]，并吃掉紧随其后的一行空行（避免留空）
  let removed = lines.splice(startIdx, endIdx - startIdx + 1);
  // 若删除后紧接着是空行，也移除一个，避免双空行
  if (lines[startIdx] === '') lines.splice(startIdx, 1);
  return lines.join('\n');
}

function processPage(page) {
  const srcFile = path.join(SRC_DIR, page.src);
  const outFile = path.join(OUT_DIR, page.out);

  let body = extractBody(srcFile);

  if (page.type === 'console') {
    body = stripPeerManageDefinitions(body);
  }

  const alias = buildPmAlias(page.pmAlias);

  const output = [
    '/**',
    ' * ' + page.out + ' —— 由 views/admin-pages/' + page.src + ' 提取。',
    ' * 懒加载：用户切换到「' + page.type + '」页时由 loader.js 动态拉取。',
    ' * 依赖：react / react-dom / material-ui（外壳已同步加载）' + (page.pmAlias ? ' + pm-shared.js' : ''),
    ' */',
    '(function () {',
    '  \'use strict\';',
    alias ? '\n' + alias : '',
    body.trim(),
    '',
    '  // 注册组件供 loader.js 读取',
    '  window.AdminPages = window.AdminPages || {};',
    '  window.AdminPages[\'' + page.type + '\'] = ' + page.component + ';',
    '})();',
    ''
  ].join('\n');

  fs.writeFileSync(outFile, output, 'utf8');
  const sizeKB = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
  console.log('✓ ' + page.out.padEnd(28) + ' (' + sizeKB + ' KB)');
}

// 主流程
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
console.log('提取 admin-pages → public/javascripts/admin-pages/');
console.log('------------------------------------------------');
for (const page of PAGES) {
  processPage(page);
}
console.log('------------------------------------------------');
console.log('完成。共 ' + PAGES.length + ' 个页面脚本。');
