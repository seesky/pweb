'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { relayNodeIsVisible } = require('../services/realtime/relay_registry');

const online = { status: 'online', enabled: true };

test('global relay nodes are visible to every workspace', () => {
  assert.equal(relayNodeIsVisible({ ...online, scope: 'global', tenantId: 'default' }, {}), true);
  assert.equal(relayNodeIsVisible({ ...online, scope: 'global', tenantId: 'default' }, { tenantId: 'u:alice' }), true);
});

test('personal relay nodes are isolated by personal tenant id', () => {
  const node = { ...online, scope: 'tenant', tenantId: 'u:alice' };
  assert.equal(relayNodeIsVisible(node, { tenantId: 'u:alice' }), true);
  assert.equal(relayNodeIsVisible(node, { tenantId: 'u:bob' }), false);
});

test('enterprise clients can probe nodes from joined workspaces only', () => {
  const node = { ...online, scope: 'tenant', tenantId: 'enterprise-a' };
  assert.equal(relayNodeIsVisible(node, { tenantIds: ['u:alice', 'enterprise-a'] }), true);
  assert.equal(relayNodeIsVisible(node, { tenantIds: ['u:alice', 'enterprise-b'] }), false);
});

test('offline, draining, and disabled relay nodes are never visible', () => {
  assert.equal(relayNodeIsVisible({ ...online, scope: 'global', status: 'offline' }), false);
  assert.equal(relayNodeIsVisible({ ...online, scope: 'global', status: 'draining' }), false);
  assert.equal(relayNodeIsVisible({ ...online, scope: 'global', enabled: false }), false);
});
