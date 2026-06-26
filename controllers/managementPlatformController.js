'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomUUID, randomBytes } = require('node:crypto');

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { platformService } = require('../services/management/platform_service');
const socketControl = require('../services/realtime/socket_control');
const { sendMail } = require('../utilities/publiclibrary/mailer');
const { SocketTokenService } = require('../services/realtime/token_service');

const prisma = new PrismaClient();
const tokenService = new SocketTokenService();
const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 邀请/设密链接 72h 有效

const featureEnabled = (req, key) => !req.features || req.features[key] !== false;
const featureUnavailable = (res, message) => res.status(404).json({ success: false, message });

const baseUrl = (req) =>
  (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.workspaces = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  res.json({
    success: true,
    data: {
      current: req.tenant || null,
      tenants: req.tenantContext?.tenants || [],
      features: req.features || {}
    }
  });
};

exports.selectWorkspace = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const tenantId = String(req.body?.tenantId || '').trim();
  const tenants = req.tenantContext?.tenants || [];
  const tenant = tenants.find((item) => item.id === tenantId);
  if (!tenant) {
    return res.status(403).json({ success: false, message: 'Workspace is not available for this account' });
  }
  if (tenant.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Workspace is not active' });
  }
  if (req.session) {
    req.session.activeTenantId = tenant.id;
  }
  res.json({ success: true, data: { current: tenant } });
};

const ensureUser = (req, res) => {
  const user = req.currentUser || CommonUtils.getCurrent(res, req);
  if (!user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return null;
  }
  return user;
};

const ensureAdmin = (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return null;
  // 租户管理员（平台超管 / 个人版本人 / 企业 owner·admin）由 resolveTenant 中间件判定。
  // 兼容直接调用（无中间件）时回退到平台超管判断。
  const ok = req.isTenantAdmin !== undefined
    ? req.isTenantAdmin
    : (user.Id === 'Administrator' || user.IsAdministrator);
  if (!ok) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }
  return user;
};

exports.devices = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listDevices(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.devices]', error);
    res.status(500).json({ success: false, message: 'Failed to load devices' });
  }
};

exports.updateDevice = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const device = await platformService.forTenant(req.tenantId).updateDevice(req.params.id, req.body || {}, user);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'device',
      action: 'update_device',
      target: device.terminalId,
      ip: req.ip,
      detail: req.body || {}
    });
    res.json({ success: true, data: device });
  } catch (error) {
    console.error('[ManagementPlatform.updateDevice]', error);
    res.status(500).json({ success: false, message: 'Failed to update device' });
  }
};

exports.deviceDetail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).getDeviceDetail(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.deviceDetail]', error);
    res.status(500).json({ success: false, message: 'Failed to load device detail' });
  }
};

exports.deleteDevice = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    await platformService.forTenant(req.tenantId).deleteDevice(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'device',
      action: 'delete_device',
      target: req.params.id,
      ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.deleteDevice]', error);
    res.status(500).json({ success: false, message: 'Failed to delete device' });
  }
};

exports.disconnectSession = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const result = await socketControl.forceDisconnectSession(req.params.id);
    if (!result.ok) {
      const messages = {
        NOT_FOUND: '会话不存在',
        NOT_ACTIVE: '会话不在进行中',
        SOCKET_UNAVAILABLE: '信令服务不可用'
      };
      const status = result.reason === 'NOT_FOUND' ? 404 : result.reason === 'SOCKET_UNAVAILABLE' ? 503 : 400;
      return res.status(status).json({ success: false, message: messages[result.reason] || '断开失败' });
    }
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'session',
      action: 'force_disconnect',
      target: req.params.id,
      ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.disconnectSession]', error);
    res.status(500).json({ success: false, message: 'Failed to disconnect session' });
  }
};

exports.sessionEvents = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).getSessionEvents(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.sessionEvents]', error);
    res.status(500).json({ success: false, message: 'Failed to load session events' });
  }
};

exports.groups = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'deviceGroups')) {
      return res.json({ success: true, data: [] });
    }
    const data = await platformService.forTenant(req.tenantId).listGroups();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.groups]', error);
    res.status(500).json({ success: false, message: 'Failed to load device groups' });
  }
};

exports.createGroup = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!featureEnabled(req, 'deviceGroups')) {
    return featureUnavailable(res, 'Device groups are not available in this workspace');
  }
  if (!req.body?.name) {
    return res.status(400).json({ success: false, message: 'Missing group name' });
  }
  try {
    const group = await platformService.forTenant(req.tenantId).createGroup(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'device',
      action: 'create_device_group',
      target: group?.name,
      ip: req.ip
    });
    res.json({ success: true, data: group });
  } catch (error) {
    console.error('[ManagementPlatform.createGroup]', error);
    res.status(500).json({ success: false, message: 'Failed to create device group' });
  }
};

