var express = require('express');
var router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/2fa/verify', authController.verify2fa);
router.post('/2fa/setup', authController.setup2fa);
router.post('/2fa/enable', authController.enable2fa);
router.post('/2fa/disable', authController.disable2fa);
router.post('/password/forgot', authController.forgotPassword);
router.post('/password/reset', authController.resetPassword);

module.exports = router;
