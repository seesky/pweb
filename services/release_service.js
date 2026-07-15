'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const PLATFORMS = ['windows', 'android', 'macos', 'ios'];
const CHANNELS = ['stable', 'beta'];
const STORAGE_ROOT = path.resolve(process.env.RELEASE_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'releases'));
const TEMP_ROOT = path.join(STORAGE_ROOT, '.tmp');

const ensureDirectories = () => {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
};

const ensureSchema = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS poleis_app_release (
      ID VARCHAR(40) NOT NULL PRIMARY KEY,
      PLATFORM VARCHAR(20) NOT NULL,
      ARCHITECTURE VARCHAR(20) NOT NULL DEFAULT 'universal',
      CHANNEL VARCHAR(20) NOT NULL DEFAULT 'stable',
      VERSIONNAME VARCHAR(40) NOT NULL,
      VERSIONCODE INT UNSIGNED NOT NULL,
      MINSUPPORTEDVERSIONCODE INT UNSIGNED NOT NULL DEFAULT 0,
      MANDATORY TINYINT NOT NULL DEFAULT 0,
      FILENAME VARCHAR(255) NOT NULL,
      ORIGINALNAME VARCHAR(255) NOT NULL,
      MIMETYPE VARCHAR(100) NULL,
      FILESIZE BIGINT UNSIGNED NOT NULL DEFAULT 0,
      SHA256 CHAR(64) NOT NULL,
      RELEASENOTES TEXT NULL,
      PUBLISHED TINYINT NOT NULL DEFAULT 1,
      DOWNLOADCOUNT INT UNSIGNED NOT NULL DEFAULT 0,
      PUBLISHEDON DATETIME NULL,
      CREATEON DATETIME NOT NULL,
      CREATEUSERID VARCHAR(50) NULL,
      CREATEBY VARCHAR(50) NULL,
      MODIFIEDON DATETIME NOT NULL,
      MODIFIEDUSERID VARCHAR(50) NULL,
      MODIFIEDBY VARCHAR(50) NULL,
      UNIQUE KEY uq_poleis_release_version (PLATFORM, ARCHITECTURE, CHANNEL, VERSIONCODE),
      KEY idx_poleis_release_latest (PLATFORM, CHANNEL, PUBLISHED, VERSIONCODE)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

const normalizePlatform = (value) => {
  const platform = String(value || '').trim().toLowerCase();
  return PLATFORMS.includes(platform) ? platform : '';
};

const normalizeChannel = (value) => {
  const channel = String(value || '').trim().toLowerCase();
  return CHANNELS.includes(channel) ? channel : 'stable';
};

const toInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const formatRelease = (row) => ({
  id: row.ID,
  platform: row.PLATFORM,
  architecture: row.ARCHITECTURE || 'universal',
  channel: row.CHANNEL || 'stable',
  versionName: row.VERSIONNAME,
  versionCode: Number(row.VERSIONCODE || 0),
  minSupportedVersionCode: Number(row.MINSUPPORTEDVERSIONCODE || 0),
  mandatory: row.MANDATORY === 1,
  originalName: row.ORIGINALNAME,
  mimeType: row.MIMETYPE || '',
  fileSize: Number(row.FILESIZE || 0),
  sha256: row.SHA256,
  releaseNotes: row.RELEASENOTES || '',
  published: row.PUBLISHED === 1,
  downloadCount: Number(row.DOWNLOADCOUNT || 0),
  publishedOn: row.PUBLISHEDON,
  createdOn: row.CREATEON
});

const sha256File = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const extensionAllowed = (platform, originalName) => {
  const extension = path.extname(originalName || '').toLowerCase();
  const allowed = {
    windows: ['.exe', '.msi', '.zip'],
    android: ['.apk'],
    macos: ['.dmg', '.pkg', '.zip'],
    ios: ['.ipa']
  };
  return (allowed[platform] || []).includes(extension);
};

const listReleases = async () => {
  await ensureSchema();
  const rows = await prisma.$queryRawUnsafe(`
    SELECT * FROM poleis_app_release
    ORDER BY PLATFORM ASC, CHANNEL ASC, VERSIONCODE DESC
    LIMIT 1000
  `);
  return rows.map(formatRelease);
};

const getRelease = async (id) => {
  await ensureSchema();
  const rows = await prisma.$queryRawUnsafe('SELECT * FROM poleis_app_release WHERE ID = ? LIMIT 1', id);
  return rows.length ? rows[0] : null;
};

const createRelease = async (payload, file, user) => {
  await ensureSchema();
  ensureDirectories();
  const platform = normalizePlatform(payload.platform);
  if (!platform) throw Object.assign(new Error('invalid platform'), { code: 'INVALID_REQUEST' });
  if (!file || !extensionAllowed(platform, file.originalname)) {
    throw Object.assign(new Error('unsupported installer file'), { code: 'INVALID_REQUEST' });
  }
  const versionName = String(payload.versionName || '').trim();
  const versionCode = toInt(payload.versionCode, -1);
  if (!versionName || versionCode < 0) throw Object.assign(new Error('invalid version'), { code: 'INVALID_REQUEST' });

  const architecture = String(payload.architecture || 'universal').trim().toLowerCase() || 'universal';
  const channel = normalizeChannel(payload.channel);
  const id = randomUUID();
  const extension = path.extname(file.originalname).toLowerCase();
  const fileName = `${id}${extension}`;
  const platformDir = path.join(STORAGE_ROOT, platform);
  fs.mkdirSync(platformDir, { recursive: true });
  const finalPath = path.join(platformDir, fileName);
  fs.renameSync(file.path, finalPath);
  const sha256 = await sha256File(finalPath);
  const now = new Date();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO poleis_app_release
       (ID, PLATFORM, ARCHITECTURE, CHANNEL, VERSIONNAME, VERSIONCODE,
        MINSUPPORTEDVERSIONCODE, MANDATORY, FILENAME, ORIGINALNAME, MIMETYPE,
        FILESIZE, SHA256, RELEASENOTES, PUBLISHED, DOWNLOADCOUNT, PUBLISHEDON,
        CREATEON, CREATEUSERID, CREATEBY, MODIFIEDON, MODIFIEDUSERID, MODIFIEDBY)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      id, platform, architecture, channel, versionName, versionCode,
      toInt(payload.minSupportedVersionCode), payload.mandatory === 'true' || payload.mandatory === true ? 1 : 0,
      fileName, file.originalname, file.mimetype || null, file.size, sha256,
      String(payload.releaseNotes || '').trim() || null,
      payload.published === 'false' || payload.published === false ? 0 : 1,
      payload.published === 'false' || payload.published === false ? null : now,
      now, user?.Id || null, user?.RealName || null, now, user?.Id || null, user?.RealName || null
    );
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    throw error;
  }
  return formatRelease(await getRelease(id));
};

