'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/platformPluginAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/plugins', controller.list);
router.get('/plugins/:id', controller.detail);
router.post('/plugins', controller.create);
router.put('/plugins/:id', controller.update);
router.delete('/plugins/:id', controller.remove);

module.exports = router;
