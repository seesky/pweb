'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const userAdminController = require('../controllers/userAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/users', userAdminController.list);
router.get('/users/:id', userAdminController.detail);
router.post('/users', userAdminController.create);
router.put('/users/:id', userAdminController.update);
router.delete('/users/:id', userAdminController.remove);
router.get('/organizes', userAdminController.organizes);

module.exports = router;
