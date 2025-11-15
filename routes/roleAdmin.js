'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const roleAdminController = require('../controllers/roleAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/roles', roleAdminController.list);
router.get('/roles/:id', roleAdminController.detail);
router.post('/roles', roleAdminController.create);
router.put('/roles/:id', roleAdminController.update);
router.delete('/roles/:id', roleAdminController.remove);

module.exports = router;
