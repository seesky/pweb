'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/userPermissionAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/users', controller.list);
router.get('/users/:id/detail', controller.detail);
router.get('/roles', controller.roles);
router.get('/modules', controller.modules);
router.get('/permission-items', controller.permissionItems);
router.get('/organizes', controller.organizes);
router.get('/users/:id/organize-scope', controller.organizeScope);
router.post('/users/:id/roles', controller.updateRoles);
router.post('/users/:id/modules', controller.updateModules);
router.post('/users/:id/permission-items', controller.updatePermissionItems);
router.post('/users/:id/organize-scope', controller.updateOrganizeScope);

module.exports = router;
