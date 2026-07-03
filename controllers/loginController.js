'use strict';

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const NetHelper = require('../utilities/publiclibrary/net_helper');
const StatusCode = require('../utilities/message/status_code');
const { logOnService } = require('../services/base/log_on_service');

const SUCCESS_REDIRECT = '/admin';

exports.index = (req, res) => {
  if (CommonUtils.getCurrent(res, req)) {
    return res.redirect(SUCCESS_REDIRECT);
  }
  // 统一 SaaS 平台：登录页始终展示「申请企业账号」入口。
  res.render('login', { title: '后台登录', saasMode: true });
};

exports.checkLogin = async (req, res) => {
  const { account, password } = req.body || {};
  if (!account || !password) {
    return res.status(400).json({ success: false, message: '请输入用户名和密码' });
  }
  const ipAddress = NetHelper.getIpAddress(req) || req.ip || '';

  try {
    const { returnStatusCode, userInfo } = await logOnService.userLogOn(
      account,
      password,
      '',
      false,
      ipAddress
    );

    if (returnStatusCode === StatusCode.OK && userInfo) {
      CommonUtils.addCurrent(userInfo, res, req);
      CommonUtils.uiStyle(userInfo, res, req);
      return res.json({ success: true, redirect: SUCCESS_REDIRECT });
    }

    return res
      .status(401)
      .json({ success: false, message: '用户名或密码错误，请重试。' });
  } catch (error) {
    console.error('[LoginController.checkLogin]', error);
    return res.status(500).json({ success: false, message: '服务器开小差了，请稍后再试。' });
  }
};

exports.logout = async (req, res) => {
  const current = CommonUtils.getCurrent(res, req);
  if (current?.Id) {
    try {
      await logOnService.onExit(current.Id);
    } catch (error) {
      console.error('[LoginController.logout]', error);
    }
  }
  CommonUtils.emptyCurrent(res, req);
  if (req.session) {
    req.session.destroy(() => {});
  }
  res.clearCookie('UIStyle');
  return res.json({ success: true, redirect: '/login' });
};
