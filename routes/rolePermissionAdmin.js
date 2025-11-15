'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/rolePermissionAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/roles', controller.list);
router.get('/roles/:id/detail', controller.detail);
router.post('/roles/:id/modules', controller.updateModules);
router.post('/roles/:id/permission-items', controller.updatePermissionItems);
router.get('/modules', controller.modules);
router.get('/permission-items', controller.permissionItems);

module.exports = router;
