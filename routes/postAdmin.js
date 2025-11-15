'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const postAdminController = require('../controllers/postAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/posts', postAdminController.list);
router.get('/posts/:id', postAdminController.detail);
router.post('/posts', postAdminController.create);
router.put('/posts/:id', postAdminController.update);
router.delete('/posts/:id', postAdminController.remove);
router.post('/posts/:id/move', postAdminController.move);

module.exports = router;
