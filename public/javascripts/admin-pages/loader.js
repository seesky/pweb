/**
 * loader.js —— admin 页面懒加载器。
 *
 * 各页面组件拆成独立 .js（同目录下），首次切换到某页面时才动态加载，
 * 已加载的脚本会被缓存，二次切换零网络开销。
 *
 * 约定：每个页面 .js 末尾会把自己导出的组件挂到：
 *   window.AdminPages = window.AdminPages || {};
 *   window.AdminPages['<type>'] = XxxPage;
 *
 * AdminPageLoader.load(type) → Promise<组件构造函数>
 */
(function () {
  'use strict';

  // type → { file, component } 映射
  var PAGE_MAP = {
    'module-admin': { file: 'moduleAdmin.js', component: 'ModuleAdminPage' },
    'staff-admin': { file: 'staffAdmin.js', component: 'StaffAdminPage' },
    'user-admin': { file: 'userAdmin.js', component: 'UserAdminPage' },
    'organize-admin': { file: 'organizeAdmin.js', component: 'OrganizeAdminPage' },
    'role-admin': { file: 'roleAdmin.js', component: 'RoleAdminPage' },
    'post-admin': { file: 'postAdmin.js', component: 'PostAdminPage' },
    'user-permission-admin': { file: 'userPermissionAdmin.js', component: 'UserPermissionAdminPage' },
    'permission-item-admin': { file: 'permissionItemAdmin.js', component: 'PermissionItemAdminPage' },
    'role-permission-admin': { file: 'rolePermissionAdmin.js', component: 'RolePermissionAdminPage' },
    'table-field-admin': { file: 'tableFieldAdmin.js', component: 'TableFieldAdminPage' },
    'sys-config-admin': { file: 'sysConfigAdmin.js', component: 'SysConfigAdminPage' },
    'parameter-admin': { file: 'parameterAdmin.js', component: 'ParameterAdminPage' },
    'log-admin': { file: 'logAdmin.js', component: 'LogAdminPage' },
    'exception-admin': { file: 'exceptionAdmin.js', component: 'ExceptionAdminPage' },
    'data-item-admin': { file: 'dataItemAdmin.js', component: 'DataItemAdminPage' },
    'message-admin': { file: 'messageAdmin.js', component: 'MessageAdminPage' },
    'online-manage': { file: 'onlineManage.js', component: 'OnlineManagePage' },
    'console': { file: 'peerManage.js', component: 'PeerManagePage' },
    'platform-admin': { file: 'platformAdmin.js', component: 'PlatformAdminPage' },
    'platform-plugin-admin': { file: 'platformPluginAdmin.js', component: 'PlatformPluginAdminPage' },
    'release-admin': { file: 'releaseAdmin.js', component: 'ReleaseAdminPage' },
    'sequence-admin': { file: 'sequenceAdmin.js', component: 'SequenceAdminPage' },
    'relay-admin': { file: 'relayAdmin.js', component: 'RelayAdminPage' }
  };

  var BASE = '/javascripts/admin-pages/';
  // 已加载（或正在加载）的脚本缓存：type → Promise
  var cache = {};

  window.AdminPages = window.AdminPages || {};

  // 用原生 <script> 标签加载（同源，符合 CSP script-src 'self'）。
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        reject(new Error('加载页面脚本失败：' + src));
      };
      document.head.appendChild(s);
    });
  }

  function load(type) {
    var entry = PAGE_MAP[type];
    if (!entry) {
      return Promise.reject(new Error('未知的页面类型：' + type));
    }
    // 命中缓存：直接返回已注册的组件。
    if (window.AdminPages[type]) {
      return Promise.resolve(window.AdminPages[type]);
    }
    if (!cache[type]) {
      cache[type] = loadScript(BASE + entry.file).then(function () {
        var comp = window.AdminPages[type];
        if (!comp) {
          throw new Error('页面脚本已加载但未注册组件：' + type + '（期望 ' + entry.component + '）');
        }
        return comp;
      }).catch(function (err) {
        // 失败时清掉缓存，允许后续重试。
        cache[type] = null;
        throw err;
      });
    }
    return cache[type];
  }

  // 预加载（不渲染），用于默认页 preload 提前拉取。
  function preload(type) {
    if (!PAGE_MAP[type]) return;
    if (!cache[type] && !window.AdminPages[type]) {
      cache[type] = loadScript(BASE + PAGE_MAP[type].file).then(function () {
        return window.AdminPages[type];
      }).catch(function () { cache[type] = null; });
    }
  }

  window.AdminPageLoader = { load: load, preload: preload, PAGE_MAP: PAGE_MAP };
})();
