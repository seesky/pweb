'use strict';
// Read only CREATE TABLE statements. Never copy rows, DROP, or production history.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function extract(source) {
  return [...source.matchAll(/^CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=[^\n]+;/gm)]
    .map(m => ({ name: m[1], sql: m[0].replace(/ AUTO_INCREMENT=\d+/g, '') }));
}
if (require.main === module) {
  let input = process.argv[2];
  if (!input) throw new Error('Usage: node setup/extract-schema.js <mysqldump file>');
  if (fs.statSync(input).isDirectory()) input = path.join(input, path.basename(input));
  const tables = extract(fs.readFileSync(input, 'utf8'));
  if (!tables.length) throw new Error('No CREATE TABLE statements found');
  const sql = '-- Structure only; production rows and auto-increment counters excluded.\n\n' + tables.map(t => t.sql).join('\n\n') + '\n';
  fs.mkdirSync(path.join(__dirname, 'database'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'database/schema.sql'), sql);
  fs.writeFileSync(path.join(__dirname, 'database/manifest.json'), JSON.stringify({
    version: '2026-10-04.1', sha256: createHash('sha256').update(sql).digest('hex'),
    // Only migrations explicitly audited against this snapshot are covered.
    migrations: ['0_existing_database_baseline', '20260706120000_add_relay_nodes',
      '20260714180000_add_app_releases', '20260806160000_add_relay_scope'].map(name => ({
      name, checksum: createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'))).digest('hex')
    })),
    tables: tables.map(t => ({ name: t.name, columns: [...t.sql.matchAll(/^  `([^`]+)` /gm)].map(m => m[1]) }))
  }, null, 2) + '\n');
  console.log(`Extracted ${tables.length} table definitions; no rows copied.`);
}
module.exports = { extract };
