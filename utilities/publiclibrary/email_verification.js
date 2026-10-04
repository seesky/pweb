'use strict';

// Only explicit opt-out values disable verification; unset/unknown values retain it.
const isEmailVerificationRequired = (env = process.env) =>
  !['false', '0', 'no'].includes(String(env.AUTH_EMAIL_VERIFICATION_REQUIRED ?? '').trim().toLowerCase());

const requiresEmailVerification = (user, tenants) =>
  isEmailVerificationRequired() && user.EMAILVERIFIED !== true &&
  tenants.some((tenant) => tenant.edition === 'enterprise');

// Old SaaS signups may still be pending when the deployment opts out. Activate
// only the signup owner's workspace after full authentication; never disabled tenants.
const activatePendingSignupTenants = async (user, tenants, platformService) => {
  if (isEmailVerificationRequired() || !String(user.PASSWORDRESETTOKEN || '').startsWith('verify:')) return;
  for (const tenant of tenants) {
    if (tenant.edition === 'enterprise' && tenant.status === 'pending' && tenant.ownerUserId === user.ID) {
      await platformService.setTenantStatus(tenant.id, 'active');
    }
  }
};

module.exports = { isEmailVerificationRequired, requiresEmailVerification, activatePendingSignupTenants };
