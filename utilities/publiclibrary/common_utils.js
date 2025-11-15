'use strict';

const SecretHelper = require('./secret_helper');
const UserInfo = require('./user_info');
const { ParameterService } = require('../../services/base/parameter_service');

const parameterService = new ParameterService();

const getConfig = (key, defaultValue) => {
  try {
    return parameterService.getServiceConfig(null, key) || defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

const getProvider = () => getConfig('LoginProvider', 'Session');
const getCookieMaxAge = () => parseInt(getConfig('CookieMaxAge', '14400000'), 10) || 14400000;
const getLoginUserKey = () => getConfig('LoginUserKey', 'LoginUserKey');

const serializeUser = (userInfo) => {
  if (!userInfo) {
    return '';
  }
  const payload = JSON.stringify(UserInfo.objToJson(userInfo));
  return SecretHelper.aesEncrypt(payload);
};

const deserializeUser = (encrypted) => {
  if (!encrypted) {
    return null;
  }
  const decrypted = SecretHelper.aesDecrypt(encrypted);
  if (!decrypted) {
    return null;
  }
  try {
    const data = JSON.parse(decrypted);
    return UserInfo.jsonToObj(data);
  } catch (error) {
    return null;
  }
};

class CommonUtils {
  static addCurrent(userInfo, res, req) {
    if (!userInfo || !req) {
      return;
    }
    const encrypted = serializeUser(userInfo);
    const provider = getProvider();
    const cookieKey = provider;
    const maxAge = getCookieMaxAge();
    const cookieOptions = {
      maxAge,
      httpOnly: true,
      signed: true
    };

    if (provider === 'Cookie') {
      res?.cookie(cookieKey, encrypted, cookieOptions);
    } else {
      req.session[cookieKey] = encrypted;
      req.session.cookie.maxAge = maxAge;
    }
  }

  static getCurrent(res, req) {
    const provider = getProvider();
    const cookieKey = provider;
    let encrypted;
    if (provider === 'Cookie') {
      encrypted = req?.signedCookies?.[cookieKey];
    } else {
      encrypted = req?.session?.[cookieKey];
    }
    return deserializeUser(encrypted);
  }

  static emptyCurrent(res, req) {
    const provider = getProvider();
    const cookieKey = provider;
    if (provider === 'Cookie') {
      res?.clearCookie(cookieKey);
    } else if (req?.session) {
      delete req.session[cookieKey];
    }
  }

  static uiStyle(userInfo, res, req) {
    const style = 'AccordionTree';
    const maxAge = getCookieMaxAge();
    const cookieOptions = {
      maxAge,
      signed: true
    };
    if (req?.session) {
      req.session.UIStyle = style;
    }
    res?.cookie?.('UIStyle', style, cookieOptions);
    return style;
  }
}

module.exports = CommonUtils;
