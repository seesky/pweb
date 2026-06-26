'use strict';

// 统一 SaaS 平台：不再区分 single/personal/saas 发布形态。
// 每个账号都有一个个人空间（tenant.type=personal）；企业用户额外拥有/加入
// 企业空间（tenant.type=enterprise）。功能差异由 features 决定，数据隔离由
// tenantId 决定，授权由 platformService.isAuthorized() 决定。
const { platformService, DEFAULT_TENANT_ID } = require('./platform_service');

const PERSONAL_FEATURES = Object.freeze({
  deviceGroups: false,
  enrollmentTokens: false,
  assignments: false,
  members: false,
  permissionProfiles: false,
  devicePolicies: false,
  auditLogs: false,
  clientBuilds: false,
  tickets: false,
  networkOverview: false
});

const ENTERPRISE_FEATURES = Object.freeze({
  deviceGroups: true,
  enrollmentTokens: true,
  assignments: true,
  members: true,
  permissionProfiles: true,
  devicePolicies: true,
  auditLogs: true,
  clientBuilds: true,
  tickets: true,
  networkOverview: true
});

function normalizeTenantType(tenant) {
  // 个人空间的恒定标识是 ID 前缀 `u:`（企业租户用随机 UUID，绝不以 u: 开头）。
  // 以此判定，避免依赖可变的 EDITION 列发生漂移导致个人空间被误判为企业。
  const id = String(tenant?.id || tenant?.ID || '');
  if (id.startsWith('u:')) return 'personal';
  const edition = String(tenant?.edition || tenant?.EDITION || '').toLowerCase();
  return edition === 'personal' ? 'personal' : 'enterprise';
}

function featuresForTenant(tenant) {
  return normalizeTenantType(tenant) === 'personal'
    ? { ...PERSONAL_FEATURES }
    : { ...ENTERPRISE_FEATURES };
}

function publicTenant(tenant, role) {
  if (!tenant) return null;
  const type = normalizeTenantType(tenant);
  return {
    id: tenant.id,
    name: tenant.name,
    type,
    edition: tenant.edition,
    status: tenant.status || 'active',
    ownerUserId: tenant.ownerUserId || '',
    role: role || tenant.role || ''
  };
}

function requestedTenantId(req) {
  return (
    req?.query?.tenantId ||
    req?.body?.tenantId ||
    req?.headers?.['x-poleis-tenant-id'] ||
    req?.session?.activeTenantId ||
    null
  );
}

async function ensureUserPersonalTenant(user) {
  if (!user) return null;
  return platformService.ensurePersonalTenant(user.Id, user.RealName || user.UserName);
}

async function listUserTenants(user) {
  if (!user) return [];
  await ensureUserPersonalTenant(user);
  return platformService.listTenantsForUser(user.Id);
}

// 解析「设备/信令归属」用的默认租户：优先个人空间。
// 个人 client 自动注册到个人空间；企业设备走 enrollment token 归属企业空间。
async function resolveTenantId(user) {
  if (!user) return null;
  const tenants = await listUserTenants(user);
  const personal = tenants.find((tenant) => normalizeTenantType(tenant) === 'personal');
  return (personal || tenants[0])?.id || null;
}

// 解析当前请求的工作区上下文：可访问租户列表 + 当前选中租户 + 能力表。
async function resolveTenantContext(req, user) {
  if (!user) return null;

  const tenants = await listUserTenants(user);
  const requested = requestedTenantId(req);
  const selected =
    (requested && tenants.find((tenant) => tenant.id === requested)) ||
    tenants.find((tenant) => normalizeTenantType(tenant) === 'personal') ||
    tenants[0] ||
    null;

  if (!selected) {
    return {
      tenantId: null,
      tenant: null,
      tenants: [],
      role: '',
      features: { ...PERSONAL_FEATURES }
    };
  }

  if (req?.session) {
    req.session.activeTenantId = selected.id;
  }

  return {
    tenantId: selected.id,
    tenant: publicTenant(selected, selected.role),
    tenants: tenants.map((tenant) => publicTenant(tenant, tenant.role)),
    role: selected.role || '',
    features: featuresForTenant(selected)
  };
}

module.exports = {
  resolveTenantId,
  resolveTenantContext,
  featuresForTenant,
  DEFAULT_TENANT_ID
};
