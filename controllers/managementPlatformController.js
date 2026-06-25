'use strict';

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const { platformService } = require('../services/management/platform_service');
const socketControl = require('../services/realtime/socket_control');

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
  if (user.Id !== 'Administrator' && !user.IsAdministrator) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }
  return user;
};

exports.devices = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.listDevices(req.query || {});
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
    const device = await platformService.updateDevice(req.params.id, req.body || {}, user);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    await platformService.writeAudit({
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
    const data = await platformService.getDeviceDetail(req.params.id);
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
    await platformService.deleteDevice(req.params.id, user);
    await platformService.writeAudit({
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
    await platformService.writeAudit({
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
    const data = await platformService.getSessionEvents(req.params.id);
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
    const data = await platformService.listGroups();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.groups]', error);
    res.status(500).json({ success: false, message: 'Failed to load device groups' });
  }
};

exports.createGroup = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!req.body?.name) {
    return res.status(400).json({ success: false, message: 'Missing group name' });
  }
  try {
    const group = await platformService.createGroup(req.body || {}, user);
    await platformService.writeAudit({
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
    const group = await platformService.updateGroup(req.params.id, req.body || {}, user);
    await platformService.writeAudit({
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
    const data = await platformService.listPolicies();
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
    const policy = await platformService.createPolicy(req.body || {}, user);
    await platformService.writeAudit({
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
    const policy = await platformService.updatePolicy(req.params.id, req.body || {}, user);
    if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });
    await platformService.writeAudit({
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
    await platformService.deletePolicy(req.params.id, user);
    await platformService.writeAudit({
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
    const data = await platformService.listEnrollmentTokens();
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
    await platformService.revokeEnrollmentToken(req.params.id, user);
    await platformService.writeAudit({
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
    const token = await platformService.createEnrollmentToken(req.body || {}, user);
    await platformService.writeAudit({
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

exports.enrollDevice = async (req, res) => {
  try {
    const device = await platformService.enrollDevice({
      ...req.body,
      ip: req.body?.ip || req.ip
    });
    await platformService.writeAudit({
      actorId: device.ownerUserId,
      category: 'device',
      action: 'enroll_device',
      target: device.terminalId,
      ip: req.ip,
      detail: { os: device.os, clientVersion: device.clientVersion }
    });
    res.json({ success: true, data: device });
  } catch (error) {
    console.error('[ManagementPlatform.enrollDevice]', error);
    const status = ['INVALID_REQUEST', 'INVALID_TOKEN', 'EXPIRED_TOKEN', 'TOKEN_EXHAUSTED'].includes(error.code) ? 400 : 500;
    res.status(status).json({ success: false, code: error.code || 'ENROLL_FAILED', message: error.message || 'Enroll failed' });
  }
};

exports.profiles = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.listProfiles();
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
    const profile = await platformService.createProfile(req.body || {}, user);
    await platformService.writeAudit({
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
    const profile = await platformService.updateProfile(req.params.id, req.body || {}, user);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    await platformService.writeAudit({
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
    await platformService.deleteProfile(req.params.id, user);
    await platformService.writeAudit({
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
    const data = await platformService.listUsers(req.query || {});
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
    const data = await platformService.listAssignments();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.assignments]', error);
    res.status(500).json({ success: false, message: 'Failed to load device assignments' });
  }
};

exports.createAssignment = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  if (!req.body?.subjectId || !req.body?.targetId) {
    return res.status(400).json({ success: false, message: 'Missing subjectId or targetId' });
  }
  try {
    const assignment = await platformService.createAssignment(req.body || {}, user);
    await platformService.writeAudit({
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
    await platformService.revokeAssignment(req.params.id, user);
    await platformService.writeAudit({
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
    const data = await platformService.listTickets(req.query || {});
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
    const data = await platformService.getTicket(req.params.id);
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
    const ticket = await platformService.createTicket(req.body || {}, user);
    await platformService.writeAudit({
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
    const ticket = await platformService.updateTicket(req.params.id, req.body || {}, user);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    await platformService.writeAudit({
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
    const ticket = await platformService.addTicketComment(req.params.id, req.body.body, user);
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
    const data = await platformService.listClientBuilds();
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
    const build = await platformService.createClientBuild(req.body || {}, user);
    await platformService.writeAudit({
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
    const build = await platformService.updateClientBuild(req.params.id, req.body || {}, user);
    if (!build) return res.status(404).json({ success: false, message: 'Build not found' });
    await platformService.writeAudit({
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
    await platformService.deleteClientBuild(req.params.id, user);
    await platformService.writeAudit({
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
    const data = await platformService.listMembers();
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
    const member = await platformService.addMember(req.body || {}, user);
    await platformService.writeAudit({
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
    const status = error.code === 'INVALID_REQUEST' ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || 'Failed to add member' });
  }
};

exports.updateMember = async (req, res) => {
  const user = ensureAdmin(req, res);
  if (!user) return;
  try {
    const member = await platformService.updateMember(req.params.id, req.body || {}, user);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }
    await platformService.writeAudit({
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
    await platformService.removeMember(req.params.id, user);
    await platformService.writeAudit({
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

exports.networkOverview = async (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  try {
    const data = await platformService.getNetworkOverview();
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
    const data = await platformService.listSessions(req.query || {});
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
    const data = await platformService.listAuditLogs(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ManagementPlatform.auditLogs]', error);
    res.status(500).json({ success: false, message: 'Failed to load audit logs' });
  }
};
