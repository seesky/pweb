'use strict';

const UserInfo = require('./user_info');
const getCookieMaxAge = () =>
  parseInt(process.env.SESSION_MAX_AGE_MS || '14400000', 10) || 14400000;
const getLoginUserKey = () => 'LoginUserKey';

const serializeUser = (userInfo) => {
  if (!userInfo) {
    return '';
  }
  return UserInfo.objToJson(userInfo);
};

const deserializeUser = (encrypted) => {
  if (!encrypted || typeof encrypted !== 'object') {
    return null;
  }
  try {
    return UserInfo.jsonToObj(encrypted);
  } catch (error) {
    return null;
  }
};

class CommonUtils {
  static addCurrent(userInfo, res, req) {
    if (!userInfo || !req) {
      return;
    }
    const serialized = serializeUser(userInfo);
    const cookieKey = getLoginUserKey();
    const maxAge = getCookieMaxAge();
    req.session[cookieKey] = serialized;
    req.session.cookie.maxAge = maxAge;
  }

  static getCurrent(res, req) {
    const cookieKey = getLoginUserKey();
    return deserializeUser(req?.session?.[cookieKey]);
  }

  static emptyCurrent(res, req) {
    const cookieKey = getLoginUserKey();
    if (req?.session) {
      delete req.session[cookieKey];
    }
  }

  static uiStyle(userInfo, res, req) {
    const style = 'AccordionTree';
    const maxAge = getCookieMaxAge();
    const cookieOptions = {
      maxAge,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    };
    if (req?.session) {
      req.session.UIStyle = style;
    }
    res?.cookie?.('UIStyle', style, cookieOptions);
    return style;
  }
}

module.exports = CommonUtils;
