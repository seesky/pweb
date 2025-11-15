'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/sequenceAdminController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: '未登录或会话失效' });
  }
  req.currentUser = current;
  return next();
};

router.use(ensureAuthenticated);

router.get('/sequences', controller.list);
router.get('/sequences/:id', controller.detail);
router.post('/sequences', controller.create);
router.put('/sequences/:id', controller.update);
router.delete('/sequences/:id', controller.remove);

module.exports = router;
