var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var rateLimit = require('express-rate-limit');
var security = require('./middleware/security');
var RedisStore = require('connect-redis').RedisStore;
var createClient = require('redis').createClient;

var landingRouter = require('./routes/landing');
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var loginRouter = require('./routes/login');
var authRouter = require('./routes/auth');
var adminRouter = require('./routes/admin');
var moduleAdminRouter = require('./routes/moduleAdmin');
var staffAdminRouter = require('./routes/staffAdmin');
var userAdminRouter = require('./routes/userAdmin');
var organizeAdminRouter = require('./routes/organizeAdmin');
var roleAdminRouter = require('./routes/roleAdmin');
var rolePermissionAdminRouter = require('./routes/rolePermissionAdmin');
var postAdminRouter = require('./routes/postAdmin');
var userPermissionAdminRouter = require('./routes/userPermissionAdmin');
var permissionItemAdminRouter = require('./routes/permissionItemAdmin');
var sequenceAdminRouter = require('./routes/sequenceAdmin');
var tableFieldAdminRouter = require('./routes/tableFieldAdmin');
var sysConfigAdminRouter = require('./routes/sysConfigAdmin');
var parameterAdminRouter = require('./routes/parameterAdmin');
var logAdminRouter = require('./routes/logAdmin');
var exceptionAdminRouter = require('./routes/exceptionAdmin');
var dataItemAdminRouter = require('./routes/dataItemAdmin');
var messageAdminRouter = require('./routes/messageAdmin');
var socketRouter = require('./routes/socket');
var realtimeAdminRouter = require('./routes/realtimeAdmin');
var relayAdminRouter = require('./routes/relayAdmin');
var managementPlatformRouter = require('./routes/managementPlatform');
var saasOnboardingRouter = require('./routes/saasOnboarding');
var platformAdminRouter = require('./routes/platformAdmin');

var app = express();
var isProduction = process.env.NODE_ENV === 'production';
var sessionStore;

// 登录限流相关参数：均可通过 .env 调整；未配置时保留内置默认值。
// AUTH_RATE_LIMIT_ENABLED：是否启用登录接口限流（false 时所有登录类接口不限流）
// AUTH_RATE_WINDOW_MS：限流计数窗口（毫秒）
// AUTH_RATE_LIMIT：窗口内同一 IP 的最大请求次数
// SESSION_COOKIE_MAX_AGE_MS：会话 cookie 有效期（毫秒）
var envBool = function (name, fallback) {
  var v = String(process.env[name] || '').trim().toLowerCase();
  if (v === '') return fallback;
  return v === 'false' || v === '0' || v === 'no' ? false : Boolean(v);
};
var envInt = function (name, fallback) {
  var v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.trunc(v) : fallback;
};
var rateLimitEnabled = envBool('AUTH_RATE_LIMIT_ENABLED', true);
var rateWindowMs = envInt('AUTH_RATE_WINDOW_MS', 15 * 60 * 1000);
var rateLimitCount = envInt('AUTH_RATE_LIMIT', 10);
var sessionMaxAge = envInt('SESSION_COOKIE_MAX_AGE_MS', 1000 * 60 * 60 * 4);

if (isProduction) {
  if (!process.env.SESSION_REDIS_URL) {
    throw new Error('SESSION_REDIS_URL is required in production');
  }
  var sessionRedisClient = createClient({ url: process.env.SESSION_REDIS_URL });
  sessionRedisClient.on('error', function(error) {
    console.error('[session redis]', error);
  });
  sessionRedisClient.connect().catch(function(error) {
    console.error('[session redis] failed to connect', error);
  });
  sessionStore = new RedisStore({ client: sessionRedisClient, prefix: 'poleis:sess:' });
}

if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
}
app.disable('x-powered-by');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.engine('jade', require('pug').__express);

app.use(logger(isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }));
app.use(cookieParser(security.getSecret('COOKIE_SECRET')));
app.use(
  session({
    name: 'poleis.sid',
    secret: security.getSecret('SESSION_SECRET'),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: sessionMaxAge
    }
  })
);
app.use(function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(security.sameOriginOnly);
app.get('/vendor/react.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/react/umd/react.production.min.js')));
app.get('/vendor/react-dom.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/react-dom/umd/react-dom.production.min.js')));
app.get('/vendor/material-ui.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/@mui/material/umd/material-ui.production.min.js')));
app.get('/vendor/emotion-react.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/@emotion/react/dist/emotion-react.umd.min.js')));
app.get('/vendor/emotion-styled.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/@emotion/styled/dist/emotion-styled.umd.min.js')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', landingRouter);
app.use('/index', indexRouter);
app.use('/users', usersRouter);
var authLimiter = rateLimitEnabled
  ? rateLimit({
      windowMs: rateWindowMs,
      limit: rateLimitCount,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { success: false, message: 'Too many authentication attempts; try again later' }
    })
  // 限流关闭时使用透传函数，保持后续中间件链不受影响。
  : function (req, res, next) { next(); };
// 登录页面 GET 不限流，只对 POST（提交登录）限制
app.use('/login', function(req, res, next) {
  if (req.method === 'POST' && authLimiter) return authLimiter(req, res, next);
  next();
}, loginRouter);
app.use('/auth/login', authLimiter);
app.use('/auth/2fa/verify', authLimiter);
app.use('/auth/password/forgot', authLimiter);
app.use('/auth/password/reset', authLimiter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/module-admin', security.requirePlatformAdmin, moduleAdminRouter);
app.use('/staff-admin', security.requirePlatformAdmin, staffAdminRouter);
app.use('/user-admin', security.requirePlatformAdmin, userAdminRouter);
app.use('/organize-admin', security.requirePlatformAdmin, organizeAdminRouter);
app.use('/role-admin', security.requirePlatformAdmin, roleAdminRouter);
app.use('/role-permission-admin', security.requirePlatformAdmin, rolePermissionAdminRouter);
app.use('/post-admin', security.requirePlatformAdmin, postAdminRouter);
app.use('/user-permission', security.requirePlatformAdmin, userPermissionAdminRouter);
app.use('/permission-item-admin', security.requirePlatformAdmin, permissionItemAdminRouter);
app.use('/sequence-admin', security.requirePlatformAdmin, sequenceAdminRouter);
app.use('/table-field-admin', security.requirePlatformAdmin, tableFieldAdminRouter);
app.use('/sys-config-admin', security.requirePlatformAdmin, sysConfigAdminRouter);
app.use('/parameter-admin', security.requirePlatformAdmin, parameterAdminRouter);
app.use('/log-admin', security.requirePlatformAdmin, logAdminRouter);
app.use('/exception-admin', security.requirePlatformAdmin, exceptionAdminRouter);
app.use('/data-item-admin', security.requirePlatformAdmin, dataItemAdminRouter);
app.use('/message-admin', security.requirePlatformAdmin, messageAdminRouter);
app.use('/socket', socketRouter);
app.use('/realtime-admin', realtimeAdminRouter);
app.use('/relay-admin', relayAdminRouter);
app.use('/', managementPlatformRouter);
// 企业注册/邮箱验证 + 平台超管控制台（统一 SaaS 平台，始终加载）。
app.use('/', saasOnboardingRouter);
app.use('/', platformAdminRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
