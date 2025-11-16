var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

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

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'pweb-cookie-secret'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'pweb-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/login', loginRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/module-admin', moduleAdminRouter);
app.use('/staff-admin', staffAdminRouter);
app.use('/user-admin', userAdminRouter);
app.use('/organize-admin', organizeAdminRouter);
app.use('/role-admin', roleAdminRouter);
app.use('/role-permission-admin', rolePermissionAdminRouter);
app.use('/post-admin', postAdminRouter);
app.use('/user-permission', userPermissionAdminRouter);
app.use('/permission-item-admin', permissionItemAdminRouter);
app.use('/sequence-admin', sequenceAdminRouter);
app.use('/table-field-admin', tableFieldAdminRouter);
app.use('/sys-config-admin', sysConfigAdminRouter);
app.use('/parameter-admin', parameterAdminRouter);
app.use('/log-admin', logAdminRouter);
app.use('/exception-admin', exceptionAdminRouter);
app.use('/data-item-admin', dataItemAdminRouter);
app.use('/message-admin', messageAdminRouter);

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