exports.updateGroup = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'deviceGroups')) {
      return featureUnavailable(res, 'Device groups are not available in this workspace');
    }
    const group = await platformService.forTenant(req.tenantId).updateGroup(req.params.id, req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'device',
      action: 'update_device_group',
      target: group?.name || req.params.id,
      ip: req.ip,
      detail: req.body || {}
    });
    res.json({ success: true, data: group });
  } catch (error) {
    console.error('[ManagementPlatform.updateGroup]', error);
    res.status(500).json({ success: false, message: 'Failed to update device group' });
  }
};

exports.policies = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listPolicies();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.policies]', error);
    res.status(500).json({ success: false, message: 'Failed to load device policies' });
  }
};

exports.createDevicePolicy = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!req.body?.name) {
    return res.status(400).json({ success: false, message: 'Missing policy name' });
  }
  try {
    const policy = await platformService.forTenant(req.tenantId).createPolicy(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'policy',
      action: 'create_device_policy', target: policy?.name, ip: req.ip, detail: req.body || {}
    });
    res.json({ success: true, data: policy });
  } catch (error) {
    console.error('[ManagementPlatform.createDevicePolicy]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to create device policy' });
  }
};

exports.updateDevicePolicy = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const policy = await platformService.forTenant(req.tenantId).updatePolicy(req.params.id, req.body || {}, user);
    if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'policy',
      action: 'update_device_policy', target: policy?.name, ip: req.ip, detail: req.body || {}
    });
    res.json({ success: true, data: policy });
  } catch (error) {
    console.error('[ManagementPlatform.updateDevicePolicy]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to update device policy' });
  }
};

exports.deleteDevicePolicy = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    await platformService.forTenant(req.tenantId).deletePolicy(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'policy',
      action: 'delete_device_policy', target: req.params.id, ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.deleteDevicePolicy]', error);
    const status = error.code === 'BUILTIN_POLICY' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to delete device policy' });
  }
};

exports.enrollmentTokens = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'enrollmentTokens')) {
      return res.json({ success: true, data: [] });
    }
    const data = await platformService.forTenant(req.tenantId).listEnrollmentTokens();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.enrollmentTokens]', error);
    res.status(500).json({ success: false, message: 'Failed to load enrollment tokens' });
  }
};

exports.revokeEnrollmentToken = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'enrollmentTokens')) {
      return featureUnavailable(res, 'Enrollment tokens are not available in this workspace');
    }
    await platformService.forTenant(req.tenantId).revokeEnrollmentToken(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'device',
      action: 'revoke_enrollment_token',
      target: req.params.id,
      ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.revokeEnrollmentToken]', error);
    res.status(500).json({ success: false, message: 'Failed to revoke enrollment token' });
  }
};

exports.createEnrollmentToken = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'enrollmentTokens')) {
      return featureUnavailable(res, 'Enrollment tokens are not available in this workspace');
    }
    const token = await platformService.forTenant(req.tenantId).createEnrollmentToken(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'device',
      action: 'create_enrollment_token',
      target: token?.id,
      ip: req.ip,
      detail: { groupId: token?.groupId, maxUses: token?.maxUses }
    });
    res.json({ success: true, data: token });
  } catch (error) {
    console.error('[ManagementPlatform.createEnrollmentToken]', error);
    res.status(500).json({ success: false, message: 'Failed to create enrollment token' });
  }
};

// 设备 enroll（不经登录；租户由 token 推导）。返回设备 token 供被控主机无人值守上线。
exports.enrollDevice = async (req, res) => {
  try {
    // 该路由不过 resolveTenant，租户由 enrollDevice 内部按 token 的 TENANTID 权威绑定。
    const device = await platformService.enrollDevice({
      ...req.body,
      ip: req.body?.ip || req.ip
    });
    // 设备身份 token：client-service 用它连信令，无需任何用户登录。
    const deviceToken = tokenService.issueDeviceToken(device.id, device.terminalId, device.tenantId);
    await platformService.forTenant(device.tenantId).writeAudit({
      actorId: device.ownerUserId,
      category: 'device',
      action: 'enroll_device',
      target: device.terminalId,
      ip: req.ip,
      detail: { os: device.os, clientVersion: device.clientVersion }
    });
    res.json({ success: true, data: device, deviceToken });
  } catch (error) {
    console.error('[ManagementPlatform.enrollDevice]', error);
    const status = ['INVALID_REQUEST', 'INVALID_TOKEN', 'EXPIRED_TOKEN', 'TOKEN_EXHAUSTED', 'QUOTA_EXCEEDED'].includes(error.code) ? 400 : 500;
    res.status(status).json({ success: false, code: error.code || 'ENROLL_FAILED', message: error.message || 'Enroll failed' });
  }
};

