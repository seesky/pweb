'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const staffAdminController = require('../controllers/staffAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/staff', staffAdminController.list);
router.get('/staff/:id', staffAdminController.detail);
router.post('/staff', staffAdminController.create);
router.put('/staff/:id', staffAdminController.update);
router.delete('/staff/:id', staffAdminController.remove);
router.post('/staff/:id/move', staffAdminController.move);
router.get('/organizes', staffAdminController.organizes);

module.exports = router;
