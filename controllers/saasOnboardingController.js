'use strict';

// SaaS 企业开通：申请企业账号 → 邮箱验证激活 → 租户进入 active。
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID, randomBytes } = require('node:crypto');

const { platformService } = require('../services/management/platform_service');
const { sendMail } = require('../utilities/publiclibrary/mailer');

const prisma = new PrismaClient();
const SYSTEM_ACTOR = { Id: 'SYSTEM', RealName: 'SYSTEM' };
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const baseUrl = (req) =>
  (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

// GET /saas/register  渲染企业账号申请页
exports.registerPage = (req, res) => {
  return res.render('saasRegister', { title: '申请企业账号' });
};

// GET /set-password?token=...  成员邀请 / 找回密码：设置登录密码页
exports.setPasswordPage = (req, res) => {
  return res.render('setPassword', { title: '设置密码', token: String(req.query.token || '') });
};

// POST /saas/register  申请企业账号
exports.register = async (req, res) => {
  const { companyName, username, email, password } = req.body || {};
  if (!companyName || !username || !email || !password) {
    return res.status(400).json({ success: false, message: '企业名称、用户名、邮箱、密码必填' });
  }
  try {
    const existing = await prisma.piuser.findFirst({
      where: { OR: [{ USERNAME: username }, { EMAIL: email }] }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: '用户名或邮箱已存在' });
    }

    const now = new Date();
    const userId = randomUUID();
    const pwdHash = await bcrypt.hash(password, 10);
    const verifyToken = randomBytes(24).toString('hex');
    const verifyExpires = new Date(Date.now() + VERIFY_TTL_MS);
    const audit = {
      CREATEON: now, CREATEUSERID: 'SYSTEM', CREATEBY: 'SYSTEM',
      MODIFIEDON: now, MODIFIEDUSERID: 'SYSTEM', MODIFIEDBY: 'SYSTEM'
    };

    // 1) 企业管理员账号（邮箱未验证）
    await prisma.piuser.create({
      data: {
        ID: userId, USERNAME: username, REALNAME: username, EMAIL: email,
        ENABLED: 1, DELETEMARK: 0, EMAILVERIFIED: false,
        PASSWORDRESETTOKEN: verifyToken, PASSWORDRESETEXPIRES: verifyExpires,
        ...audit
      }
    });
    await prisma.piuserlogon.create({
      data: { ID: userId, USERPASSWORD: pwdHash, PASSWORDERRORCOUNT: 0, IS2FAENABLED: false, ...audit }
    });

    // 2) 企业租户（pending）+ 预置内置模板/策略 + owner 成员
    const tenant = await platformService.createTenant({
      name: companyName, edition: 'enterprise', ownerUserId: userId, status: 'pending'
    });
    await platformService.seedTenantDefaults(tenant.id);
    await platformService.forTenant(tenant.id).addMember({ userId, role: 'owner' }, SYSTEM_ACTOR);

    // 3) 验证邮件
    const link = `${baseUrl(req)}/saas/verify?token=${verifyToken}`;
    const mailResult = await sendMail({
      to: email,
      subject: 'Poleis 企业账号邮箱验证',
      text: `欢迎注册 Poleis 企业版（${companyName}）。\n请点击以下链接完成邮箱验证并激活企业空间（24 小时内有效）：\n${link}`,
      html: `<p>欢迎注册 Poleis 企业版（<b>${companyName}</b>）。</p>` +
            `<p>请点击以下链接完成邮箱验证并激活企业空间（24 小时内有效）：</p>` +
            `<p><a href="${link}">${link}</a></p>`
    }).catch((err) => { console.error('[saas.register] sendMail failed', err); return { sent: false }; });

    return res.json({
      success: true,
      message: '企业账号已创建，请前往邮箱完成验证后登录',
      // 开发态（未配置 SMTP）把链接回传，便于自测；生产配置 SMTP 后不应依赖此字段。
      verifyUrl: mailResult && mailResult.dev ? link : undefined
    });
  } catch (error) {
    console.error('[saas.register]', error);
    return res.status(500).json({ success: false, message: '注册失败，请稍后重试' });
  }
};

// GET /saas/verify?token=...  邮箱验证 → 激活租户
exports.verify = async (req, res) => {
  const token = String(req.query.token || '');
  const fail = (msg) => res.status(400).send(`<meta charset="utf-8"><h3>${msg}</h3><p><a href="/login">前往登录</a></p>`);
  if (!token) return fail('缺少验证令牌');
  try {
    const user = await prisma.piuser.findFirst({
      where: { PASSWORDRESETTOKEN: token, DELETEMARK: 0 }
    });
    if (!user) return fail('验证链接无效');
    if (user.PASSWORDRESETEXPIRES && new Date(user.PASSWORDRESETEXPIRES).getTime() < Date.now()) {
      return fail('验证链接已过期，请重新注册或申请重发');
    }

    await prisma.piuser.update({
      where: { ID: user.ID },
      data: { EMAILVERIFIED: true, PASSWORDRESETTOKEN: null, PASSWORDRESETEXPIRES: null, MODIFIEDON: new Date() }
    });

    // 激活该用户所属企业租户
    const tenantId = await platformService.getTenantForUser(user.ID);
    if (tenantId) await platformService.setTenantStatus(tenantId, 'active');

    return res.send(
      '<meta charset="utf-8"><h3>邮箱验证成功，企业空间已激活</h3>' +
      '<p>现在可以使用管理员账号登录。</p><p><a href="/login">前往登录</a></p>'
    );
  } catch (error) {
    console.error('[saas.verify]', error);
    return res.status(500).send('<meta charset="utf-8"><h3>验证失败，请稍后重试</h3>');
  }
};
