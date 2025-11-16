'use strict';

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { ParameterService } = require('../services/base/parameter_service');

const parameterService = new ParameterService();

const COOKIE_DEFAULT_AGE = 1000 * 60 * 60 * 4;
const THEME_COOKIE_NAME = 'theme';
const NAV_COOKIE_NAME = 'UIStyle';

const ensureUser = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return current;
};

const readConfigValue = async (current, key) => {
  try {
    return await parameterService.getServiceConfig(current, key);
  } catch (error) {
    return '';
  }
};

const getCookieOptions = async (current, signed = true) => {
  const maxAgeConfig = await readConfigValue(current, 'CookieMaxAge');
  const maxAge = parseInt(maxAgeConfig, 10);
  return {
    maxAge: Number.isNaN(maxAge) ? COOKIE_DEFAULT_AGE : maxAge,
    signed
  };
};

exports.getDefaultConfig = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  try {
    const [theme, gridRows, navType, loginProvider] = await Promise.all([
      parameterService.getParameter(current, 'User', current.Id, 'WebTheme'),
      parameterService.getParameter(current, 'User', current.Id, 'WebPageSize'),
      parameterService.getParameter(current, 'User', current.Id, 'NavType'),
      readConfigValue(current, 'LoginProvider')
    ]);
    if (loginProvider === 'Cookie' && theme) {
      const options = await getCookieOptions(current);
      res.cookie(THEME_COOKIE_NAME, theme, options);
    }
    const data = {
      theme: theme || 'default',
      gridRows: parseInt(gridRows || '20', 10) || 20,
      navType: navType || 'AccordionTree'
    };
    res.json({ success: true, data });
  } catch (error) {
    console.error('[SysConfigAdmin.getDefaultConfig]', error);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
};

exports.updateUserConfig = async (req, res) => {
  const current = ensureUser(req, res);
  if (!current) {
    return;
  }
  const payload = req.body || {};
  const theme = (payload.theme || '').trim();
  const navType = (payload.navType || '').trim();
  const gridRows = parseInt(payload.gridRows, 10) || 20;
  try {
    let updatedCount = 0;
    if (payload.gridRows !== undefined) {
      updatedCount += await parameterService.setParameter(current, 'User', current.Id, 'WebPageSize', String(gridRows));
    }
    if (theme) {
      updatedCount += await parameterService.setParameter(current, 'User', current.Id, 'WebTheme', theme);
      const options = await getCookieOptions(current);
      res.cookie(THEME_COOKIE_NAME, theme, options);
    }
    if (navType) {
      updatedCount += await parameterService.setParameter(current, 'User', current.Id, 'NavType', navType);
      const options = await getCookieOptions(current);
      res.cookie(NAV_COOKIE_NAME, navType, options);
    }
    if (!updatedCount) {
      return res.status(400).json({ success: false, message: '无效的配置内容' });
    }
    res.json({ success: true, message: '系统配置已保存', data: { theme, gridRows, navType } });
  } catch (error) {
    console.error('[SysConfigAdmin.updateUserConfig]', error);
    res.status(500).json({ success: false, message: '保存配置失败' });
  }
};
