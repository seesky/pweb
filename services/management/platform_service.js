'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomBytes, randomUUID } = require('node:crypto');

const DEFAULT_TENANT_ID = process.env.POLEIS_TENANT_ID || 'default';
const DEFAULT_TENANT_NAME = process.env.POLEIS_TENANT_NAME || 'Poleis';
const DEFAULT_EDITION = process.env.POLEIS_EDITION || 'personal';

// 设备所有者（owner）默认拥有全部能力——owner 直连无需绑定模板。
const OWNER_PROFILE = Object.freeze({
  id: 'owner',
  name: 'Owner full control',
  controlInput: true,
  fileTransfer: true,
  clipboard: true,
  audio: true,
  multiMonitor: true,
  gamepad: true,
  remoteReboot: true,
  privacyScreen: false,
  recordSession: false,
  requireConfirm: false,
  idleTimeoutSec: 0
});

const ALLOWED_MEMBER_ROLES = ['owner', 'admin', 'technician', 'auditor', 'member'];

// 设备策略（客户端运行配置）默认值。policy 与 permission profile 互补：
// profile 管「一次会话允许的能力」，policy 管「设备侧客户端运行配置」。
const DEFAULT_POLICY_SETTINGS = Object.freeze({
  maxBitrateKbps: 0,        // 0 = 自动
  maxFps: 0,                // 0 = 自动
  preferTransport: 'auto',  // auto | p2p | relay
  autoUpdate: true,
  logRetentionDays: 14
});
const normalizePolicySettings = (raw = {}) => {
  const transport = ['auto', 'p2p', 'relay'].includes(raw.preferTransport) ? raw.preferTransport : 'auto';
  return {
    maxBitrateKbps: Math.max(0, Number(raw.maxBitrateKbps || 0)),
    maxFps: Math.max(0, Number(raw.maxFps || 0)),
    preferTransport: transport,
    autoUpdate: raw.autoUpdate === undefined ? true : !!raw.autoUpdate,
    logRetentionDays: Math.max(0, Number(raw.logRetentionDays || 0))
  };
};

const prisma = new PrismaClient();

const boolToInt = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return 1;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return 0;
  }
  return value ? 1 : 0;
};

const normalizeNullable = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
};

const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const safeJson = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return value;
};

const readJsonColumn = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

class PlatformService {
  constructor(client = prisma) {
    this.prisma = client;
    this.schemaReady = null;
  }

