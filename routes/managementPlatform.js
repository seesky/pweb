'use strict';

const express = require('express');
const router = express.Router();

const CommonUtils = require('../utilities/publiclibrary/common_utils');
const controller = require('../controllers/managementPlatformController');

const ensureAuthenticated = (req, res, next) => {
  const current = CommonUtils.getCurrent(res, req);
  if (!current) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  req.currentUser = current;
  return next();
};

router.post('/api/devices/enroll', controller.enrollDevice);

router.use('/management-platform', ensureAuthenticated);
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
router.get('/management-platform/members', controller.members);
router.post('/management-platform/members', controller.createMember);
router.patch('/management-platform/members/:id', controller.updateMember);
router.delete('/management-platform/members/:id', controller.removeMember);
router.get('/management-platform/network-overview', controller.networkOverview);
router.get('/management-platform/sessions', controller.sessions);
router.get('/management-platform/sessions/:id/events', controller.sessionEvents);
router.post('/management-platform/sessions/:id/disconnect', controller.disconnectSession);
router.get('/management-platform/audit-logs', controller.auditLogs);

module.exports = router;
