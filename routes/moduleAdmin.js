'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const moduleAdminController = require('../controllers/moduleAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话已失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/modules', moduleAdminController.list);
router.get('/modules/tree', moduleAdminController.tree);
router.get('/modules/:id', moduleAdminController.detail);
router.post('/modules', moduleAdminController.create);
router.put('/modules/:id', moduleAdminController.update);
router.delete('/modules/:id', moduleAdminController.remove);

module.exports = router;
