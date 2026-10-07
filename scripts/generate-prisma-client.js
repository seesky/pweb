'use strict';
// Client generation does not connect to MySQL. Prisma config nevertheless
// requires a URL before the graphical installer has created .env.
require('dotenv').config();
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, [path.join(__dirname, '../node_modules/prisma/build/index.js'), 'generate'], {
  stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'mysql://generate_only:unused@127.0.0.1:3306/generate_only' }
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === null ? 1 : result.status;
