'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const organizeAdminController = require('../controllers/organizeAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/organizes', organizeAdminController.list);
router.get('/organizes/:id', organizeAdminController.detail);
router.post('/organizes', organizeAdminController.create);
router.put('/organizes/:id', organizeAdminController.update);
router.delete('/organizes/:id', organizeAdminController.remove);

module.exports = router;
