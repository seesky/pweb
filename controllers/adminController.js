'use strict';

const { PrismaClient } = require('@prisma/client');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { ModuleService } = require('../services/base/module_service');
const UserInfo = require('../utilities/publiclibrary/user_info');

const prisma = new PrismaClient();
const moduleService = new ModuleService(prisma);

const buildNavTree = (modules = []) => {
  const moduleNodes = new Map();
  modules.forEach((item) => {
    moduleNodes.set(item.ID, {
      id: item.ID,
      title: item.FULLNAME || item.NAME || item.CODE,
      code: item.CODE,
      icon: item.ICON || 'dashboard',
      path: `/modules/${item.CODE || item.ID}`,
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

exports.dashboard = async (req, res) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.redirect('/login');
  }

  let navData = [];
  try {
    const modules = await moduleService.getDT();
    navData = buildNavTree(modules || []);
  } catch (error) {
    // log and fallback to default nav
    console.error('[AdminController.dashboard] failed to load modules', error);
    navData = [
      {
        id: 'dashboard',
        title: '仪表盘',
        code: 'dashboard',
        icon: 'dashboard',
        path: '/admin/overview',
        children: []
      }
    ];
  }

  const userPayload = UserInfo.objToJson(current);

  res.render('admin', {
    title: '管理后台',
    user: userPayload,
    navData: JSON.stringify(navData)
  });
};
