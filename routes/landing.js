var express = require('express');
var router = express.Router();

/* GET landing page. */
router.get('/', function(req, res) {
  res.render('landing', { title: 'Poleis - 远程控制管理平台' });
});

module.exports = router;
