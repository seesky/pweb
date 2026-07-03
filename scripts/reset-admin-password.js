'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');
const strong =
  password.length >= 12 &&
  password.length <= 128 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password);

if (!strong) {
  console.error('ADMIN_BOOTSTRAP_PASSWORD must be 12-128 characters and contain upper/lowercase letters and a digit.');
  process.exitCode = 1;
} else {
  (async () => {
    const admin = await prisma.piuser.findFirst({
      where: { USERNAME: 'Administrator', DELETEMARK: 0 },
      select: { ID: true }
    });
    if (!admin) throw new Error('Administrator database account was not found');
    await prisma.piuserlogon.update({
      where: { ID: admin.ID },
      data: {
        USERPASSWORD: await bcrypt.hash(password, 12),
        PASSWORDERRORCOUNT: 0,
        LOCKSTARTDATE: null,
        LOCKENDDATE: null
      }
    });
    console.log('Administrator password was reset. Remove ADMIN_BOOTSTRAP_PASSWORD from the environment now.');
  })()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
