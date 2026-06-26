'use strict';

const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { ModuleService } = require('../services/base/module_service');
const UserInfo = require('../utilities/publiclibrary/user_info');
const { resolveTenantContext } = require('../services/management/tenant_context');

const prisma = new PrismaClient();
const moduleService = new ModuleService(prisma);

const normalizeNavPath = (value) => {
  const v = (value || '').trim();
  if (!v || v === '#') return '';
  return v;
};

const buildNavTree = (modules = []) => {
  const moduleNodes = new Map();
  modules.forEach((item) => {
    const navPath =
      normalizeNavPath(item.MVCNAVIGATEURL) ||
      normalizeNavPath(item.NAVIGATEURL) ||
      normalizeNavPath(item.PATH) ||
      normalizeNavPath(item.CODE);
    moduleNodes.set(item.ID, {
      id: item.ID,
      title: item.FULLNAME || item.NAME || item.CODE,
      code: item.CODE,
      icon: item.ICON || 'dashboard',
      mvcNavigateUrl: navPath,
      path: navPath || `/modules/${(item.CODE || item.ID || '').toLowerCase()}`,
      children: []
    });
  });

  const roots = [];
  modules.forEach((item) => {
    const node = moduleNodes.get(item.ID);
    if (item.PARENTID && moduleNodes.has(item.PARENTID)) {
      moduleNodes.get(item.PARENTID).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

const isSuperAdmin = (u) => !!(u && (u.Id === 'Administrator' || u.IsAdministrator));

// 共享外壳：appMode='customer'（Poleis 控制台，面向个人/企业用户）
//           appMode='ops'（运营后台：平台管理 + 系统管理，仅平台超管）
async function renderAdminShell(req, res, appMode) {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.redirect('/login');
  }

  // 系统管理（pi RBAC）导航仅运营后台需要；客户产品不加载。
  let navData = [];
  if (appMode === 'ops') {
    try {
      const modules = current?.IsAdministrator
        ? await moduleService.getDT()
        : await moduleService.getDTByUser(current?.Id);
      navData = buildNavTree(modules || []);
    } catch (error) {
      console.error('[AdminController] failed to load modules', error);
      navData = [];
    }
  }

  let tenantContext = {};
  try {
    tenantContext = await resolveTenantContext(req, current) || {};
  } catch (error) {
    console.error('[AdminController] failed to resolve tenant context', error);
  }

  res.render('admin', {
    title: appMode === 'ops' ? '运营后台' : '管理后台',
    user: UserInfo.objToJson(current),
    navData: JSON.stringify(navData),
    tenantContext,
    appMode
  });
}

// 客户产品：Poleis 控制台。个人/企业用户登录后只见这里。
exports.dashboard = (req, res) => renderAdminShell(req, res, 'customer');

// 运营后台：平台管理 + 系统管理。仅平台超级管理员可进，否则回客户控制台。
exports.systemConsole = (req, res) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) return res.redirect('/login');
  if (!isSuperAdmin(current)) return res.redirect('/admin');
  return renderAdminShell(req, res, 'ops');
};
