'use strict';

const express = require('express');
const router = express.Router();
const loginController = require('../controllers/loginController');
const authController = require('../controllers/authController');

// 渲染登录页
router.get('/', loginController.index);
// 统一走新的 2FA 登录逻辑
router.post('/', authController.login);
// 保持原有退出
router.post('/logout', loginController.logout);

module.exports = router;
