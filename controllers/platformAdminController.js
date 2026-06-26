'use strict';

// 平台超管：跨租户管理所有企业（审批/停用/配额/用量）。
// 仅平台超级管理员（Administrator / IsAdministrator）可用，不走租户作用域。
const { PrismaClient } = require('@prisma/client');
const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { platformService } = require('../services/management/platform_service');

const prisma = new PrismaClient();

const ensurePlatformAdmin = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return null;
  }
  if (user.Id !== 'Administrator' && !user.IsAdministrator) {
    res.status(403).json({ success: false, message: 'Forbidden: platform admin only' });
    return null;
  }
  return user;
};

const ALLOWED_STATUS = ['active', 'pending', 'suspended'];

exports.tenants = async (req, res) => {
  const user = ensurePlatformAdmin(req, res);
  if (!user) return;
  try {
    const data = await platformService.listTenants();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[PlatformAdmin.tenants]', error);
    res.status(500).json({ success: false, message: 'Failed to load tenants' });
  }
};

// 平台超管：新建企业并指派一个已存在账号为负责人(owner)。
// 这是「把某用户变成企业用户」的正确方式——创建独立企业租户 + 加该用户为成员，
// 而不是去改个人空间(u:)的版本（个人空间恒为 personal，改了也会被纠回）。
exports.createTenant = async (req, res) => {
  const user = ensurePlatformAdmin(req, res);
  if (!user) return;
  const name = String(req.body?.name || '').trim();
  const ownerEmail = String(req.body?.ownerEmail || '').trim().toLowerCase();
  const maxMembers = Number(req.body?.maxMembers || 0);
  const maxDevices = Number(req.body?.maxDevices || 0);
  if (!name || !ownerEmail) {
    return res.status(400).json({ success: false, message: '企业名称与负责人邮箱必填' });
  }
  try {
    const owner = await prisma.piuser.findFirst({ where: { EMAIL: ownerEmail, DELETEMARK: 0 } });
    if (!owner) {
      return res.status(404).json({ success: false, message: '找不到该邮箱对应的账号（请先让其注册个人账号）' });
    }
    // 一个账号只属于一个企业。
    const other = await platformService.getUserOtherEnterpriseTenantId(owner.ID, '');
    if (other) {
      return res.status(409).json({ success: false, code: 'ALREADY_IN_ENTERPRISE', message: `该账号已属于企业（${other.name}）` });
    }
    const tenant = await platformService.createTenant({ name, edition: 'enterprise', ownerUserId: owner.ID, status: 'active', maxMembers, maxDevices });
    await platformService.seedTenantDefaults(tenant.id);
    await platformService.forTenant(tenant.id).addMember({ userId: owner.ID, role: 'owner' }, user);
    await platformService.forTenant(tenant.id).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'admin',
      action: 'create_tenant', target: name, ip: req.ip, detail: { ownerEmail }
    });
    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('[PlatformAdmin.createTenant]', error);
    res.status(500).json({ success: false, message: '创建企业失败' });
  }
};

exports.updateTenant = async (req, res) => {
  const user = ensurePlatformAdmin(req, res);
  if (!user) return;
  try {
    const tenant = await platformService.updateTenant(req.params.id, req.body || {});
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    await platformService.forTenant(req.params.id).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'admin',
      action: 'update_tenant', target: tenant.name, ip: req.ip, detail: req.body || {}
    });
    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('[PlatformAdmin.updateTenant]', error);
    res.status(500).json({ success: false, message: 'Failed to update tenant' });
  }
};

exports.setStatus = async (req, res) => {
  const user = ensurePlatformAdmin(req, res);
  if (!user) return;
  const status = String(req.body?.status || '');
  if (!ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }
  try {
    const tenant = await platformService.setTenantStatus(req.params.id, status);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
    await platformService.forTenant(req.params.id).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'admin',
      action: 'set_tenant_status', target: tenant.name, ip: req.ip, detail: { status }
    });
    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('[PlatformAdmin.setStatus]', error);
    res.status(500).json({ success: false, message: 'Failed to set tenant status' });
  }
};
