'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/messageAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/messages', controller.list);
router.get('/messages/:id', controller.detail);
router.post('/messages', controller.send);
router.post('/messages/read', controller.markRead);
router.post('/messages/delete', controller.remove);

module.exports = router;
