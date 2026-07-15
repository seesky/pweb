'use strict';

const multer = require('multer');
const express = require('express');
const security = require('../middleware/security');
const controller = require('../controllers/releaseController');
const { TEMP_ROOT } = require('../services/release_service');

const router = express.Router();
const upload = multer({
  dest: TEMP_ROOT,
  limits: { fileSize: Number(process.env.RELEASE_MAX_FILE_SIZE || 2 * 1024 * 1024 * 1024), files: 1 }
});

router.get('/api/releases/latest', controller.latest);
router.get('/api/releases/downloads', controller.downloads);
router.get('/downloads/releases/:id', controller.download);

router.use('/release-admin', security.requirePlatformAdmin);
router.get('/release-admin/releases', controller.list);
router.post('/release-admin/releases', upload.single('installer'), controller.create);
router.patch('/release-admin/releases/:id', controller.update);
router.delete('/release-admin/releases/:id', controller.remove);

module.exports = router;
