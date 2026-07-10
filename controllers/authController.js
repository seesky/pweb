'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID, randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { getSecret } = require('../middleware/security');
const NetHelper = require('../utilities/publiclibrary/net_helper');
const UserInfo = require('../utilities/publiclibrary/user_info');
const { logOnService } = require('../services/base/log_on_service');
const { platformService } = require('../services/management/platform_service');
const { resolveTenantId } = require('../services/management/tenant_context');

const prisma = new PrismaClient();
const JWT_SECRET = getSecret('AUTH_JWT_SECRET');
// 登录限制相关参数：均可通过 .env 调整；未配置时保留内置默认值。
// AUTH_TEMP_TOKEN_TTL_SECONDS：2FA 临时凭证有效期（秒）
// AUTH_MAX_PASSWORD_FAILURES：密码连续失败多少次后锁定账户（0 表示不按次数锁定）
// AUTH_LOCK_MINUTES：达到失败阈值后的锁定时长（分钟）
// AUTH_PASSWORD_LOCK_ENABLED：是否启用「密码失败锁定」功能（false 时既不校验已有锁定、也不新增锁定）
const envBool = (name, fallback) => {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  return v === 'false' || v === '0' || v === 'no' ? false : Boolean(v);
};
const envInt = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.trunc(v) : fallback;
};
const TEMP_TOKEN_EXPIRES_SECONDS = envInt('AUTH_TEMP_TOKEN_TTL_SECONDS', 5 * 60);
const MAX_PASSWORD_FAILURES = envInt('AUTH_MAX_PASSWORD_FAILURES', 5);
const LOCK_MINUTES = envInt('AUTH_LOCK_MINUTES', 30);
const PASSWORD_LOCK_ENABLED = envBool('AUTH_PASSWORD_LOCK_ENABLED', true);

const hashPassword = (plain) => bcrypt.hash(plain, 12);
const verifyPassword = async (plain, hashed) => {
  if (!hashed) return false;
  try {
    return await bcrypt.compare(plain, hashed);
  } catch {
    return false;
  }
};

const requestDevice = (req) => {
  const body = req.body || {};
  const terminalId = String(body.terminalId || body.terminal_id || body.deviceId || '').trim();
  if (!terminalId) return null;
  const supplied = body.deviceInfo && typeof body.deviceInfo === 'object' ? body.deviceInfo : {};
  const userAgent = String(req.headers['user-agent'] || '');
  const os = supplied.os || body.os ||
    (/android/i.test(userAgent) ? 'Android' : /(iphone|ipad|ios)/i.test(userAgent) ? 'iOS' : '');
  return {
    terminalId,
    info: {
      os: String(os || ''),
      name: String(supplied.name || supplied.hostname || body.deviceName || ''),
      clientVersion: String(supplied.clientVersion || body.clientVersion || '')
    }
  };
};

const registerLoginDevice = async (userInfo, device, req) => {
  if (!userInfo?.Id || !device?.terminalId) return;
  const tenantId = await resolveTenantId(userInfo);
  if (!tenantId) return;
  const scopedPlatform = platformService.forTenant(tenantId);
  const existing = await scopedPlatform.getDeviceByTerminal(device.terminalId);
  await scopedPlatform.upsertDeviceFromPresence({
    userId: userInfo.Id,
    terminalId: device.terminalId,
    ip: NetHelper.getIpAddress(req) || req.ip || '',
    os: device.info.os,
    deviceInfo: device.info,
    status: existing?.status === 'online' ? 'online' : 'offline'
  });
};

const buildTempToken = (userId, device = null) =>
  jwt.sign(
    { uid: userId, step: '2fa', device },
    JWT_SECRET,
    { expiresIn: TEMP_TOKEN_EXPIRES_SECONDS, algorithm: 'HS256', issuer: 'poleis-auth' }
  );

