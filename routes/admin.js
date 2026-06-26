'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.get('/', adminController.dashboard);
// 运营后台（平台管理 + 系统管理），仅平台超级管理员（控制器内校验）。
router.get('/ops', adminController.systemConsole);

module.exports = router;
