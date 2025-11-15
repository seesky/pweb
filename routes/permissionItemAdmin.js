'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/permissionItemAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/permission-items', controller.list);
router.get('/permission-items/tree', controller.tree);
router.get('/permission-items/:id', controller.detail);
router.post('/permission-items', controller.create);
router.put('/permission-items/:id', controller.update);
router.delete('/permission-items/:id', controller.remove);
router.post('/permission-items/:id/move', controller.move);
router.get('/modules', controller.modules);

module.exports = router;