  async ensureSchema() {
    if (!this.schemaReady) {
      this.schemaReady = this.createSchema().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    return this.schemaReady;
  }

  async createSchema() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS poleis_tenant (
        ID varchar(40) NOT NULL PRIMARY KEY,
        NAME varchar(200) NOT NULL,
        EDITION varchar(20) NOT NULL DEFAULT 'personal',
        MAX_MEMBERS int NOT NULL DEFAULT 0,
        MAX_DEVICES int NOT NULL DEFAULT 0,
        BRANDING json NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_member (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        USERID varchar(40) NOT NULL,
        ROLE varchar(20) NOT NULL DEFAULT 'member',
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        UNIQUE KEY uq_poleis_member_tenant_user (TENANTID, USERID),
        KEY idx_poleis_member_user (USERID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_device_group (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        PARENTID varchar(40) NULL,
        NAME varchar(100) NOT NULL,
        POLICYID varchar(40) NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        KEY idx_poleis_device_group_tenant (TENANTID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_device (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        TERMINALID varchar(64) NOT NULL,
        OWNERUSERID varchar(40) NULL,
        GROUPID varchar(40) NULL,
        ALIAS varchar(100) NULL,
        HOSTNAME varchar(200) NULL,
        OS varchar(100) NULL,
        OSVERSION varchar(50) NULL,
        CLIENTVERSION varchar(50) NULL,
        LASTIP varchar(64) NULL,
        NATTYPE varchar(30) NULL,
        TAGS json NULL,
        UNATTENDED int NOT NULL DEFAULT 0,
        UNATTENDED_SECRET varchar(200) NULL,
        POLICYID varchar(40) NULL,
        STATUS varchar(20) NOT NULL DEFAULT 'offline',
        LASTSEEN datetime NULL,
        ENROLLEDAT datetime NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        UNIQUE KEY uq_poleis_device_terminal (TERMINALID),
        KEY idx_poleis_device_tenant (TENANTID),
        KEY idx_poleis_device_owner (OWNERUSERID),
        KEY idx_poleis_device_group (GROUPID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_enrollment_token (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        TOKEN varchar(80) NOT NULL,
        OWNERUSERID varchar(40) NULL,
        GROUPID varchar(40) NULL,
        POLICYID varchar(40) NULL,
        MAXUSES int NOT NULL DEFAULT 0,
        USEDCOUNT int NOT NULL DEFAULT 0,
        EXPIRESAT datetime NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        UNIQUE KEY uq_poleis_enrollment_token (TOKEN),
        KEY idx_poleis_enrollment_tenant (TENANTID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_device_assignment (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        SUBJECTTYPE varchar(20) NOT NULL,
        SUBJECTID varchar(40) NOT NULL,
        TARGETTYPE varchar(20) NOT NULL,
        TARGETID varchar(40) NOT NULL,
        PROFILEID varchar(40) NULL,
        STARTDATE datetime NULL,
        ENDDATE datetime NULL,
        ALLOWEDCIDR varchar(255) NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        KEY idx_poleis_assignment_tenant (TENANTID),
        KEY idx_poleis_assignment_subject (SUBJECTID),
        KEY idx_poleis_assignment_target (TARGETID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_permission_profile (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        NAME varchar(100) NOT NULL,
        ISBUILTIN int NOT NULL DEFAULT 0,
        CONTROL_INPUT int NOT NULL DEFAULT 1,
        FILE_TRANSFER int NOT NULL DEFAULT 0,
        CLIPBOARD int NOT NULL DEFAULT 0,
        AUDIO int NOT NULL DEFAULT 0,
        MULTI_MONITOR int NOT NULL DEFAULT 1,
        GAMEPAD int NOT NULL DEFAULT 0,
        REMOTE_REBOOT int NOT NULL DEFAULT 0,
        PRIVACY_SCREEN int NOT NULL DEFAULT 0,
        RECORD_SESSION int NOT NULL DEFAULT 0,
        REQUIRE_CONFIRM int NOT NULL DEFAULT 1,
        IDLE_TIMEOUT_SEC int NOT NULL DEFAULT 0,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        KEY idx_poleis_profile_tenant (TENANTID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_session (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        CONTROLLERUSERID varchar(40) NOT NULL,
        CONTROLLERTERMINAL varchar(64) NULL,
        TARGETDEVICEID varchar(40) NOT NULL,
        TARGETTERMINAL varchar(64) NOT NULL,
        PROFILEID varchar(40) NULL,
        STARTAT datetime NOT NULL,
        ENDAT datetime NULL,
        DURATIONSEC int NULL,
        TRANSPORT varchar(20) NULL,
        NATTYPE varchar(30) NULL,
        RESULT varchar(20) NOT NULL DEFAULT 'active',
        FAILREASON varchar(200) NULL,
        RECORDINGURL varchar(500) NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        KEY idx_poleis_session_tenant (TENANTID),
        KEY idx_poleis_session_target (TARGETDEVICEID),
        KEY idx_poleis_session_controller (CONTROLLERUSERID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_session_event (
        ID varchar(40) NOT NULL PRIMARY KEY,
        SESSIONID varchar(40) NOT NULL,
        TYPE varchar(40) NOT NULL,
        PAYLOAD json NULL,
        CREATEON timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_poleis_session_event_session (SESSIONID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_audit_log (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        ACTORID varchar(40) NULL,
        ACTORNAME varchar(100) NULL,
        CATEGORY varchar(40) NOT NULL,
        ACTION varchar(80) NOT NULL,
        TARGET varchar(200) NULL,
        IP varchar(64) NULL,
        DETAIL json NULL,
        CREATEON timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_poleis_audit_tenant (TENANTID),
        KEY idx_poleis_audit_category (CATEGORY),
        KEY idx_poleis_audit_createon (CREATEON)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_device_policy (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        NAME varchar(100) NOT NULL,
        ISBUILTIN int NOT NULL DEFAULT 0,
        PRIORITY int NOT NULL DEFAULT 0,
        SETTINGS json NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        KEY idx_poleis_policy_tenant (TENANTID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_client_build (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        VERSION varchar(50) NOT NULL,
        CHANNEL varchar(20) NOT NULL DEFAULT 'stable',
        URL varchar(500) NULL,
        NOTES varchar(1000) NULL,
        PRESET json NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        KEY idx_poleis_build_tenant (TENANTID)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_ticket (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TENANTID varchar(40) NOT NULL,
        TITLE varchar(200) NOT NULL,
        DESCRIPTION text NULL,
        REQUESTERID varchar(40) NULL,
        REQUESTERNAME varchar(100) NULL,
        ASSIGNEEID varchar(40) NULL,
        ASSIGNEENAME varchar(100) NULL,
        STATUS varchar(20) NOT NULL DEFAULT 'open',
        PRIORITY varchar(20) NOT NULL DEFAULT 'normal',
        DEVICEID varchar(40) NULL,
        SESSIONID varchar(40) NULL,
        ENABLED int NOT NULL DEFAULT 1,
        DELETEMARK int NOT NULL DEFAULT 0,
        CREATEON timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        CREATEUSERID varchar(50) NULL,
        CREATEBY varchar(50) NULL,
        MODIFIEDON datetime NULL,
        MODIFIEDUSERID varchar(50) NULL,
        MODIFIEDBY varchar(50) NULL,
        CLOSEDON datetime NULL,
        KEY idx_poleis_ticket_tenant (TENANTID),
        KEY idx_poleis_ticket_status (STATUS)
      )`,
      `CREATE TABLE IF NOT EXISTS poleis_ticket_comment (
        ID varchar(40) NOT NULL PRIMARY KEY,
        TICKETID varchar(40) NOT NULL,
        AUTHORID varchar(40) NULL,
        AUTHORNAME varchar(100) NULL,
        BODY text NOT NULL,
        CREATEON timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_poleis_ticket_comment_ticket (TICKETID)
      )`
    ];

    for (const sql of statements) {
      await this.prisma.$executeRawUnsafe(sql);
    }
    await this.seedDefaults();
  }

  async seedDefaults() {
    await this.prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO poleis_tenant (ID, NAME, EDITION, CREATEON)
       VALUES (?, ?, ?, NOW())`,
      DEFAULT_TENANT_ID,
      DEFAULT_TENANT_NAME,
      DEFAULT_EDITION
    );

    const profiles = [
      ['builtin-view-only', 'Read-only audit', 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      ['builtin-personal', 'Personal remote access', 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
      ['builtin-it-maintenance', 'IT unattended maintenance', 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0],
      ['builtin-temporary-support', 'Temporary support', 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 3600]
    ];
    for (const p of profiles) {
      await this.prisma.$executeRawUnsafe(
        `INSERT IGNORE INTO poleis_permission_profile
         (ID, TENANTID, NAME, ISBUILTIN, CONTROL_INPUT, FILE_TRANSFER, CLIPBOARD, AUDIO,
          MULTI_MONITOR, GAMEPAD, REMOTE_REBOOT, PRIVACY_SCREEN, RECORD_SESSION,
          REQUIRE_CONFIRM, IDLE_TIMEOUT_SEC, CREATEON)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        p[0],
        DEFAULT_TENANT_ID,
        p[1],
        p[2],
        p[3],
        p[4],
        p[5],
        p[6],
        p[7],
        p[8],
        p[9],
        p[10],
        p[11],
        p[12]
      );
    }

    await this.prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO poleis_device_policy (ID, TENANTID, NAME, ISBUILTIN, PRIORITY, SETTINGS, CREATEON)
       VALUES (?, ?, ?, 1, 0, ?, NOW())`,
      'builtin-default-policy',
      DEFAULT_TENANT_ID,
      '默认策略',
      JSON.stringify(DEFAULT_POLICY_SETTINGS)
    );
  }

  async getTenantId() {
    await this.ensureSchema();
    return DEFAULT_TENANT_ID;
  }

  formatDevice(row) {
    return {
      id: row.ID,
      tenantId: row.TENANTID,
      terminalId: row.TERMINALID,
      ownerUserId: row.OWNERUSERID || '',
      groupId: row.GROUPID || '',
      alias: row.ALIAS || '',
      hostname: row.HOSTNAME || '',
      os: row.OS || '',
      osVersion: row.OSVERSION || '',
      clientVersion: row.CLIENTVERSION || '',
      lastIp: row.LASTIP || '',
      natType: row.NATTYPE || '',
      tags: readJsonColumn(row.TAGS, []),
      unattended: row.UNATTENDED === 1,
      policyId: row.POLICYID || '',
      status: row.STATUS || 'offline',
      lastSeen: row.LASTSEEN,
      enrolledAt: row.ENROLLEDAT,
      enabled: row.ENABLED === 1
    };
  }

  async upsertDeviceFromPresence({ userId, terminalId, ip, os, deviceInfo = {}, status = 'online' }) {
    if (!terminalId) return null;
    await this.ensureSchema();
    const now = new Date();
    const hostname = normalizeNullable(deviceInfo.hostname || deviceInfo.hostName || deviceInfo.name);
    const clientVersion = normalizeNullable(deviceInfo.clientVersion || deviceInfo.version);
    const osVersion = normalizeNullable(deviceInfo.osVersion);
    const natType = normalizeNullable(deviceInfo.natType);
    const existing = await this.getDeviceByTerminal(terminalId);
    if (!existing) {
      const id = randomUUID();
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO poleis_device
         (ID, TENANTID, TERMINALID, OWNERUSERID, HOSTNAME, OS, OSVERSION, CLIENTVERSION,
          LASTIP, NATTYPE, STATUS, LASTSEEN, ENROLLEDAT, CREATEON, CREATEUSERID)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        id,
        DEFAULT_TENANT_ID,
        terminalId,
        normalizeNullable(userId),
        hostname,
        normalizeNullable(os || deviceInfo.os),
        osVersion,
        clientVersion,
        normalizeNullable(ip),
        natType,
        status,
        now,
        now,
        normalizeNullable(userId)
      );
      return this.getDeviceById(id);
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device
          SET OWNERUSERID = COALESCE(OWNERUSERID, ?),
              HOSTNAME = COALESCE(?, HOSTNAME),
              OS = COALESCE(?, OS),
              OSVERSION = COALESCE(?, OSVERSION),
              CLIENTVERSION = COALESCE(?, CLIENTVERSION),
              LASTIP = COALESCE(?, LASTIP),
              NATTYPE = COALESCE(?, NATTYPE),
              STATUS = ?,
              LASTSEEN = ?,
              MODIFIEDON = ?
        WHERE TERMINALID = ?`,
      normalizeNullable(userId),
      hostname,
      normalizeNullable(os || deviceInfo.os),
      osVersion,
      clientVersion,
      normalizeNullable(ip),
      natType,
      status,
      now,
      now,
      terminalId
    );
    return this.getDeviceByTerminal(terminalId);
  }

  async markDeviceOffline(terminalId) {
    if (!terminalId) return;
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device SET STATUS = 'offline', LASTSEEN = ?, MODIFIEDON = ? WHERE TERMINALID = ?`,
      new Date(),
      new Date(),
      terminalId
    );
  }

  async getDeviceByTerminal(terminalId) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_device WHERE TERMINALID = ? AND DELETEMARK = 0 LIMIT 1`,
      terminalId
    );
    return rows[0] ? this.formatDevice(rows[0]) : null;
  }

  async getDeviceById(id) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_device WHERE ID = ? AND DELETEMARK = 0 LIMIT 1`,
      id
    );
    return rows[0] ? this.formatDevice(rows[0]) : null;
  }

  async listDevices(filters = {}) {
    await this.ensureSchema();
    const params = [DEFAULT_TENANT_ID];
    let where = `d.TENANTID = ? AND d.DELETEMARK = 0`;
    if (filters.status) {
      where += ` AND d.STATUS = ?`;
      params.push(filters.status);
    }
    if (filters.groupId) {
      where += ` AND d.GROUPID = ?`;
      params.push(filters.groupId);
    }
    if (filters.keyword) {
      where += ` AND (d.TERMINALID LIKE ? OR d.ALIAS LIKE ? OR d.HOSTNAME LIKE ? OR d.OWNERUSERID LIKE ?)`;
      const like = `%${filters.keyword}%`;
      params.push(like, like, like, like);
    }
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT d.*, g.NAME AS GROUPNAME
         FROM poleis_device d
         LEFT JOIN poleis_device_group g ON g.ID = d.GROUPID AND g.DELETEMARK = 0
        WHERE ${where}
        ORDER BY d.STATUS DESC, d.LASTSEEN DESC
        LIMIT 500`,
      ...params
    );
    return rows.map((row) => ({ ...this.formatDevice(row), groupName: row.GROUPNAME || '' }));
  }

  async updateDevice(id, payload = {}, user = {}) {
    await this.ensureSchema();
    const tags = safeJson(payload.tags, Array.isArray(payload.tags) ? payload.tags : []);
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device
          SET ALIAS = ?, GROUPID = ?, POLICYID = ?, TAGS = ?, UNATTENDED = ?, ENABLED = ?,
              MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      normalizeNullable(payload.alias),
      normalizeNullable(payload.groupId),
      normalizeNullable(payload.policyId),
      JSON.stringify(tags || []),
      boolToInt(payload.unattended, 0),
      boolToInt(payload.enabled, 1),
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
    return this.getDeviceById(id);
  }

  async deleteDevice(id, user = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device
          SET ENABLED = 0, DELETEMARK = 1, STATUS = 'offline',
              MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  // 设备详情：设备本体 + 最近会话 + 命中该设备/其设备组的授权
  async getDeviceDetail(id) {
    await this.ensureSchema();
    const device = await this.getDeviceById(id);
    if (!device) return null;
    const allSessions = await this.listSessions({});
    const sessions = allSessions.filter((s) => s.targetDeviceId === id).slice(0, 10);
    const allAssignments = await this.listAssignments();
    const assignments = allAssignments.filter((a) =>
      (a.targetType === 'device' && a.targetId === id) ||
      (a.targetType === 'device_group' && device.groupId && a.targetId === device.groupId));
    return { device, sessions, assignments };
  }

  async getSessionEvents(sessionId) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_session_event WHERE SESSIONID = ? ORDER BY CREATEON ASC LIMIT 200`,
      sessionId
    );
    return rows.map((row) => ({
      id: row.ID,
      type: row.TYPE,
      payload: readJsonColumn(row.PAYLOAD, {}),
      createdAt: row.CREATEON
    }));
  }

  async listGroups() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_device_group
        WHERE TENANTID = ? AND DELETEMARK = 0
        ORDER BY CREATEON ASC`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => ({
      id: row.ID,
      tenantId: row.TENANTID,
      parentId: row.PARENTID || '',
      name: row.NAME,
      policyId: row.POLICYID || '',
      enabled: row.ENABLED === 1
    }));
  }

  async createGroup(payload = {}, user = {}) {
    await this.ensureSchema();
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_device_group
       (ID, TENANTID, PARENTID, NAME, POLICYID, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      normalizeNullable(payload.parentId),
      String(payload.name || '').trim(),
      normalizeNullable(payload.policyId),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return (await this.listGroups()).find((group) => group.id === id);
  }

  async createEnrollmentToken(payload = {}, user = {}) {
    await this.ensureSchema();
    const id = randomUUID();
    const token = payload.token || randomBytes(24).toString('hex');
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_enrollment_token
       (ID, TENANTID, TOKEN, OWNERUSERID, GROUPID, POLICYID, MAXUSES, EXPIRESAT, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      token,
      normalizeNullable(payload.ownerUserId || user.Id),
      normalizeNullable(payload.groupId),
      normalizeNullable(payload.policyId),
      Number(payload.maxUses || 0),
      parseDateOrNull(payload.expiresAt),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return this.getEnrollmentToken(id);
  }

  async getEnrollmentToken(id) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_enrollment_token WHERE ID = ? LIMIT 1`,
      id
    );
    return rows[0] ? this.formatEnrollmentToken(rows[0]) : null;
  }

  async listEnrollmentTokens() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_enrollment_token
        WHERE TENANTID = ? AND DELETEMARK = 0
        ORDER BY CREATEON DESC
        LIMIT 100`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => this.formatEnrollmentToken(row));
  }

  async revokeEnrollmentToken(id, user = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_enrollment_token
          SET ENABLED = 0, DELETEMARK = 1, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  formatEnrollmentToken(row) {
    return {
      id: row.ID,
      token: row.TOKEN,
      ownerUserId: row.OWNERUSERID || '',
      groupId: row.GROUPID || '',
      policyId: row.POLICYID || '',
      maxUses: row.MAXUSES || 0,
      usedCount: row.USEDCOUNT || 0,
      expiresAt: row.EXPIRESAT,
      enabled: row.ENABLED === 1,
      createdAt: row.CREATEON
    };
  }

  async enrollDevice(payload = {}) {
    await this.ensureSchema();
    const token = normalizeNullable(payload.token || payload.enrollmentToken);
    const terminalId = normalizeNullable(payload.terminalId);
    if (!token || !terminalId) {
      const error = new Error('missing token or terminalId');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_enrollment_token
        WHERE TOKEN = ? AND ENABLED = 1 AND DELETEMARK = 0
        LIMIT 1`,
      token
    );
    const record = rows[0];
    if (!record) {
      const error = new Error('invalid enrollment token');
      error.code = 'INVALID_TOKEN';
      throw error;
    }
    if (record.EXPIRESAT && new Date(record.EXPIRESAT).getTime() < Date.now()) {
      const error = new Error('expired enrollment token');
      error.code = 'EXPIRED_TOKEN';
      throw error;
    }
    if (record.MAXUSES > 0 && record.USEDCOUNT >= record.MAXUSES) {
      const error = new Error('enrollment token exhausted');
      error.code = 'TOKEN_EXHAUSTED';
      throw error;
    }

    await this.upsertDeviceFromPresence({
      userId: record.OWNERUSERID,
      terminalId,
      ip: payload.ip,
      os: payload.os,
      deviceInfo: {
        hostname: payload.hostname,
        osVersion: payload.osVersion,
        clientVersion: payload.clientVersion,
        natType: payload.natType
      },
      status: 'offline'
    });
    const device = await this.getDeviceByTerminal(terminalId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device
          SET TENANTID = ?, OWNERUSERID = ?, GROUPID = ?, POLICYID = ?, ENROLLEDAT = COALESCE(ENROLLEDAT, NOW()), MODIFIEDON = NOW()
        WHERE TERMINALID = ?`,
      record.TENANTID,
      normalizeNullable(record.OWNERUSERID),
      normalizeNullable(record.GROUPID),
      normalizeNullable(record.POLICYID),
      terminalId
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_enrollment_token SET USEDCOUNT = USEDCOUNT + 1, MODIFIEDON = NOW() WHERE ID = ?`,
      record.ID
    );
    return this.getDeviceById(device.id);
  }

  async listProfiles() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_permission_profile
        WHERE TENANTID = ? AND DELETEMARK = 0
        ORDER BY ISBUILTIN DESC, NAME ASC`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => ({
      id: row.ID,
      name: row.NAME,
      builtin: row.ISBUILTIN === 1,
      controlInput: row.CONTROL_INPUT === 1,
      fileTransfer: row.FILE_TRANSFER === 1,
      clipboard: row.CLIPBOARD === 1,
      audio: row.AUDIO === 1,
      multiMonitor: row.MULTI_MONITOR === 1,
      gamepad: row.GAMEPAD === 1,
      remoteReboot: row.REMOTE_REBOOT === 1,
      privacyScreen: row.PRIVACY_SCREEN === 1,
      recordSession: row.RECORD_SESSION === 1,
      requireConfirm: row.REQUIRE_CONFIRM === 1,
      idleTimeoutSec: row.IDLE_TIMEOUT_SEC || 0
    }));
  }

  async getProfileById(id) {
    if (!id) return null;
    const profiles = await this.listProfiles();
    return profiles.find((profile) => profile.id === id) || null;
  }

  // 把权限模板解析成下发给 agent / 落到会话的能力位对象。
  async resolveProfile(profileId) {
    if (!profileId) return null;
    return this.getProfileById(profileId);
  }

  profileCapabilityArgs(payload = {}) {
    return [
      boolToInt(payload.controlInput, 1),
      boolToInt(payload.fileTransfer, 0),
      boolToInt(payload.clipboard, 0),
      boolToInt(payload.audio, 0),
      boolToInt(payload.multiMonitor, 1),
      boolToInt(payload.gamepad, 0),
      boolToInt(payload.remoteReboot, 0),
      boolToInt(payload.privacyScreen, 0),
      boolToInt(payload.recordSession, 0),
      boolToInt(payload.requireConfirm, 1),
      Number(payload.idleTimeoutSec || 0)
    ];
  }

  async createProfile(payload = {}, user = {}) {
    await this.ensureSchema();
    const name = String(payload.name || '').trim();
    if (!name) {
      const error = new Error('missing profile name');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_permission_profile
       (ID, TENANTID, NAME, ISBUILTIN, CONTROL_INPUT, FILE_TRANSFER, CLIPBOARD, AUDIO,
        MULTI_MONITOR, GAMEPAD, REMOTE_REBOOT, PRIVACY_SCREEN, RECORD_SESSION,
        REQUIRE_CONFIRM, IDLE_TIMEOUT_SEC, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      name,
      ...this.profileCapabilityArgs(payload),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return this.getProfileById(id);
  }

  async updateProfile(id, payload = {}, user = {}) {
    await this.ensureSchema();
    const name = String(payload.name || '').trim();
    if (!name) {
      const error = new Error('missing profile name');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_permission_profile
          SET NAME = ?, CONTROL_INPUT = ?, FILE_TRANSFER = ?, CLIPBOARD = ?, AUDIO = ?,
              MULTI_MONITOR = ?, GAMEPAD = ?, REMOTE_REBOOT = ?, PRIVACY_SCREEN = ?,
              RECORD_SESSION = ?, REQUIRE_CONFIRM = ?, IDLE_TIMEOUT_SEC = ?,
              MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      name,
      ...this.profileCapabilityArgs(payload),
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
    return this.getProfileById(id);
  }

  async deleteProfile(id, user = {}) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT ISBUILTIN FROM poleis_permission_profile WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0 LIMIT 1`,
      id,
      DEFAULT_TENANT_ID
    );
    if (!rows.length) return;
    if (rows[0].ISBUILTIN === 1) {
      const error = new Error('cannot delete builtin profile');
      error.code = 'BUILTIN_PROFILE';
      throw error;
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_permission_profile
          SET ENABLED = 0, DELETEMARK = 1, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  // ---------- 设备策略（客户端运行配置） ----------
  formatPolicy(row) {
    return {
      id: row.ID,
      name: row.NAME,
      builtin: row.ISBUILTIN === 1,
      priority: row.PRIORITY || 0,
      settings: normalizePolicySettings(readJsonColumn(row.SETTINGS, {}))
    };
  }

  async listPolicies() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_device_policy
        WHERE TENANTID = ? AND DELETEMARK = 0
        ORDER BY ISBUILTIN DESC, PRIORITY DESC, NAME ASC`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => this.formatPolicy(row));
  }

  async getPolicyById(id) {
    if (!id) return null;
    const policies = await this.listPolicies();
    return policies.find((policy) => policy.id === id) || null;
  }

  async createPolicy(payload = {}, user = {}) {
    await this.ensureSchema();
    const name = String(payload.name || '').trim();
    if (!name) {
      const error = new Error('missing policy name');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_device_policy (ID, TENANTID, NAME, ISBUILTIN, PRIORITY, SETTINGS, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, 0, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      name,
      Number(payload.priority || 0),
      JSON.stringify(normalizePolicySettings(payload.settings || payload)),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return this.getPolicyById(id);
  }

  async updatePolicy(id, payload = {}, user = {}) {
    await this.ensureSchema();
    const name = String(payload.name || '').trim();
    if (!name) {
      const error = new Error('missing policy name');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device_policy
          SET NAME = ?, PRIORITY = ?, SETTINGS = ?, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      name,
      Number(payload.priority || 0),
      JSON.stringify(normalizePolicySettings(payload.settings || payload)),
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
    return this.getPolicyById(id);
  }

  async deletePolicy(id, user = {}) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT ISBUILTIN FROM poleis_device_policy WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0 LIMIT 1`,
      id,
      DEFAULT_TENANT_ID
    );
    if (!rows.length) return;
    if (rows[0].ISBUILTIN === 1) {
      const error = new Error('cannot delete builtin policy');
      error.code = 'BUILTIN_POLICY';
      throw error;
    }
    // 解绑引用了该策略的设备 / 设备组，避免悬挂引用。
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device SET POLICYID = NULL WHERE TENANTID = ? AND POLICYID = ?`,
      DEFAULT_TENANT_ID, id
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device_group SET POLICYID = NULL WHERE TENANTID = ? AND POLICYID = ?`,
      DEFAULT_TENANT_ID, id
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device_policy
          SET ENABLED = 0, DELETEMARK = 1, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  // 解析设备的生效策略：设备 > 设备组 > 内置默认（继承）。
  async resolveDevicePolicy(device) {
    if (!device) return null;
    let policyId = device.policyId || null;
    if (!policyId && device.groupId) {
      const groupRows = await this.prisma.$queryRawUnsafe(
        `SELECT POLICYID FROM poleis_device_group WHERE ID = ? AND DELETEMARK = 0 LIMIT 1`,
        device.groupId
      );
      policyId = groupRows[0]?.POLICYID || null;
    }
    if (!policyId) policyId = 'builtin-default-policy';
    const policy = await this.getPolicyById(policyId);
    if (policy) return { id: policy.id, name: policy.name, settings: policy.settings };
    return { id: 'builtin-default-policy', name: '默认策略', settings: { ...DEFAULT_POLICY_SETTINGS } };
  }

  async updateGroup(id, payload = {}, user = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device_group
          SET NAME = COALESCE(?, NAME), POLICYID = ?, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      payload.name === undefined ? null : String(payload.name).trim(),
      normalizeNullable(payload.policyId),
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
    return (await this.listGroups()).find((group) => group.id === id);
  }

  // ---------- 部署中心（客户端版本） ----------
  formatClientBuild(row) {
    return {
      id: row.ID,
      version: row.VERSION,
      channel: row.CHANNEL || 'stable',
      url: row.URL || '',
      notes: row.NOTES || '',
      preset: readJsonColumn(row.PRESET, {}),
      createdAt: row.CREATEON
    };
  }

  async listClientBuilds() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_client_build
        WHERE TENANTID = ? AND DELETEMARK = 0
        ORDER BY CREATEON DESC
        LIMIT 200`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => this.formatClientBuild(row));
  }

  async getClientBuild(id) {
    const builds = await this.listClientBuilds();
    return builds.find((build) => build.id === id) || null;
  }

  async createClientBuild(payload = {}, user = {}) {
    await this.ensureSchema();
    const version = String(payload.version || '').trim();
    if (!version) {
      const error = new Error('missing version');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const channel = ['stable', 'beta', 'gray'].includes(payload.channel) ? payload.channel : 'stable';
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_client_build (ID, TENANTID, VERSION, CHANNEL, URL, NOTES, PRESET, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      version,
      channel,
      normalizeNullable(payload.url),
      normalizeNullable(payload.notes),
      JSON.stringify(payload.preset || {}),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return this.getClientBuild(id);
  }

  async updateClientBuild(id, payload = {}, user = {}) {
    await this.ensureSchema();
    const version = String(payload.version || '').trim();
    if (!version) {
      const error = new Error('missing version');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const channel = ['stable', 'beta', 'gray'].includes(payload.channel) ? payload.channel : 'stable';
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_client_build
          SET VERSION = ?, CHANNEL = ?, URL = ?, NOTES = ?, PRESET = ?,
              MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      version,
      channel,
      normalizeNullable(payload.url),
      normalizeNullable(payload.notes),
      JSON.stringify(payload.preset || {}),
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
    return this.getClientBuild(id);
  }

  async deleteClientBuild(id, user = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_client_build
          SET ENABLED = 0, DELETEMARK = 1, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  // ---------- 支持工单 ----------
  formatTicket(row) {
    return {
      id: row.ID,
      title: row.TITLE,
      description: row.DESCRIPTION || '',
      requesterId: row.REQUESTERID || '',
      requesterName: row.REQUESTERNAME || '',
      assigneeId: row.ASSIGNEEID || '',
      assigneeName: row.ASSIGNEENAME || '',
      status: row.STATUS || 'open',
      priority: row.PRIORITY || 'normal',
      deviceId: row.DEVICEID || '',
      deviceName: row.DEVICENAME || '',
      sessionId: row.SESSIONID || '',
      createdAt: row.CREATEON,
      updatedAt: row.MODIFIEDON,
      closedAt: row.CLOSEDON
    };
  }

  async listTickets(filters = {}) {
    await this.ensureSchema();
    const params = [DEFAULT_TENANT_ID];
    let where = `t.TENANTID = ? AND t.DELETEMARK = 0`;
    if (filters.status) { where += ` AND t.STATUS = ?`; params.push(filters.status); }
    if (filters.keyword) {
      const like = `%${filters.keyword}%`;
      where += ` AND (t.TITLE LIKE ? OR t.REQUESTERNAME LIKE ? OR t.ASSIGNEENAME LIKE ?)`;
      params.push(like, like, like);
    }
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT t.*, d.ALIAS AS DEVICEALIAS, d.HOSTNAME AS DEVICEHOSTNAME
         FROM poleis_ticket t
         LEFT JOIN poleis_device d ON d.ID = t.DEVICEID
        WHERE ${where}
        ORDER BY (t.STATUS = 'closed') ASC, FIELD(t.PRIORITY,'urgent','high','normal','low'), t.MODIFIEDON DESC, t.CREATEON DESC
        LIMIT 300`,
      ...params
    );
    return rows.map((row) => this.formatTicket({ ...row, DEVICENAME: row.DEVICEALIAS || row.DEVICEHOSTNAME || '' }));
  }

  async getTicket(id) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT t.*, d.ALIAS AS DEVICEALIAS, d.HOSTNAME AS DEVICEHOSTNAME
         FROM poleis_ticket t
         LEFT JOIN poleis_device d ON d.ID = t.DEVICEID
        WHERE t.ID = ? AND t.TENANTID = ? AND t.DELETEMARK = 0 LIMIT 1`,
      id, DEFAULT_TENANT_ID
    );
    if (!rows[0]) return null;
    const ticket = this.formatTicket({ ...rows[0], DEVICENAME: rows[0].DEVICEALIAS || rows[0].DEVICEHOSTNAME || '' });
    const comments = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_ticket_comment WHERE TICKETID = ? ORDER BY CREATEON ASC LIMIT 500`,
      id
    );
    ticket.comments = comments.map((c) => ({
      id: c.ID, authorId: c.AUTHORID || '', authorName: c.AUTHORNAME || '', body: c.BODY, createdAt: c.CREATEON
    }));
    return ticket;
  }

  async createTicket(payload = {}, user = {}) {
    await this.ensureSchema();
    const title = String(payload.title || '').trim();
    if (!title) {
      const error = new Error('missing title');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const priority = ['low', 'normal', 'high', 'urgent'].includes(payload.priority) ? payload.priority : 'normal';
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_ticket
       (ID, TENANTID, TITLE, DESCRIPTION, REQUESTERID, REQUESTERNAME, STATUS, PRIORITY, DEVICEID, SESSIONID, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      title,
      normalizeNullable(payload.description),
      normalizeNullable(payload.requesterId || user.Id),
      normalizeNullable(payload.requesterName || user.RealName),
      priority,
      normalizeNullable(payload.deviceId),
      normalizeNullable(payload.sessionId),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return this.getTicket(id);
  }

  async updateTicket(id, payload = {}, user = {}) {
    await this.ensureSchema();
    const status = ['open', 'in_progress', 'resolved', 'closed'].includes(payload.status) ? payload.status : null;
    const priority = ['low', 'normal', 'high', 'urgent'].includes(payload.priority) ? payload.priority : null;
    let assigneeId;
    let assigneeName;
    if (payload.assigneeId !== undefined) {
      assigneeId = payload.assigneeId || null;
      assigneeName = null;
      if (assigneeId) {
        const u = await this.prisma.$queryRawUnsafe(
          `SELECT REALNAME, USERNAME FROM piuser WHERE ID = ? LIMIT 1`, assigneeId
        );
        assigneeName = u[0]?.REALNAME || u[0]?.USERNAME || assigneeId;
      }
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_ticket
          SET TITLE = COALESCE(?, TITLE),
              DESCRIPTION = COALESCE(?, DESCRIPTION),
              STATUS = COALESCE(?, STATUS),
              PRIORITY = COALESCE(?, PRIORITY),
              ASSIGNEEID = ${assigneeId === undefined ? 'ASSIGNEEID' : '?'},
              ASSIGNEENAME = ${assigneeId === undefined ? 'ASSIGNEENAME' : '?'},
              CLOSEDON = CASE WHEN ? = 'closed' THEN NOW() ELSE CLOSEDON END,
              MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      ...[
        payload.title !== undefined ? String(payload.title).trim() : null,
        payload.description !== undefined ? normalizeNullable(payload.description) : null,
        status,
        priority,
        ...(assigneeId === undefined ? [] : [assigneeId, assigneeName]),
        status || '',
        new Date(),
        normalizeNullable(user.Id),
        normalizeNullable(user.RealName),
        id,
        DEFAULT_TENANT_ID
      ]
    );
    return this.getTicket(id);
  }

  async addTicketComment(id, body, user = {}) {
    await this.ensureSchema();
    const text = String(body || '').trim();
    if (!text) {
      const error = new Error('empty comment');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_ticket_comment (ID, TICKETID, AUTHORID, AUTHORNAME, BODY, CREATEON)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      randomUUID(), id, normalizeNullable(user.Id), normalizeNullable(user.RealName), text
    );
    // 添加评论也顺手刷新工单更新时间
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_ticket SET MODIFIEDON = NOW() WHERE ID = ? AND TENANTID = ?`,
      id, DEFAULT_TENANT_ID
    );
    return this.getTicket(id);
  }

  async listUsers(filters = {}) {
    await this.ensureSchema();
    const params = [];
    let where = `DELETEMARK = 0 AND ENABLED = 1`;
    if (filters.keyword) {
      const like = `%${filters.keyword}%`;
      where += ` AND (ID LIKE ? OR USERNAME LIKE ? OR REALNAME LIKE ? OR CODE LIKE ?)`;
      params.push(like, like, like, like);
    }
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT ID, USERNAME, REALNAME, CODE, EMAIL
         FROM piuser
        WHERE ${where}
        ORDER BY SORTCODE ASC, USERNAME ASC
        LIMIT 200`,
      ...params
    );
    return rows.map((row) => ({
      id: row.ID,
      userName: row.USERNAME || '',
      realName: row.REALNAME || '',
      code: row.CODE || '',
      email: row.EMAIL || '',
      label: row.REALNAME || row.USERNAME || row.CODE || row.ID
    }));
  }

  async listAssignments() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT a.*, d.ALIAS AS DEVICEALIAS, d.HOSTNAME AS DEVICEHOSTNAME, g.NAME AS GROUPNAME, p.NAME AS PROFILENAME
         FROM poleis_device_assignment a
         LEFT JOIN poleis_device d ON a.TARGETTYPE = 'device' AND d.ID = a.TARGETID
         LEFT JOIN poleis_device_group g ON a.TARGETTYPE = 'device_group' AND g.ID = a.TARGETID
         LEFT JOIN poleis_permission_profile p ON p.ID = a.PROFILEID
        WHERE a.TENANTID = ? AND a.DELETEMARK = 0
        ORDER BY a.CREATEON DESC
        LIMIT 200`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => ({
      id: row.ID,
      subjectType: row.SUBJECTTYPE,
      subjectId: row.SUBJECTID,
      targetType: row.TARGETTYPE,
      targetId: row.TARGETID,
      targetName: row.DEVICEALIAS || row.DEVICEHOSTNAME || row.GROUPNAME || row.TARGETID,
      profileId: row.PROFILEID || '',
      profileName: row.PROFILENAME || '',
      startDate: row.STARTDATE,
      endDate: row.ENDDATE,
      allowedCidr: row.ALLOWEDCIDR || '',
      enabled: row.ENABLED === 1
    }));
  }

  async createAssignment(payload = {}, user = {}) {
    await this.ensureSchema();
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_device_assignment
       (ID, TENANTID, SUBJECTTYPE, SUBJECTID, TARGETTYPE, TARGETID, PROFILEID,
        STARTDATE, ENDDATE, ALLOWEDCIDR, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      normalizeNullable(payload.subjectType) || 'user',
      normalizeNullable(payload.subjectId),
      normalizeNullable(payload.targetType) || 'device',
      normalizeNullable(payload.targetId),
      normalizeNullable(payload.profileId),
      parseDateOrNull(payload.startDate),
      parseDateOrNull(payload.endDate),
      normalizeNullable(payload.allowedCidr),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return (await this.listAssignments()).find((assignment) => assignment.id === id);
  }

  async revokeAssignment(id, user = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_device_assignment
          SET ENABLED = 0, DELETEMARK = 1, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  async isAuthorized({ controllerUserId, targetTerminalId, ip }) {
    await this.ensureSchema();
    const device = await this.getDeviceByTerminal(targetTerminalId);
    if (!device || !device.enabled) {
      return { allowed: false, reason: 'DEVICE_NOT_REGISTERED' };
    }
    if (device.ownerUserId && controllerUserId && device.ownerUserId === controllerUserId) {
      const ownerPolicy = await this.resolveDevicePolicy(device);
      return { allowed: true, device, reason: 'OWNER', profileId: null, profile: OWNER_PROFILE, policy: ownerPolicy };
    }

    const now = new Date();
    // 用户直接授权，或用户在本租户内实际拥有的角色（member_role）被授权。
    // 角色匹配通过 poleis_member 子查询作用域，没有成员记录时角色授权不生效，
    // 避免“给某角色授权 = 给所有人授权”的越权。设备级授权优先于设备组级。
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_device_assignment
        WHERE TENANTID = ?
          AND ENABLED = 1
          AND DELETEMARK = 0
          AND (
            (SUBJECTTYPE = 'user' AND SUBJECTID = ?)
            OR (SUBJECTTYPE = 'member_role' AND SUBJECTID IN (
                  SELECT ROLE FROM poleis_member
                   WHERE TENANTID = ? AND USERID = ? AND ENABLED = 1 AND DELETEMARK = 0))
          )
          AND (
            (TARGETTYPE = 'device' AND TARGETID = ?)
            OR (TARGETTYPE = 'device_group' AND TARGETID = ?)
          )
          AND (STARTDATE IS NULL OR STARTDATE <= ?)
          AND (ENDDATE IS NULL OR ENDDATE >= ?)
        ORDER BY (TARGETTYPE = 'device') DESC
        LIMIT 1`,
      DEFAULT_TENANT_ID,
      controllerUserId || '',
      DEFAULT_TENANT_ID,
      controllerUserId || '',
      device.id,
      device.groupId || '',
      now,
      now
    );
    if (!rows.length) {
      return { allowed: false, reason: 'NO_ASSIGNMENT', device };
    }
    // CIDR enforcement is intentionally conservative for now: exact IP matches
    // are enforced, CIDR ranges are recorded but not expanded until a network
    // helper is added.
    const allowedCidr = rows[0].ALLOWEDCIDR;
    if (allowedCidr && ip && !allowedCidr.split(',').map((v) => v.trim()).includes(ip)) {
      return { allowed: false, reason: 'IP_NOT_ALLOWED', device };
    }
    const profile = await this.resolveProfile(rows[0].PROFILEID);
    const policy = await this.resolveDevicePolicy(device);
    return {
      allowed: true,
      device,
      assignment: rows[0],
      profileId: rows[0].PROFILEID || null,
      profile,
      policy,
      reason: 'ASSIGNMENT'
    };
  }

  async createSession({ controllerUserId, controllerTerminal, targetTerminal, profileId, transport = null }) {
    await this.ensureSchema();
    const device = await this.getDeviceByTerminal(targetTerminal);
    if (!device) return null;
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_session
       (ID, TENANTID, CONTROLLERUSERID, CONTROLLERTERMINAL, TARGETDEVICEID, TARGETTERMINAL,
        PROFILEID, STARTAT, TRANSPORT, RESULT, CREATEON, CREATEUSERID)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), ?)`,
      id,
      DEFAULT_TENANT_ID,
      normalizeNullable(controllerUserId) || '',
      normalizeNullable(controllerTerminal),
      device.id,
      targetTerminal,
      normalizeNullable(profileId),
      new Date(),
      normalizeNullable(transport),
      normalizeNullable(controllerUserId)
    );
    await this.addSessionEvent(id, 'request', { controllerTerminal, targetTerminal });
    return id;
  }

  async getSession(id) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM poleis_session WHERE ID = ? AND TENANTID = ? LIMIT 1`,
      id,
      DEFAULT_TENANT_ID
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.ID,
      controllerUserId: r.CONTROLLERUSERID,
      controllerTerminal: r.CONTROLLERTERMINAL || '',
      targetTerminal: r.TARGETTERMINAL,
      targetDeviceId: r.TARGETDEVICEID,
      result: r.RESULT
    };
  }

  async findActiveSession(controllerTerminal, targetTerminal) {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT ID FROM poleis_session
        WHERE RESULT = 'active'
          AND CONTROLLERTERMINAL = ?
          AND TARGETTERMINAL = ?
        ORDER BY STARTAT DESC
        LIMIT 1`,
      controllerTerminal,
      targetTerminal
    );
    return rows[0]?.ID || null;
  }

  async addSessionEvent(sessionId, type, payload = {}) {
    if (!sessionId) return;
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_session_event (ID, SESSIONID, TYPE, PAYLOAD, CREATEON)
       VALUES (?, ?, ?, ?, NOW())`,
      randomUUID(),
      sessionId,
      type,
      JSON.stringify(payload || {})
    );
  }

  async completeSession(sessionId, result, extra = {}) {
    if (!sessionId) return;
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT STARTAT FROM poleis_session WHERE ID = ? LIMIT 1`,
      sessionId
    );
    const start = rows[0]?.STARTAT ? new Date(rows[0].STARTAT).getTime() : Date.now();
    const end = new Date();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_session
          SET ENDAT = ?, DURATIONSEC = ?, RESULT = ?, FAILREASON = ?, TRANSPORT = COALESCE(?, TRANSPORT), MODIFIEDON = ?
        WHERE ID = ?`,
      end,
      Math.max(0, Math.floor((end.getTime() - start) / 1000)),
      result,
      normalizeNullable(extra.failReason),
      normalizeNullable(extra.transport),
      end,
      sessionId
    );
    await this.addSessionEvent(sessionId, result === 'failed' ? 'failed' : 'disconnect', extra);
  }

  async listSessions(filters = {}) {
    await this.ensureSchema();
    const params = [DEFAULT_TENANT_ID];
    let where = `s.TENANTID = ? AND s.DELETEMARK = 0`;
    if (filters.result) {
      where += ` AND s.RESULT = ?`;
      params.push(filters.result);
    }
    if (filters.keyword) {
      where += ` AND (s.CONTROLLERUSERID LIKE ? OR s.CONTROLLERTERMINAL LIKE ? OR s.TARGETTERMINAL LIKE ? OR d.ALIAS LIKE ? OR d.HOSTNAME LIKE ?)`;
      const like = `%${filters.keyword}%`;
      params.push(like, like, like, like, like);
    }
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT s.*, d.ALIAS AS DEVICEALIAS, d.HOSTNAME AS DEVICEHOSTNAME
         FROM poleis_session s
         LEFT JOIN poleis_device d ON d.ID = s.TARGETDEVICEID
        WHERE ${where}
        ORDER BY s.STARTAT DESC
        LIMIT 200`,
      ...params
    );
    return rows.map((row) => ({
      id: row.ID,
      controllerUserId: row.CONTROLLERUSERID,
      controllerTerminal: row.CONTROLLERTERMINAL || '',
      targetDeviceId: row.TARGETDEVICEID,
      targetTerminal: row.TARGETTERMINAL,
      targetName: row.DEVICEALIAS || row.DEVICEHOSTNAME || row.TARGETTERMINAL,
      profileId: row.PROFILEID || '',
      startAt: row.STARTAT,
      endAt: row.ENDAT,
      durationSec: row.DURATIONSEC || 0,
      transport: row.TRANSPORT || '',
      result: row.RESULT,
      failReason: row.FAILREASON || ''
    }));
  }

  async listAuditLogs(filters = {}) {
    await this.ensureSchema();
    const params = [DEFAULT_TENANT_ID];
    let where = `TENANTID = ?`;
    if (filters.category) {
      where += ` AND CATEGORY = ?`;
      params.push(filters.category);
    }
    if (filters.keyword) {
      const like = `%${filters.keyword}%`;
      where += ` AND (ACTORID LIKE ? OR ACTORNAME LIKE ? OR ACTION LIKE ? OR TARGET LIKE ? OR IP LIKE ?)`;
      params.push(like, like, like, like, like);
    }
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT *
         FROM poleis_audit_log
        WHERE ${where}
        ORDER BY CREATEON DESC
        LIMIT 300`,
      ...params
    );
    return rows.map((row) => ({
      id: row.ID,
      actorId: row.ACTORID || '',
      actorName: row.ACTORNAME || '',
      category: row.CATEGORY || '',
      action: row.ACTION || '',
      target: row.TARGET || '',
      ip: row.IP || '',
      detail: readJsonColumn(row.DETAIL, {}),
      createdAt: row.CREATEON
    }));
  }

  async writeAudit(event = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_audit_log
       (ID, TENANTID, ACTORID, ACTORNAME, CATEGORY, ACTION, TARGET, IP, DETAIL, CREATEON)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      randomUUID(),
      DEFAULT_TENANT_ID,
      normalizeNullable(event.actorId || event.userId),
      normalizeNullable(event.actorName || event.userName),
      normalizeNullable(event.category) || 'admin',
      normalizeNullable(event.action) || 'unknown',
      normalizeNullable(event.target || event.description),
      normalizeNullable(event.ip),
      JSON.stringify(event.detail || event.payload || {})
    );
  }

  // ---------- 成员与角色 ----------
  async listMembers() {
    await this.ensureSchema();
    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT m.*, u.USERNAME, u.REALNAME, u.CODE, u.EMAIL
         FROM poleis_member m
         LEFT JOIN piuser u ON u.ID = m.USERID
        WHERE m.TENANTID = ? AND m.DELETEMARK = 0
        ORDER BY m.CREATEON ASC
        LIMIT 500`,
      DEFAULT_TENANT_ID
    );
    return rows.map((row) => ({
      id: row.ID,
      userId: row.USERID,
      userName: row.USERNAME || '',
      realName: row.REALNAME || '',
      email: row.EMAIL || '',
      label: row.REALNAME || row.USERNAME || row.USERID,
      role: row.ROLE,
      enabled: row.ENABLED === 1,
      createdAt: row.CREATEON
    }));
  }

  async getMemberById(id) {
    const members = await this.listMembers();
    return members.find((member) => member.id === id) || null;
  }

  async addMember(payload = {}, user = {}) {
    await this.ensureSchema();
    const userId = normalizeNullable(payload.userId);
    if (!userId) {
      const error = new Error('missing userId');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const role = ALLOWED_MEMBER_ROLES.includes(payload.role) ? payload.role : 'member';
    const existing = await this.prisma.$queryRawUnsafe(
      `SELECT ID FROM poleis_member WHERE TENANTID = ? AND USERID = ? LIMIT 1`,
      DEFAULT_TENANT_ID,
      userId
    );
    if (existing.length) {
      // 复用已存在记录（含被软删的），重新启用并设置角色。
      await this.prisma.$executeRawUnsafe(
        `UPDATE poleis_member
            SET ROLE = ?, ENABLED = 1, DELETEMARK = 0, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
          WHERE ID = ?`,
        role,
        new Date(),
        normalizeNullable(user.Id),
        normalizeNullable(user.RealName),
        existing[0].ID
      );
      return this.getMemberById(existing[0].ID);
    }
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO poleis_member (ID, TENANTID, USERID, ROLE, CREATEON, CREATEUSERID, CREATEBY)
       VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
      id,
      DEFAULT_TENANT_ID,
      userId,
      role,
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName)
    );
    return this.getMemberById(id);
  }

  async updateMember(id, payload = {}, user = {}) {
    await this.ensureSchema();
    const role = ALLOWED_MEMBER_ROLES.includes(payload.role) ? payload.role : null;
    const enabled = payload.enabled === undefined ? null : boolToInt(payload.enabled, 1);
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_member
          SET ROLE = COALESCE(?, ROLE), ENABLED = COALESCE(?, ENABLED),
              MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ? AND DELETEMARK = 0`,
      role,
      enabled,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
    return this.getMemberById(id);
  }

  async removeMember(id, user = {}) {
    await this.ensureSchema();
    await this.prisma.$executeRawUnsafe(
      `UPDATE poleis_member
          SET ENABLED = 0, DELETEMARK = 1, MODIFIEDON = ?, MODIFIEDUSERID = ?, MODIFIEDBY = ?
        WHERE ID = ? AND TENANTID = ?`,
      new Date(),
      normalizeNullable(user.Id),
      normalizeNullable(user.RealName),
      id,
      DEFAULT_TENANT_ID
    );
  }

  // ---------- 网络 / 中继可观测 ----------
  async getNetworkOverview() {
    await this.ensureSchema();
    const num = (value) => Number(value || 0);
    const aggRows = await this.prisma.$queryRawUnsafe(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN TRANSPORT = 'p2p' THEN 1 ELSE 0 END) AS p2p,
          SUM(CASE WHEN TRANSPORT = 'relay' THEN 1 ELSE 0 END) AS relay,
          SUM(CASE WHEN RESULT = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN RESULT = 'active' THEN 1 ELSE 0 END) AS active
         FROM poleis_session
        WHERE TENANTID = ? AND DELETEMARK = 0`,
      DEFAULT_TENANT_ID
    );
    const agg = aggRows[0] || {};
    const natRows = await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(NULLIF(NATTYPE, ''), '未知') AS natType, COUNT(*) AS cnt
         FROM poleis_device
        WHERE TENANTID = ? AND DELETEMARK = 0
        GROUP BY COALESCE(NULLIF(NATTYPE, ''), '未知')
        ORDER BY cnt DESC
        LIMIT 12`,
      DEFAULT_TENANT_ID
    );
    const failRows = await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(NULLIF(FAILREASON, ''), '未知') AS reason, COUNT(*) AS cnt
         FROM poleis_session
        WHERE TENANTID = ? AND DELETEMARK = 0 AND RESULT = 'failed'
        GROUP BY COALESCE(NULLIF(FAILREASON, ''), '未知')
        ORDER BY cnt DESC
        LIMIT 8`,
      DEFAULT_TENANT_ID
    );
    const total = num(agg.total);
    const p2p = num(agg.p2p);
    const relay = num(agg.relay);
    const failed = num(agg.failed);
    const decided = p2p + relay;
    return {
      total,
      active: num(agg.active),
      p2p,
      relay,
      failed,
      p2pRate: decided ? Math.round((p2p / decided) * 100) : 0,
      relayRate: decided ? Math.round((relay / decided) * 100) : 0,
      failRate: total ? Math.round((failed / total) * 100) : 0,
      natDistribution: natRows.map((row) => ({ type: row.natType, count: num(row.cnt) })),
      failReasons: failRows.map((row) => ({ reason: row.reason, count: num(row.cnt) }))
    };
  }
}

module.exports = {
  PlatformService,
  platformService: new PlatformService(),
  DEFAULT_TENANT_ID
};
