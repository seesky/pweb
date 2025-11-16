'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/tableFieldAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/tables', controller.tables);
router.get('/columns', controller.list);
router.get('/columns/:id', controller.detail);
router.post('/columns', controller.create);
router.put('/columns/:id', controller.update);
router.delete('/columns/:id', controller.remove);

module.exports = router;
