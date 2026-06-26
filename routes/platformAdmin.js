'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/platformAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  req.currentUser = current;
  return next();
};

// 平台超管接口：跨租户，不经 resolveTenant（控制器内做超管校验）。
router.use('/platform-admin', ensureAuthenticated);
router.get('/platform-admin/tenants', controller.tenants);
router.patch('/platform-admin/tenants/:id', controller.updateTenant);
router.post('/platform-admin/tenants/:id/status', controller.setStatus);

module.exports = router;