exports.profiles = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listProfiles();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.profiles]', error);
    res.status(500).json({ success: false, message: 'Failed to load permission profiles' });
  }
};

exports.createProfile = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!req.body?.name) {
    return res.status(400).json({ success: false, message: 'Missing profile name' });
  }
  try {
    const profile = await platformService.forTenant(req.tenantId).createProfile(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'profile',
      action: 'create_permission_profile',
      target: profile?.name,
      ip: req.ip,
      detail: req.body || {}
    });
    res.json({ success: true, data: profile });
  } catch (error) {
    console.error('[ManagementPlatform.createProfile]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to create permission profile' });
  }
};

exports.updateProfile = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const profile = await platformService.forTenant(req.tenantId).updateProfile(req.params.id, req.body || {}, user);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'profile',
      action: 'update_permission_profile',
      target: profile?.name,
      ip: req.ip,
      detail: req.body || {}
    });
    res.json({ success: true, data: profile });
  } catch (error) {
    console.error('[ManagementPlatform.updateProfile]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to update permission profile' });
  }
};

exports.deleteProfile = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    await platformService.forTenant(req.tenantId).deleteProfile(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'profile',
      action: 'delete_permission_profile',
      target: req.params.id,
      ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.deleteProfile]', error);
    const status = error.code === 'BUILTIN_PROFILE' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to delete permission profile' });
  }
};

exports.users = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listUsers(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.users]', error);
    res.status(500).json({ success: false, message: 'Failed to load users' });
  }
};

exports.assignments = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'assignments')) {
      return res.json({ success: true, data: [] });
    }
    const data = await platformService.forTenant(req.tenantId).listAssignments();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.assignments]', error);
    res.status(500).json({ success: false, message: 'Failed to load device assignments' });
  }
};

exports.createAssignment = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!featureEnabled(req, 'assignments')) {
    return featureUnavailable(res, 'Access assignments are not available in this workspace');
  }
  if (!req.body?.subjectId || !req.body?.targetId) {
    return res.status(400).json({ success: false, message: 'Missing subjectId or targetId' });
  }
  try {
    const assignment = await platformService.forTenant(req.tenantId).createAssignment(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'authz',
      action: 'create_assignment',
      target: assignment?.targetId,
      ip: req.ip,
      detail: req.body || {}
    });
    res.json({ success: true, data: assignment });
  } catch (error) {
    console.error('[ManagementPlatform.createAssignment]', error);
    res.status(500).json({ success: false, message: 'Failed to create device assignment' });
  }
};

exports.revokeAssignment = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    if (!featureEnabled(req, 'assignments')) {
      return featureUnavailable(res, 'Access assignments are not available in this workspace');
    }
    await platformService.forTenant(req.tenantId).revokeAssignment(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'authz',
      action: 'revoke_assignment',
      target: req.params.id,
      ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.revokeAssignment]', error);
    res.status(500).json({ success: false, message: 'Failed to revoke device assignment' });
  }
};

exports.tickets = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listTickets(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.tickets]', error);
    res.status(500).json({ success: false, message: 'Failed to load tickets' });
  }
};

exports.ticketDetail = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).getTicket(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Ticket not found' });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.ticketDetail]', error);
    res.status(500).json({ success: false, message: 'Failed to load ticket' });
  }
};

exports.createTicket = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  if (!req.body?.title) {
    return res.status(400).json({ success: false, message: 'Missing title' });
  }
  try {
    const ticket = await platformService.forTenant(req.tenantId).createTicket(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'ticket',
      action: 'create_ticket', target: ticket?.title, ip: req.ip
    });
    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[ManagementPlatform.createTicket]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to create ticket' });
  }
};

exports.updateTicket = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const ticket = await platformService.forTenant(req.tenantId).updateTicket(req.params.id, req.body || {}, user);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'ticket',
      action: 'update_ticket', target: ticket?.title, ip: req.ip, detail: req.body || {}
    });
    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[ManagementPlatform.updateTicket]', error);
    res.status(500).json({ success: false, message: 'Failed to update ticket' });
  }
};