const updateRelease = async (id, payload, user) => {
  await ensureSchema();
  const existing = await getRelease(id);
  if (!existing) return null;
  const published = payload.published === undefined ? existing.PUBLISHED : payload.published ? 1 : 0;
  await prisma.$executeRawUnsafe(
    `UPDATE poleis_app_release SET VERSIONNAME = ?, VERSIONCODE = ?, MINSUPPORTEDVERSIONCODE = ?,
      MANDATORY = ?, RELEASENOTES = ?, PUBLISHED = ?, PUBLISHEDON = ?, MODIFIEDON = ?,
      MODIFIEDUSERID = ?, MODIFIEDBY = ? WHERE ID = ?`,
    String(payload.versionName || existing.VERSIONNAME).trim(),
    toInt(payload.versionCode, Number(existing.VERSIONCODE)),
    toInt(payload.minSupportedVersionCode, Number(existing.MINSUPPORTEDVERSIONCODE)),
    payload.mandatory === undefined ? existing.MANDATORY : payload.mandatory ? 1 : 0,
    payload.releaseNotes === undefined ? existing.RELEASENOTES : String(payload.releaseNotes || '').trim() || null,
    published, published ? (existing.PUBLISHEDON || new Date()) : null, new Date(),
    user?.Id || null, user?.RealName || null, id
  );
  return formatRelease(await getRelease(id));
};

const deleteRelease = async (id) => {
  const row = await getRelease(id);
  if (!row) return false;
  await prisma.$executeRawUnsafe('DELETE FROM poleis_app_release WHERE ID = ?', id);
  fs.rmSync(path.join(STORAGE_ROOT, row.PLATFORM, row.FILENAME), { force: true });
  return true;
};

const latestRelease = async ({ platform, architecture, channel }) => {
  await ensureSchema();
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) return null;
  const normalizedArchitecture = String(architecture || '').trim().toLowerCase();
  const architectureClause = normalizedArchitecture
    ? " AND (ARCHITECTURE = ? OR ARCHITECTURE = 'universal')"
    : '';
  const params = [normalizedPlatform, normalizeChannel(channel)];
  if (normalizedArchitecture) params.push(normalizedArchitecture);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM poleis_app_release
      WHERE PLATFORM = ? AND CHANNEL = ? AND PUBLISHED = 1${architectureClause}
      ORDER BY VERSIONCODE DESC, PUBLISHEDON DESC LIMIT 1`,
    ...params
  );
  return rows.length ? formatRelease(rows[0]) : null;
};

const latestDownloads = async () => {
  const result = [];
  for (const platform of PLATFORMS) {
    const release = await latestRelease({ platform, channel: 'stable' })
      || await latestRelease({ platform, channel: 'beta' });
    if (release) result.push(release);
  }
  return result;
};

const resolveFile = async (id) => {
  const row = await getRelease(id);
  if (!row || row.PUBLISHED !== 1) return null;
  const filePath = path.resolve(STORAGE_ROOT, row.PLATFORM, row.FILENAME);
  if (!filePath.startsWith(STORAGE_ROOT + path.sep) || !fs.existsSync(filePath)) return null;
  return { row, filePath };
};

const incrementDownload = (id) => prisma.$executeRawUnsafe(
  'UPDATE poleis_app_release SET DOWNLOADCOUNT = DOWNLOADCOUNT + 1 WHERE ID = ?', id
);

ensureDirectories();

module.exports = {
  PLATFORMS,
  STORAGE_ROOT,
  TEMP_ROOT,
  ensureSchema,
  listReleases,
  createRelease,
  updateRelease,
  deleteRelease,
  latestRelease,
  latestDownloads,
  resolveFile,
  incrementDownload
};
