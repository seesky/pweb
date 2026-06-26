'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/saasOnboardingController');

// 公开（无需登录）：企业账号申请 + 邮箱验证。
router.get('/saas/register', controller.registerPage);   // 渲染申请页
router.post('/saas/register', controller.register);       // 提交申请（API）
router.get('/saas/verify', controller.verify);
router.get('/set-password', controller.setPasswordPage);  // 成员邀请/找回密码 设密页

module.exports = router;
