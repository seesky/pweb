'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/managementPlatformController');
const { resolveTenantContext } = require('../services/management/tenant_context');
const { platformService } = require('../services/management/platform_service');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  req.currentUser = current;
  return next();
};

const resolveTenant = async (req, res, next) => {
  try {
    const user = req.currentUser;
    const context = await resolveTenantContext(req, user);

    req.tenantContext = context;
    req.tenantId = context?.tenantId;
    req.tenant = context?.tenant || null;
    req.tenantType = context?.tenant?.type || null;
    req.memberRole = context?.role || '';
    req.features = context?.features || {};

    if (!req.tenantId) {
      return res.status(403).json({ success: false, code: 'NO_TENANT', message: '当前账号没有可用工作区' });
    }

    if (req.tenant && req.tenant.status !== 'active') {
      return res.status(403).json({
        success: false,
        code: 'TENANT_INACTIVE',
        message: req.tenant.status === 'pending' ? '工作区待邮箱验证激活' : '工作区未激活或已停用'
      });
    }

    const isSuper = !!(user && (user.Id === 'Administrator' || user.IsAdministrator));
    if (isSuper) {
      req.isTenantAdmin = true;
    } else if (req.tenantType === 'personal') {
      // 个人空间：本人即管理员。
      req.isTenantAdmin = true;
    } else {
      // 企业空间：owner / admin 为租户管理员。
      const role = req.memberRole || await platformService.getMemberRole(req.tenantId, user && user.Id);
      req.memberRole = role || '';
      req.isTenantAdmin = (role === 'owner' || role === 'admin');
    }

    return next();
  } catch (error) {
    console.error('[ManagementPlatform.resolveTenant]', error);
    return res.status(500).json({ success: false, message: 'Failed to resolve tenant' });
  }
};

router.post('/api/devices/enroll', controller.enrollDevice);

router.use('/management-platform', ensureAuthenticated, resolveTenant);
router.get('/management-platform/workspaces', controller.workspaces);
router.post('/management-platform/workspaces/select', controller.selectWorkspace);
router.get('/management-platform/devices', controller.devices);
router.get('/management-platform/devices/:id', controller.deviceDetail);
router.patch('/management-platform/devices/:id', controller.updateDevice);
router.delete('/management-platform/devices/:id', controller.deleteDevice);
router.get('/management-platform/device-groups', controller.groups);
router.post('/management-platform/device-groups', controller.createGroup);
router.patch('/management-platform/device-groups/:id', controller.updateGroup);
router.get('/management-platform/device-policies', controller.policies);
router.post('/management-platform/device-policies', controller.createDevicePolicy);
router.patch('/management-platform/device-policies/:id', controller.updateDevicePolicy);
router.delete('/management-platform/device-policies/:id', controller.deleteDevicePolicy);
router.get('/management-platform/enrollment-tokens', controller.enrollmentTokens);
router.post('/management-platform/enrollment-tokens', controller.createEnrollmentToken);
router.delete('/management-platform/enrollment-tokens/:id', controller.revokeEnrollmentToken);
router.get('/management-platform/permission-profiles', controller.profiles);
router.post('/management-platform/permission-profiles', controller.createProfile);
router.patch('/management-platform/permission-profiles/:id', controller.updateProfile);
router.delete('/management-platform/permission-profiles/:id', controller.deleteProfile);
router.get('/management-platform/users', controller.users);
router.get('/management-platform/assignments', controller.assignments);
router.post('/management-platform/assignments', controller.createAssignment);
router.delete('/management-platform/assignments/:id', controller.revokeAssignment);
router.get('/management-platform/tickets', controller.tickets);
router.get('/management-platform/tickets/:id', controller.ticketDetail);
router.post('/management-platform/tickets', controller.createTicket);
router.patch('/management-platform/tickets/:id', controller.updateTicket);
router.post('/management-platform/tickets/:id/comments', controller.addTicketComment);
router.get('/management-platform/client-builds', controller.clientBuilds);
router.post('/management-platform/client-builds', controller.createClientBuild);
router.patch('/management-platform/client-builds/:id', controller.updateClientBuild);
router.delete('/management-platform/client-builds/:id', controller.deleteClientBuild);
router.get('/management-platform/tenant', controller.tenantInfo);
router.patch('/management-platform/tenant', controller.updateTenantInfo);
router.get('/management-platform/members', controller.members);
router.post('/management-platform/members', controller.createMember);
router.post('/management-platform/members/invite', controller.inviteMember);
router.patch('/management-platform/members/:id', controller.updateMember);
router.delete('/management-platform/members/:id', controller.removeMember);
router.get('/management-platform/network-overview', controller.networkOverview);
router.get('/management-platform/sessions', controller.sessions);
router.get('/management-platform/sessions/:id/events', controller.sessionEvents);
router.post('/management-platform/sessions/:id/disconnect', controller.disconnectSession);
router.get('/management-platform/audit-logs', controller.auditLogs);

module.exports = router;
