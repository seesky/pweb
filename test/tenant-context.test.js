'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  featuresForTenant,
  resolveTenantContext,
  resolveTenantId
} = require('../services/management/tenant_context');

const user = { Id: 'alice', RealName: 'Alice' };
const tenants = [
  { id: 'enterprise-a', name: 'A Corp', edition: 'business', role: 'member' },
  { id: 'u:alice', name: 'Alice', edition: 'business', role: 'owner' }
];

function serviceWith(visibleTenants) {
  return {
    ensured: [],
    async ensurePersonalTenant(userId, name) {
      this.ensured.push({ userId, name });
    },
    async listTenantsForUser(userId) {
      assert.equal(userId, user.Id);
      return visibleTenants;
    }
  };
}

test('device/signalling defaults to the personal workspace regardless of list order', async () => {
  const service = serviceWith(tenants);
  assert.equal(await resolveTenantId(user, service), 'u:alice');
  assert.deepEqual(service.ensured, [{ userId: 'alice', name: 'Alice' }]);
});

test('an inaccessible requested workspace cannot escape tenant membership', async () => {
  const req = {
    query: { tenantId: 'enterprise-attacker' },
    body: {},
    headers: {},
    session: {}
  };
  const context = await resolveTenantContext(req, user, serviceWith(tenants));
  assert.equal(context.tenantId, 'u:alice');
  assert.equal(req.session.activeTenantId, 'u:alice');
  assert.equal(context.tenants.some((tenant) => tenant.id === 'enterprise-attacker'), false);
});

test('an explicitly joined enterprise workspace is selected with business capabilities', async () => {
  const req = {
    query: {},
    body: {},
    headers: { 'x-poleis-tenant-id': 'enterprise-a' },
    session: {}
  };
  const context = await resolveTenantContext(req, user, serviceWith(tenants));
  assert.equal(context.tenantId, 'enterprise-a');
  assert.equal(context.role, 'member');
  assert.equal(context.features.permissionProfiles, true);
  assert.equal(context.features.auditLogs, true);
});

test('personal identity is determined by the immutable id prefix', () => {
  const features = featuresForTenant({ id: 'u:alice', edition: 'business' });
  assert.equal(features.members, false);
  assert.equal(features.auditLogs, false);
});
