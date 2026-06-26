'use strict';

// 平台超管：跨租户管理所有企业（审批/停用/配额/用量）。
// 仅平台超级管理员（Administrator / IsAdministrator）可用，不走租户作用域。
const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { platformService } = require('../services/management/platform_service');

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
