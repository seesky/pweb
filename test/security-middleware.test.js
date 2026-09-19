'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requireAuthenticated,
  requirePlatformAdmin,
  sameOriginOnly
} = require('../middleware/security');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function request(headers = {}, overrides = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    method: 'POST',
    protocol: 'https',
    get(name) {
      return normalized[name.toLowerCase()];
    },
    ...overrides
  };
}

test('authentication middleware rejects missing identities and accepts a current user', () => {
  const rejected = responseRecorder();
  requireAuthenticated(request(), rejected, () => assert.fail('next must not run'));
  assert.equal(rejected.statusCode, 401);

  let passed = false;
  requireAuthenticated(request({}, { currentUser: { Id: 'alice' } }), responseRecorder(), () => {
    passed = true;
  });
  assert.equal(passed, true);
});

test('platform administration requires an administrator identity', () => {
  const forbidden = responseRecorder();
  requirePlatformAdmin(
    request({}, { currentUser: { Id: 'alice', IsAdministrator: false } }),
    forbidden,
    () => assert.fail('next must not run')
  );
  assert.equal(forbidden.statusCode, 403);

  for (const currentUser of [{ Id: 'Administrator' }, { Id: 'alice', IsAdministrator: true }]) {
    let passed = false;
    requirePlatformAdmin(request({}, { currentUser }), responseRecorder(), () => { passed = true; });
    assert.equal(passed, true);
  }
});

test('state-changing requests enforce same-origin while safe methods pass', () => {
  const crossSite = responseRecorder();
  sameOriginOnly(
    request({ host: 'poleis.example', origin: 'https://attacker.example' }),
    crossSite,
    () => assert.fail('next must not run')
  );
  assert.equal(crossSite.statusCode, 403);

  let sameOriginPassed = false;
  sameOriginOnly(
    request({ host: 'poleis.example', origin: 'https://poleis.example/path' }),
    responseRecorder(),
    () => { sameOriginPassed = true; }
  );
  assert.equal(sameOriginPassed, true);

  let safeMethodPassed = false;
  sameOriginOnly(request({}, { method: 'GET' }), responseRecorder(), () => { safeMethodPassed = true; });
  assert.equal(safeMethodPassed, true);
});

test('cross-site fetch metadata is rejected even when Origin is absent', () => {
  const response = responseRecorder();
  sameOriginOnly(
    request({ host: 'poleis.example', 'sec-fetch-site': 'cross-site' }),
    response,
    () => assert.fail('next must not run')
  );
  assert.equal(response.statusCode, 403);
});