const parseTempToken = (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'poleis-auth'
    });
    return payload?.step === '2fa' ? payload : null;
  } catch {
    return null;
  }
};

const generateRecoveryCodes = async () => {
  const codes = Array.from({ length: 8 }, () =>
    randomBytes(6).toString('base64url').toUpperCase()
  );
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 8)));
  return { codes, hashes };
};

const is2faEnabled = (logon) =>
  logon &&
  (logon.IS2FAENABLED === true ||
    logon.IS2FAENABLED === 1 ||
    String(logon.IS2FAENABLED).toLowerCase() === 'true');

const passwordIsStrong = (password) =>
  typeof password === 'string' &&
  password.length >= 12 &&
  password.length <= 128 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password);

const establishSession = (req, res, userInfo) =>
  new Promise((resolve, reject) => {
    if (!req.session) return reject(new Error('Session is unavailable'));
    req.session.regenerate((error) => {
      if (error) return reject(error);
      CommonUtils.addCurrent(userInfo, res, req);
      CommonUtils.uiStyle(userInfo, res, req);
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });

const ensureCurrent = (req, res) => {
  const current = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!current) {
    res.status(401).json({ success: false, message: '未登录或会话失效' });
    return null;
  }
  return current;
};

const convertToUserInfo = async (userEntity, logonEntity) => {
  const info = await logOnService.convertToUserInfo(new UserInfo(), userEntity, logonEntity);
  return info;
};

exports.register = async (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) {
    return res.status(400).json({ success: false, message: '用户名、密码、邮箱必填' });
  }
  if (!passwordIsStrong(password)) {
    return res.status(400).json({ success: false, message: '密码至少12位，且需包含大小写字母和数字' });
  }
  try {
    const existing = await prisma.piuser.findFirst({
      where: {
        OR: [{ USERNAME: username }, { EMAIL: email }]
      }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: '用户名或邮箱已存在' });
    }
    const now = new Date();
    const userId = randomUUID();
    const pwdHash = await hashPassword(password);
    const audit = {
      CREATEON: now,
      CREATEUSERID: '26F43BC9-AE6D-42D2-BAC9-F4237A949484',
      CREATEBY: 'SYSTEM',
      MODIFIEDON: now,
      MODIFIEDUSERID: '26F43BC9-AE6D-42D2-BAC9-F4237A949484',
      MODIFIEDBY: 'SYSTEM'
    };
    const createdUser = await prisma.piuser.create({
      data: {
        ID: userId,
        USERNAME: username,
        REALNAME: username,
        EMAIL: email,
        DELETEMARK: 0,
        ENABLED: 1,
        ...audit,
        // 显式写入，避免版本差异导致缺字段
        MODIFIEDON: now,
        MODIFIEDUSERID: '26F43BC9-AE6D-42D2-BAC9-F4237A949484',
        MODIFIEDBY: 'SYSTEM'
      }
    });
    const createdLogon = await prisma.piuserlogon.create({
      data: {
        ID: userId,
        USERPASSWORD: pwdHash,
        PASSWORDERRORCOUNT: 0,
        IS2FAENABLED: false,
        ...audit,
        MODIFIEDON: now,
        MODIFIEDUSERID: '26F43BC9-AE6D-42D2-BAC9-F4237A949484',
        MODIFIEDBY: 'SYSTEM'
      }
    });

    // 默认绑定普通用户组织与角色（编码均为 User），不阻塞注册
    (async () => {
      try {
        const defaultOrg = await prisma.piorganize.findFirst({
          where: { CODE: 'User', DELETEMARK: 0 }
        });
        if (defaultOrg?.ID) {
          await prisma.piuserorganize.create({
            data: {
              ID: randomUUID(),
              USERID: userId,
              DEPARTMENTID: defaultOrg.ID,
              ENABLED: 1,
              DELETEMARK: 0,
              CREATEON: now,
              CREATEUSERID: 'SYSTEM',
              CREATEBY: 'SYSTEM',
              MODIFIEDON: now,
              MODIFIEDUSERID: 'SYSTEM',
              MODIFIEDBY: 'SYSTEM'
            }
          });
        }
      } catch (err) {
        console.error('[Auth.register] bind default organize failed', err);
      }
      try {
        const defaultRole = await prisma.pirole.findFirst({
          where: { CODE: 'User', DELETEMARK: 0 }
        });
        if (defaultRole?.ID) {
          await prisma.piuserrole.create({
            data: {
              ID: randomUUID(),
              USERID: userId,
              ROLEID: defaultRole.ID,
              ENABLED: 1,
              DELETEMARK: 0,
              CREATEON: now,
              CREATEUSERID: 'SYSTEM',
              CREATEBY: 'SYSTEM',
              MODIFIEDON: now,
              MODIFIEDUSERID: 'SYSTEM',
              MODIFIEDBY: 'SYSTEM'
            }
          });
        }
      } catch (err) {
        console.error('[Auth.register] bind default role failed', err);
      }
    })();
    // 自动登录，便于后续绑定 2FA
    const userInfo = await convertToUserInfo(createdUser, createdLogon);
    userInfo.IPAddress = NetHelper.getIpAddress(req) || req.ip || '';
    await establishSession(req, res, userInfo);
    // TODO: 可发送邮箱验证邮件，暂留空
    return res.json({ success: true, message: '注册成功，已登录，请绑定 2FA', autoLogin: true });
  } catch (error) {
    console.error('[Auth.register]', error);
    return res.status(500).json({ success: false, message: '注册失败，请稍后重试' });
  }
};