exports.addTicketComment = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  if (!req.body?.body) {
    return res.status(400).json({ success: false, message: 'Missing comment body' });
  }
  try {
    const ticket = await platformService.forTenant(req.tenantId).addTicketComment(req.params.id, req.body.body, user);
    res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[ManagementPlatform.addTicketComment]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to add comment' });
  }
};

exports.clientBuilds = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listClientBuilds();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.clientBuilds]', error);
    res.status(500).json({ success: false, message: 'Failed to load client builds' });
  }
};

exports.createClientBuild = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!req.body?.version) {
    return res.status(400).json({ success: false, message: 'Missing version' });
  }
  try {
    const build = await platformService.forTenant(req.tenantId).createClientBuild(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'deploy',
      action: 'publish_client_build', target: build?.version, ip: req.ip, detail: { channel: build?.channel }
    });
    res.json({ success: true, data: build });
  } catch (error) {
    console.error('[ManagementPlatform.createClientBuild]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to publish client build' });
  }
};

exports.updateClientBuild = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const build = await platformService.forTenant(req.tenantId).updateClientBuild(req.params.id, req.body || {}, user);
    if (!build) return res.status(404).json({ success: false, message: 'Build not found' });
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'deploy',
      action: 'update_client_build', target: build?.version, ip: req.ip, detail: { channel: build?.channel }
    });
    res.json({ success: true, data: build });
  } catch (error) {
    console.error('[ManagementPlatform.updateClientBuild]', error);
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to update client build' });
  }
};

exports.deleteClientBuild = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    await platformService.forTenant(req.tenantId).deleteClientBuild(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'deploy',
      action: 'delete_client_build', target: req.params.id, ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.deleteClientBuild]', error);
    res.status(500).json({ success: false, message: 'Failed to delete client build' });
  }
};

exports.members = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listMembers();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.members]', error);
    res.status(500).json({ success: false, message: 'Failed to load members' });
  }
};

exports.createMember = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!req.body?.userId) {
    return res.status(400).json({ success: false, message: 'Missing userId' });
  }
  try {
    const member = await platformService.forTenant(req.tenantId).addMember(req.body || {}, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'member',
      action: 'add_member',
      target: member?.userId,
      ip: req.ip,
      detail: { role: member?.role }
    });
    res.json({ success: true, data: member });
  } catch (error) {
    console.error('[ManagementPlatform.createMember]', error);
    if (error.code === 'QUOTA_EXCEEDED') {
      return res.status(409).json({ success: false, code: 'QUOTA_EXCEEDED', message: '成员数量已达企业配额上限' });
    }
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to add member' });
  }
};

exports.updateMember = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const member = await platformService.forTenant(req.tenantId).updateMember(req.params.id, req.body || {}, user);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'member',
      action: 'update_member',
      target: member?.userId,
      ip: req.ip,
      detail: req.body || {}
    });
    res.json({ success: true, data: member });
  } catch (error) {
    console.error('[ManagementPlatform.updateMember]', error);
    res.status(500).json({ success: false, message: 'Failed to update member' });
  }
};

exports.removeMember = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    await platformService.forTenant(req.tenantId).removeMember(req.params.id, user);
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id,
      actorName: user.RealName,
      category: 'member',
      action: 'remove_member',
      target: req.params.id,
      ip: req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[ManagementPlatform.removeMember]', error);
    res.status(500).json({ success: false, message: 'Failed to remove member' });
  }
};

