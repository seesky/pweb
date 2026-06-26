'use strict';

// 轻量邮件发送：配置了 SMTP_HOST 则用 nodemailer 真实发送；
// 否则开发态仅打印（含验证链接），不阻塞流程。
let cachedTransporter; // undefined=未初始化, false=未配置, object=transporter

function getTransporter() {
  if (cachedTransporter !== undefined) return cachedTransporter;
  const host = process.env.SMTP_HOST;
  if (!host) {
    cachedTransporter = false;
    return cachedTransporter;
  }
  try {
    const nodemailer = require('nodemailer');
    cachedTransporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: /^(1|true|yes|on)$/i.test(process.env.SMTP_SECURE || ''),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    });
  } catch (e) {
    console.error('[mailer] failed to init nodemailer:', e.message);
    cachedTransporter = false;
  }
  return cachedTransporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.info('[mailer] SMTP 未配置，邮件未发送。to=%s subject=%s', to, subject);
    console.info('[mailer] (dev) 正文:\n%s', text || html || '');
    return { sent: false, dev: true };
  }
  const from = process.env.SMTP_FROM || 'Poleis <no-reply@poleis.local>';
  await t.sendMail({ from, to, subject, html, text });
  return { sent: true };
}

module.exports = { sendMail };
