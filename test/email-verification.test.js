'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isEmailVerificationRequired } = require('../utilities/publiclibrary/email_verification');

function load(file, env, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, exports: module.exports, process: { env }, console, Buffer,
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === 'node:crypto') return require(name);
      throw new Error('Unexpected dependency: ' + name);
    }
  }, { filename: file });
  return module.exports;
}

function fixture(setting, options = {}) {
  const env = setting === undefined ? {} : { AUTH_EMAIL_VERIFICATION_REQUIRED: setting };
  const user = { ID: 'alice', EMAILVERIFIED: false, PASSWORDRESETTOKEN: 'verify:old-signup', ...options.user };
  const tenants = options.tenants || [{ id: 'company', edition: 'enterprise', status: 'pending', ownerUserId: 'alice' }];
  const state = { activated: [], mail: [], users: [], createdTenants: [], sessions: 0 };
  const policy = load('utilities/publiclibrary/email_verification.js', env);
  const prisma = {
    piuser: {
      findFirst: async () => options.registration ? null : user,
      create: async ({ data }) => { state.users.push(data); return data; }
    },
    piuserlogon: {
      findUnique: async () => ({ USERPASSWORD: 'hash', IS2FAENABLED: !!options.twoFactor, TWOFACTORSECRET: 'secret' }),
      update: async () => {}, create: async () => {}
    }
  };
  const platformService = {
    listTenantsForUser: async () => tenants,
    setTenantStatus: async (id, status) => state.activated.push({ id, status }),
    createTenant: async (data) => { state.createdTenants.push(data); return { id: 'new-company' }; },
    seedTenantDefaults: async () => {}, forTenant: () => ({ addMember: async () => {} })
  };
  const dependencies = {
    '@prisma/client': { PrismaClient: class { constructor() { return prisma; } } },
    bcryptjs: { compare: async () => options.passwordOK !== false, hash: async () => 'hash' },
    jsonwebtoken: { sign: () => 'temporary-token', verify: () => ({ uid: 'alice', step: '2fa' }) },
    otplib: { authenticator: { check: () => options.codeOK !== false } }, qrcode: {},
    '../utilities/publiclibrary/common_utils': { addCurrent() {}, uiStyle() {} },
    '../middleware/security': { getSecret: () => 'test-secret' },
    '../utilities/publiclibrary/net_helper': { getIpAddress: () => '127.0.0.1' },
    '../utilities/publiclibrary/user_info': class {},
    '../services/base/log_on_service': { logOnService: { convertToUserInfo: async () => ({ Id: 'alice' }) } },
    '../services/management/platform_service': { platformService },
    '../services/management/tenant_context': {},
    '../utilities/publiclibrary/mailer': { sendMail: async (mail) => { state.mail.push(mail); return { sent: true }; } },
    '../utilities/publiclibrary/email_verification': policy
  };
  const controller = load(options.registration ? 'controllers/saasOnboardingController.js' : 'controllers/authController.js', env, dependencies);
  const req = {
    body: { account: 'alice', username: 'alice', password: 'StrongPassword123', email: 'alice@example.com', companyName: 'Company', tempToken: 'token', code: '123456' },
    headers: {}, protocol: 'https', get: () => 'example.com',
    session: { regenerate(callback) { state.sessions++; callback(); }, save(callback) { callback(); } }
  };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { controller, req, res, state };
}

test('verification is enabled by default and disabled only by explicit opt-out values', () => {
  for (const value of [undefined, '', 'true', '1', 'typo']) {
    assert.equal(isEmailVerificationRequired({ AUTH_EMAIL_VERIFICATION_REQUIRED: value }), true);
  }
  for (const value of ['false', '0', 'no', ' FALSE ']) {
    assert.equal(isEmailVerificationRequired({ AUTH_EMAIL_VERIFICATION_REQUIRED: value }), false);
  }
});

for (const method of ['login', 'verify2fa']) {
  test(`${method} blocks unverified enterprise users by default`, async () => {
    const f = fixture(undefined, { twoFactor: method === 'verify2fa' });
    await f.controller[method](f.req, f.res);
    assert.equal(f.res.statusCode, 403);
    assert.equal(f.res.body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(f.state.sessions, 0);
    assert.equal(f.state.activated.length, 0);
  });
  test(`${method} allows opt-out and activates only an existing pending signup owned by the user`, async () => {
    const f = fixture('false', { twoFactor: method === 'verify2fa', tenants: [
      { id: 'signup', edition: 'enterprise', status: 'pending', ownerUserId: 'alice' },
      { id: 'disabled', edition: 'enterprise', status: 'disabled', ownerUserId: 'alice' },
      { id: 'other-owner', edition: 'enterprise', status: 'pending', ownerUserId: 'bob' }
    ] });
    await f.controller[method](f.req, f.res);
    assert.equal(f.res.body.success, true);
    assert.equal(f.state.sessions, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.activated)), [{ id: 'signup', status: 'active' }]);
  });
}

test('opt-out still enforces password and 2FA before workspace activation', async () => {
  for (const options of [{ passwordOK: false }, { twoFactor: true }, { twoFactor: true, codeOK: false }]) {
    const f = fixture('false', options);
    await f.controller[options.codeOK === false ? 'verify2fa' : 'login'](f.req, f.res);
    assert.equal(f.state.sessions, 0);
    assert.equal(f.state.activated.length, 0);
    if (options.twoFactor && options.codeOK !== false) assert.equal(f.res.body.need2fa, true);
    else assert.equal(f.res.statusCode, 401);
  }
});

test('personal users and verified enterprise users retain access with verification enabled', async () => {
  for (const options of [{ tenants: [{ edition: 'personal' }] }, { user: { EMAILVERIFIED: true } }]) {
    const f = fixture(undefined, options);
    await f.controller.login(f.req, f.res);
    assert.equal(f.res.body.success, true);
    assert.equal(f.state.activated.length, 0);
  }
});

for (const setting of [undefined, 'false']) {
  test(`SaaS registration uses the configured activation and mail policy (${setting || 'default'})`, async () => {
    const f = fixture(setting, { registration: true });
    await f.controller.register(f.req, f.res);
    assert.equal(f.res.body.success, true);
    const required = setting !== 'false';
    assert.equal(f.state.createdTenants[0].status, required ? 'pending' : 'active');
    assert.equal(f.state.mail.length, required ? 1 : 0);
    assert.equal(f.state.users[0].EMAILVERIFIED, false);
    assert.equal(!!f.state.users[0].PASSWORDRESETTOKEN, required);
    assert.match(f.res.body.message, required ? /邮箱/ : /已激活/);
  });
}