// 按邮箱邀请成员：已有账号直接加入（受「一账号一企业」约束）；
// 未注册邮箱则创建账号并发「设置密码」邀请邮件，接受后即可登录。
exports.inviteMember = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!featureEnabled(req, 'members')) {
    return featureUnavailable(res, 'Members are not available in this workspace');
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || 'member');
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
  }
  const svc = platformService.forTenant(req.tenantId);
  try {
    let target = await prisma.piuser.findFirst({ where: { EMAIL: email, DELETEMARK: 0 } });
    let invited = false;
    let inviteToken = null;

    if (target) {
      // 「一个账号只属于一个企业」：已属其它企业则拒绝。
      const other = await svc.getUserOtherEnterpriseTenantId(target.ID, req.tenantId);
      if (other) {
        return res.status(409).json({ success: false, code: 'ALREADY_IN_ENTERPRISE', message: `该账号已属于其它企业（${other.name}），无法加入` });
      }
    } else {
      // 新账号：建未验证 piuser + 随机密码 logon + 设密令牌。
      invited = true;
      inviteToken = randomBytes(24).toString('hex');
      const userId = randomUUID();
      const now = new Date();
      const audit = {
        CREATEON: now, CREATEUSERID: user.Id || 'SYSTEM', CREATEBY: user.RealName || 'SYSTEM',
        MODIFIEDON: now, MODIFIEDUSERID: user.Id || 'SYSTEM', MODIFIEDBY: user.RealName || 'SYSTEM'
      };
      await prisma.piuser.create({
        data: {
          ID: userId, USERNAME: email, REALNAME: email.split('@')[0], EMAIL: email,
          ENABLED: 1, DELETEMARK: 0, EMAILVERIFIED: false,
          PASSWORDRESETTOKEN: inviteToken, PASSWORDRESETEXPIRES: new Date(Date.now() + INVITE_TTL_MS),
          ...audit
        }
      });
      await prisma.piuserlogon.create({
        data: { ID: userId, USERPASSWORD: await bcrypt.hash(randomBytes(18).toString('hex'), 10), PASSWORDERRORCOUNT: 0, IS2FAENABLED: false, ...audit }
      });
      target = { ID: userId };
    }

    const member = await svc.addMember({ userId: target.ID, role }, user);
    await svc.writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'member',
      action: invited ? 'invite_member' : 'add_member', target: email, ip: req.ip, detail: { role, invited }
    });

    let inviteUrl;
    if (invited) {
      inviteUrl = `${baseUrl(req)}/set-password?token=${inviteToken}`;
      const tenantName = (req.tenant && req.tenant.name) || '企业空间';
      const mailResult = await sendMail({
        to: email,
        subject: `邀请加入 ${tenantName}（Poleis）`,
        text: `您被邀请加入 Poleis 企业空间「${tenantName}」。\n请点击以下链接设置登录密码（72 小时内有效）：\n${inviteUrl}`,
        html: `<p>您被邀请加入 Poleis 企业空间「<b>${tenantName}</b>」。</p>` +
              `<p>请点击以下链接设置登录密码（72 小时内有效）：</p><p><a href="${inviteUrl}">${inviteUrl}</a></p>`
      }).catch((err) => { console.error('[invite] sendMail failed', err); return { sent: false }; });
      // 未配置 SMTP 的开发态把链接回传，便于自测。
      if (!(mailResult && mailResult.dev)) inviteUrl = undefined;
    }

    res.json({ success: true, data: member, invited, inviteUrl });
  } catch (error) {
    console.error('[ManagementPlatform.inviteMember]', error);
    if (error.code === 'QUOTA_EXCEEDED') {
      return res.status(409).json({ success: false, code: 'QUOTA_EXCEEDED', message: '成员数量已达企业配额上限' });
    }
    res.status(500).json({ success: false, message: error.message || '邀请成员失败' });
  }
};

// 当前 workspace 信息 + 用量（企业设置页）。
exports.tenantInfo = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const usage = await platformService.getTenantUsage(req.tenantId);
    res.json({ success: true, data: { tenant: req.tenant, usage, isTenantAdmin: !!req.isTenantAdmin } });
  } catch (error) {
    console.error('[ManagementPlatform.tenantInfo]', error);
    res.status(500).json({ success: false, message: 'Failed to load workspace info' });
  }
};

// 重命名当前 workspace（仅租户管理员；配额由平台超管控制，此处不可改）。
exports.updateTenantInfo = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: '名称不能为空' });
  try {
    const tenant = await platformService.updateTenant(req.tenantId, { name });
    await platformService.forTenant(req.tenantId).writeAudit({
      actorId: user.Id, actorName: user.RealName, category: 'admin',
      action: 'rename_tenant', target: name, ip: req.ip
    });
    res.json({ success: true, data: tenant });
  } catch (error) {
    console.error('[ManagementPlatform.updateTenantInfo]', error);
    res.status(500).json({ success: false, message: 'Failed to update workspace' });
  }
};

exports.networkOverview = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).getNetworkOverview();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.networkOverview]', error);
    res.status(500).json({ success: false, message: 'Failed to load network overview' });
  }
};

exports.sessions = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listSessions(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.sessions]', error);
    res.status(500).json({ success: false, message: 'Failed to load sessions' });
  }
};

exports.auditLogs = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const data = await platformService.forTenant(req.tenantId).listAuditLogs(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.auditLogs]', error);
    res.status(500).json({ success: false, message: 'Failed to load audit logs' });
  }
};
