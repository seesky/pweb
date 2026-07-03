'use strict';

const crypto = require('node:crypto');
const CommonUtils = require('../utilities/publiclibrary/common_utils');

const isProduction = process.env.NODE_ENV === 'production';
const generatedSecrets = new Map();

const getSecret = (name) => {
  const value = String(process.env[name] || '');
  if (value.length >= 32) return value;
  if (isProduction) {
    throw new Error(`${name} must be configured with at least 32 characters in production`);
  }
  if (!generatedSecrets.has(name)) {
    generatedSecrets.set(name, crypto.randomBytes(48).toString('base64url'));
  }
  return generatedSecrets.get(name);
};

const getCurrentUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (user) req.currentUser = user;
  return user;
};

const requireAuthenticated = (req, res, next) => {
  if (!getCurrentUser(req, res)) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  return next();
};

const isPlatformAdmin = (user) =>
  !!(user && (user.Id === 'Administrator' || user.IsAdministrator === true));

const requirePlatformAdmin = (req, res, next) => {
  const user = getCurrentUser(req, res);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!isPlatformAdmin(user)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  return next();
};

const sameOriginOnly = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const origin = req.get('origin');
  if (!origin) {
    const fetchSite = req.get('sec-fetch-site');
    if (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none') {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Cross-site request blocked' });
  }

  try {
    const expected = new URL(
      process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`
    ).origin;
    if (new URL(origin).origin !== expected) {
      return res.status(403).json({ success: false, message: 'Cross-site request blocked' });
    }
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid request origin' });
  }
  return next();
};

module.exports = {
  getSecret,
  getCurrentUser,
  isPlatformAdmin,
  requireAuthenticated,
  requirePlatformAdmin,
  sameOriginOnly
};
