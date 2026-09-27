'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { SocketTokenService } = require('../services/realtime/token_service');

const secret = 'stage-b-test-secret-with-at-least-32-characters';

test('user socket tokens preserve identity, terminal, and display profile', () => {
  const service = new SocketTokenService(secret);
  const token = service.issue('alice', 'terminal-1', 60, {
    username: 'Alice',
    email: 'alice@example.test'
  });
  const claims = service.verify(token);
  assert.equal(claims.uid, 'alice');
  assert.equal(claims.tid, 'terminal-1');
  assert.equal(claims.username, 'Alice');
  assert.equal(claims.email, 'alice@example.test');
  assert.equal(claims.iss, 'poleis-socket');
});

test('platform administration is carried only as a signed token claim', () => {
  const service = new SocketTokenService(secret);
  const token = service.issue('user-1', 'terminal-1', 60, { platformAdmin: true });
  assert.equal(service.verify(token).platformAdmin, true);
  const ordinary = service.issue('Administrator', 'terminal-2', 60);
  assert.equal(service.verify(ordinary).platformAdmin, undefined);
});

test('device socket tokens are bound to device, terminal, and tenant', () => {
  const service = new SocketTokenService(secret);
  const claims = service.verify(service.issueDeviceToken('device-1', 'terminal-1', 'enterprise-a', 60));
  assert.equal(claims.kind, 'device');
  assert.equal(claims.did, 'device-1');
  assert.equal(claims.tid, 'terminal-1');
  assert.equal(claims.tenant, 'enterprise-a');
});

test('verification rejects wrong signatures, issuers, and expired tokens', () => {
  const service = new SocketTokenService(secret);
  assert.equal(service.verify(jwt.sign({ uid: 'alice' }, 'a-different-secret-with-32-characters', {
    algorithm: 'HS256', issuer: 'poleis-socket'
  })), null);
  assert.equal(service.verify(jwt.sign({ uid: 'alice' }, secret, {
    algorithm: 'HS256', issuer: 'not-poleis'
  })), null);
  assert.equal(service.verify(jwt.sign({ uid: 'alice', exp: 1 }, secret, {
    algorithm: 'HS256', issuer: 'poleis-socket'
  })), null);
});

test('issuing tokens requires stable identities', () => {
  const service = new SocketTokenService(secret);
  assert.throws(() => service.issue('', 'terminal-1'), /userId is required/);
  assert.throws(() => service.issueDeviceToken('', 'terminal-1', 'enterprise-a'), /deviceId and terminalId/);
  assert.throws(() => service.issueDeviceToken('device-1', '', 'enterprise-a'), /deviceId and terminalId/);
});