exports.login = async (req, res) => {
  const account = String(req.body?.account || '').trim();
  const password = String(req.body?.password || '');
  if (!account || !password) {
    return res.status(400).json({ success: false, message: '请输入账户和密码' });
  }
  try {
    const user = await prisma.piuser.findFirst({
      where: {
        DELETEMARK: 0,
        ENABLED: 1,
        OR: [{ USERNAME: account }, { EMAIL: account }]
      }
    });
    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const logon = await prisma.piuserlogon.findUnique({ where: { ID: user.ID } });
    if (!logon) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const now = new Date();
    if (PASSWORD_LOCK_ENABLED && logon.LOCKENDDATE && logon.LOCKENDDATE > now) {
      return res.status(423).json({ success: false, message: '账户暂时锁定，请稍后重试' });
    }
    const passed = await verifyPassword(password, logon.USERPASSWORD || '');
    if (!passed) {
      if (PASSWORD_LOCK_ENABLED && MAX_PASSWORD_FAILURES > 0) {
        const failures = (logon.PASSWORDERRORCOUNT || 0) + 1;
        const lockUntil = failures >= MAX_PASSWORD_FAILURES
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          : null;
        await prisma.piuserlogon.update({
          where: { ID: user.ID },
          data: {
            PASSWORDERRORCOUNT: failures,
            LOCKSTARTDATE: lockUntil ? now : logon.LOCKSTARTDATE,
            LOCKENDDATE: lockUntil
          }
        });
      }
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    await prisma.piuserlogon.update({
      where: { ID: user.ID },
      data: {
        PASSWORDERRORCOUNT: 0,
        LOCKSTARTDATE: null,
        LOCKENDDATE: null,
        LASTVISIT: now,
        IPADDRESS: NetHelper.getIpAddress(req) || req.ip || ''
      }
    });
    const userInfo = await convertToUserInfo(user, logon);
    userInfo.IPAddress = NetHelper.getIpAddress(req) || req.ip || '';
    const device = requestDevice(req);
    if (is2faEnabled(logon)) {
      const tempToken = buildTempToken(user.ID, device);
      return res.json({ success: true, need2fa: true, tempToken });
    }
    await establishSession(req, res, userInfo);
    await registerLoginDevice(userInfo, device, req).catch((error) =>
      console.error('[Auth.login] device registration failed', error));
    return res.json({ success: true, needSetup2fa: true, redirect: '/admin' });
  } catch (error) {
    console.error('[Auth.login]', error);
    return res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
  }
};

exports.verify2fa = async (req, res) => {
  const { tempToken, code, recoveryCode } = req.body || {};
  if (!tempToken) {
    return res.status(400).json({ success: false, message: '缺少临时凭证' });
  }
  const payload = parseTempToken(tempToken);
  if (!payload?.uid) {
    return res.status(401).json({ success: false, message: '临时凭证无效或过期' });
  }
  try {
    const userId = payload.uid;
    const logon = await prisma.piuserlogon.findUnique({ where: { ID: userId } });
    if (!is2faEnabled(logon)) {
      return res.status(400).json({ success: false, message: '2FA 未开启' });
    }
    let passed = false;
    if (code && logon.TWOFACTORSECRET) {
      passed = authenticator.check(code, logon.TWOFACTORSECRET);
    }
    if (!passed && recoveryCode && Array.isArray(logon.RECOVERYCODES)) {
      for (const h of logon.RECOVERYCODES) {
        if (await bcrypt.compare(recoveryCode, h)) {
          passed = true;
          const remain = [];
          for (const hh of logon.RECOVERYCODES) {
            const ok = await bcrypt.compare(recoveryCode, hh);
            if (!ok) remain.push(hh);
          }
          await prisma.piuserlogon.update({
            where: { ID: userId },
            data: { RECOVERYCODES: remain }
          });
          break;
        }
      }
    }
    if (!passed) {
      return res.status(401).json({ success: false, message: '2FA 验证失败' });
    }
    const user = await prisma.piuser.findUnique({ where: { ID: userId } });
    const userInfo = await convertToUserInfo(user, logon);
    userInfo.IPAddress = NetHelper.getIpAddress(req) || req.ip || '';
    await establishSession(req, res, userInfo);
    await registerLoginDevice(userInfo, payload.device, req).catch((error) =>
      console.error('[Auth.verify2fa] device registration failed', error));
    return res.json({ success: true, redirect: '/admin' });
  } catch (error) {
    console.error('[Auth.verify2fa]', error);
    return res.status(500).json({ success: false, message: '2FA 验证失败，请稍后再试' });
  }
};

exports.setup2fa = async (req, res) => {
  const current = ensureCurrent(req, res);
  if (!current) return;
  try {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(
      current.UserName || current.RealName || 'user',
      'PWeb',
      secret
    );
    const qr = await qrcode.toDataURL(otpauth);
    return res.json({ success: true, secret, otpauth, qr });
  } catch (error) {
    console.error('[Auth.setup2fa]', error);
    return res.status(500).json({ success: false, message: '生成 2FA 信息失败' });
  }
};

exports.enable2fa = async (req, res) => {
  const current = ensureCurrent(req, res);
  if (!current) return;
  const { code, secret } = req.body || {};
  if (!code || !secret) {
    return res.status(400).json({ success: false, message: '缺少验证码或密钥' });
  }
  try {
    const logon = await prisma.piuserlogon.findUnique({ where: { ID: current.Id } });
    if (!logon) {
      return res.status(404).json({ success: false, message: '账号状态异常，请重新登录后再试' });
    }
    const ok = authenticator.check(code, secret);
    if (!ok) {
      return res.status(400).json({ success: false, message: '验证码不正确' });
    }
    const { codes, hashes } = await generateRecoveryCodes();
    await prisma.piuserlogon.update({
      where: { ID: logon.ID },
      data: {
        IS2FAENABLED: true,
        TWOFACTORSECRET: secret,
        RECOVERYCODES: hashes
      }
    });
    return res.json({ success: true, message: '已开启 2FA', recoveryCodes: codes });
  } catch (error) {
    console.error('[Auth.enable2fa]', error);
    return res.status(500).json({ success: false, message: '开启 2FA 失败' });
  }
};

exports.disable2fa = async (req, res) => {
  const current = ensureCurrent(req, res);
  if (!current) return;
  const { password, code, recoveryCode } = req.body || {};
  if (!password) {
    return res.status(400).json({ success: false, message: '需要验证密码' });
  }
  try {
    const logon = await prisma.piuserlogon.findUnique({ where: { ID: current.Id } });
    if (!logon) return res.status(400).json({ success: false, message: '账号不存在' });
    const passedPwd = await verifyPassword(password, logon.USERPASSWORD || '');
    if (!passedPwd) {
      return res.status(401).json({ success: false, message: '密码错误' });
    }
    let passed2fa = false;
    if (is2faEnabled(logon) && logon.TWOFACTORSECRET && code) {
      passed2fa = authenticator.check(code, logon.TWOFACTORSECRET);
    }
    if (!passed2fa && recoveryCode && Array.isArray(logon.RECOVERYCODES)) {
      for (const h of logon.RECOVERYCODES) {
        if (await bcrypt.compare(recoveryCode, h)) {
          passed2fa = true;
          break;
        }
      }
    }
    if (!passed2fa) {
      return res.status(401).json({ success: false, message: '2FA 验证失败' });
    }
    await prisma.piuserlogon.update({
      where: { ID: current.Id },
      data: { IS2FAENABLED: 0, TWOFACTORSECRET: null, RECOVERYCODES: [] }
    });
    return res.json({ success: true, message: '已关闭 2FA' });
  } catch (error) {
    console.error('[Auth.disable2fa]', error);
    return res.status(500).json({ success: false, message: '关闭 2FA 失败' });
  }
};

// 密码/2FA 找回邮件占位：实际发信待配置 SMTP
exports.forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, message: '请输入邮箱' });
  try {
    const user = await prisma.piuser.findFirst({ where: { EMAIL: email, DELETEMARK: 0 } });
    if (!user) {
      // 防止枚举，直接返回成功
      return res.json({ success: true, message: '如果邮箱存在，将发送重置邮件' });
    }
    const token = randomUUID();
    const expires = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.piuser.update({
      where: { ID: user.ID },
      data: { PASSWORDRESETTOKEN: token, PASSWORDRESETEXPIRES: expires }
    });
    // TODO: 发送邮件
    return res.json({ success: true, message: '已发送重置邮件（占位，无实发）' });
  } catch (error) {
    console.error('[Auth.forgotPassword]', error);
    return res.status(500).json({ success: false, message: '请求失败，请稍后再试' });
  }
};

exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ success: false, message: '缺少参数' });
  }
  if (!passwordIsStrong(newPassword)) {
    return res.status(400).json({ success: false, message: '密码至少12位，且需包含大小写字母和数字' });
  }
  try {
    const user = await prisma.piuser.findFirst({
      where: {
        PASSWORDRESETTOKEN: token,
        PASSWORDRESETEXPIRES: { gte: new Date() }
      }
    });
    if (!user) {
      return res.status(400).json({ success: false, message: '重置链接无效或已过期' });
    }
    const hashed = await hashPassword(newPassword);
    await prisma.piuserlogon.update({
      where: { ID: user.ID },
      data: { USERPASSWORD: hashed }
    });
    await prisma.piuser.update({
      where: { ID: user.ID },
      // 通过邮件链接设密即视为邮箱已验证（成员邀请与找回密码共用此入口）。
      data: { PASSWORDRESETTOKEN: null, PASSWORDRESETEXPIRES: null, EMAILVERIFIED: true }
    });
    return res.json({ success: true, message: '密码已重置，请重新登录' });
  } catch (error) {
    console.error('[Auth.resetPassword]', error);
    return res.status(500).json({ success: false, message: '重置失败，请稍后再试' });
  }
};
