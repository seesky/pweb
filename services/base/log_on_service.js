'use strict';

const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const StatusCode = require('../../utilities/message/status_code');
const FrameworkMessage = require('../../utilities/message/framework_message');
const AuditStatus = require('../../utilities/message/audit_status');
const SystemInfo = require('../../utilities/publiclibrary/system_info');
const UserInfo = require('../../utilities/publiclibrary/user_info');
const SecretHelper = require('../../utilities/publiclibrary/secret_helper');
const ValidateUtil = require('../../utilities/publiclibrary/validate_util');
const { CheckIPAddress } = require('../../utilities/publiclibrary/check_ip_address');
const DbCommonLibaray = require('../../utilities/publiclibrary/db_common_libaray');
const { ParameterService } = require('./parameter_service');
const { LogService } = require('./log_service');

const prisma = new PrismaClient();
const db = new DbCommonLibaray();
const parameterService = new ParameterService(prisma);
const checkIPAddressService = new CheckIPAddress(prisma);

class LogOnService {
  constructor(client = prisma) {
    this.prisma = client;
  }

  async logOnByOpenId(openId) {
    let returnUserInfo = null;
    await this.checkOnLine();
    const logon = await this.prisma.piuserlogon.findFirst({ where: { OPENID: openId } });
    if (!logon) {
      return returnUserInfo;
    }
    const user = await this.prisma.piuser.findUnique({ where: { ID: logon.ID } });
    if (!user) {
      return returnUserInfo;
    }
    returnUserInfo = await this.convertToUserInfo(new UserInfo(), user, logon);
    return returnUserInfo;
  }

  async logOnByUserName(userName) {
    const { returnStatusCode, userInfo } = await this.logOn(userName, null, null, false, null, null, false);
    return { returnStatusCode, userInfo };
  }

  async userLogOn(userName, password, openId, createOpenId, ipAddress) {
    const { returnStatusCode, userInfo } = await this.logOn(
      userName,
      password,
      openId,
      createOpenId,
      ipAddress,
      null,
      true
    );
    return { returnStatusCode, userInfo };
  }

  getEntity(id) {
    return this.prisma.piuserlogon.findUnique({ where: { ID: id } });
  }

  async update(entity) {
    if (!entity?.ID) {
      return false;
    }
    await this.prisma.piuserlogon.update({ where: { ID: entity.ID }, data: entity });
    return true;
  }

  getUserDT() {
    return this.prisma.piuser.findMany({ where: { DELETEMARK: 0 } });
  }

  getStaffUserDT() {
    return this.prisma.piuser.findMany({ where: { DELETEMARK: 0 } });
  }

  async accountActivation(userId, openId) {
    await this.checkOnLine();
    let returnCode = StatusCode.UserNotFound;
    if (!openId) {
      return { returnCode, user: null };
    }
    const user = await this.prisma.piuser.findFirst({ where: { ID: userId, DELETEMARK: 0 } });
    if (!user) {
      return { returnCode, user: null };
    }
    if (user.ENABLED === 0) {
      returnCode = StatusCode.UserLocked;
      return { returnCode, user };
    }
    if (user.ENABLED === 1) {
      returnCode = StatusCode.UserIsActivate;
      return { returnCode, user };
    }
    if (user.ENABLED === -1) {
      await this.prisma.piuser.update({ where: { ID: user.ID }, data: { ENABLED: 1 } });
      returnCode = StatusCode.OK;
      return { returnCode, user: { ...user, ENABLED: 1 } };
    }
    return { returnCode, user };
  }

  async onLine(userId, onLineState = 1) {
    if (!SystemInfo.UpdateVisit) {
      return 0;
    }
    const result = await this.prisma.piuserlogon.updateMany({
      where: { ID: userId },
      data: { USERONLINE: onLineState }
    });
    return result.count;
  }

  async onExit(userId) {
    if (!SystemInfo.UpdateVisit) {
      return 0;
    }
    const logon = await this.prisma.piuserlogon.findUnique({ where: { ID: userId } });
    if (!logon) {
      return 0;
    }
    await this.prisma.piuserlogon.update({
      where: { ID: userId },
      data: {
        PREVIOUSVISIT: logon.LASTVISIT,
        LASTVISIT: new Date(),
        USERONLINE: 0,
        OPENID: uuidv4()
      }
    });
    return 1;
  }

  async serverCheckOnLine() {
    return this.checkOnLine();
  }

  async setPassword(userIds = [], password) {
    let returnValue = 0;
    if (!userIds?.length) {
      return { returnCode: StatusCode.NotFound, returnValue };
    }
    let hashed = password || '';
    if (SystemInfo.EnableEncryptServerPassword) {
      hashed = SecretHelper.aesEncrypt(password || '');
    }
    const enableCheckIPAddress = SystemInfo.EnableCheckIPAddress ? 1 : 0;
    const now = new Date();
    await Promise.all(
      userIds.map(async (id) => {
        await this.prisma.piuserlogon.update({
          where: { ID: id },
          data: {
            CHECKIPADDRESS: enableCheckIPAddress,
            USERPASSWORD: hashed,
            OPENID: uuidv4(),
            USERONLINE: 0,
            CREATEON: now,
            MODIFIEDON: now
          }
        });
        returnValue += 1;
      })
    );
    return { returnCode: StatusCode.SetPasswordOK, returnValue };
  }

  async userIsLogOn(userId) {
    const record = await this.prisma.piuserlogon.findFirst({
      where: { ID: userId, USERONLINE: { gt: 0 } }
    });
    return Boolean(record);
  }

  async lockUser(userName) {
    const user = await this.prisma.piuser.findFirst({
      where: { USERNAME: userName, ENABLED: 1, DELETEMARK: 0 }
    });
    if (!user) {
      return 0;
    }
    const now = new Date();
    const lockEnd = new Date(now.getTime() + SystemInfo.PasswordErrorLockCycle * 60 * 1000);
    const result = await this.prisma.piuserlogon.updateMany({
      where: { ID: user.ID },
      data: { LOCKSTARTDATE: now, LOCKENDDATE: lockEnd }
    });
    return result.count;
  }

  async unLockUser(userName) {
    const user = await this.prisma.piuser.findFirst({
      where: { USERNAME: userName, ENABLED: 1, DELETEMARK: 0 }
    });
    if (!user) {
      return 0;
    }
    const result = await this.prisma.piuserlogon.updateMany({
      where: { ID: user.ID },
      data: { LOCKSTARTDATE: null, LOCKENDDATE: null }
    });
    return result.count;
  }

  async userDimission(userName, dimissionCause, dimissionDate, dimissionWhither) {
    const user = await this.prisma.piuser.findMany({
      where: { USERNAME: userName, ENABLED: 1, DELETEMARK: 0 }
    });
    const count = user.length;
    if (!count) {
      return 0;
    }
    const userId = user[0].ID;
    await this.prisma.piuser.updateMany({
      where: { ID: userId },
      data: {
        ENABLED: 0,
        ISDIMISSION: 1,
        DIMISSIONCAUSE: dimissionCause,
        DIMISSIONWHITHER: dimissionWhither,
        DIMISSIONDATE: dimissionDate
      }
    });
    await this.prisma.piuserlogon.updateMany({
      where: { ID: userId },
      data: { LOCKSTARTDATE: new Date() }
    });
    return count + 1;
  }

  async checkOnLine() {
    if (!SystemInfo.UpdateVisit) {
      return 0;
    }
    const timeout = Number(SystemInfo.OnLineTime0ut || 0);
    const sql = `
      UPDATE piuserlogon
         SET USERONLINE = 0
       WHERE LASTVISIT IS NULL
          OR (USERONLINE > 0 AND LASTVISIT IS NOT NULL AND DATE_ADD(LASTVISIT, INTERVAL ${timeout} SECOND) < NOW())
    `;
    await prisma.$executeRawUnsafe(sql);
    return 0;
  }

  async logOn(userName, password, openId = null, createNewOpenId = false, ipAddress = null, macAddress = null, checkUserPassword = true) {
    let returnStatusCode = StatusCode.DbError;
    let userInfo = new UserInfo();

    if (SystemInfo.OnLineLimit > 0) {
      const limited = await this.checkOnLineLimit();
      if (limited) {
        return { returnStatusCode: StatusCode.ErrorOnLineLimit, userInfo };
      }
    }

    returnStatusCode = SystemInfo.EnableCheckPasswordStrength ? StatusCode.ErrorLogOn : StatusCode.UserNotFound;

    const users = await this.prisma.piuser.findMany({
      where: { DELETEMARK: 0, USERNAME: userName }
    });
    if (!users.length) {
      return { returnStatusCode, userInfo: null };
    }

    if (users.length > 1) {
      return { returnStatusCode: StatusCode.UserDuplicate, userInfo: null };
    }

    const userEntity = users[0];
    if (userEntity.AUDITSTATUS && userEntity.AUDITSTATUS.endsWith(AuditStatus.WaitForAudit)) {
      return { returnStatusCode: AuditStatus.WaitForAudit, userInfo: null };
    }

    if (userEntity.ISDIMISSION === 1 || userEntity.ENABLED === 0) {
      return { returnStatusCode: StatusCode.LogOnDeny, userInfo: null };
    }

    if (userEntity.ENABLED === -1) {
      return { returnStatusCode: StatusCode.UserNotActive, userInfo: null };
    }

    const userLogOnEntity = await this.prisma.piuserlogon.findUnique({ where: { ID: userEntity.ID } });
    if (!userLogOnEntity) {
      return { returnStatusCode: StatusCode.DbError, userInfo: null };
    }

    if (userEntity.USERNAME !== 'Administrator') {
      if (userLogOnEntity.ALLOWSTARTTIME && new Date() < userLogOnEntity.ALLOWSTARTTIME) {
        return { returnStatusCode: StatusCode.UserLocked, userInfo: null };
      }
      if (userLogOnEntity.ALLOWENDTIME && new Date() > userLogOnEntity.ALLOWENDTIME) {
        return { returnStatusCode: StatusCode.UserLocked, userInfo: null };
      }
      if (userLogOnEntity.LOCKSTARTDATE && userLogOnEntity.LOCKENDDATE) {
        const now = new Date();
        if (now > userLogOnEntity.LOCKSTARTDATE && (!userLogOnEntity.LOCKENDDATE || now < userLogOnEntity.LOCKENDDATE)) {
          return { returnStatusCode: StatusCode.UserLocked, userInfo: null };
        }
      }
    }

    if (SystemInfo.EnableCheckIPAddress && userLogOnEntity.CHECKIPADDRESS === 1 && userEntity.USERNAME !== 'Administrator') {
      if (ipAddress && !(await parameterService.exists(userEntity.ID, 'IPAddress'))) {
        const allowed = await checkIPAddressService.checkIPAddress(ipAddress, userEntity.ID);
        if (!allowed) {
          return { returnStatusCode: StatusCode.ErrorIPAddress, userInfo: null };
        }
      }
      if (macAddress && !(await parameterService.exists(userEntity.ID, 'MacAddress'))) {
        const allowed = await checkIPAddressService.checkIPAddress(macAddress, userEntity.ID);
        if (!allowed) {
          return { returnStatusCode: StatusCode.ErrorMacAddress, userInfo: null };
        }
      }
    }

    let encryptedPassword = password || '';
    if (checkUserPassword && SystemInfo.EnableEncryptServerPassword && password) {
      encryptedPassword = SecretHelper.aesEncrypt(password);
    }

    if (checkUserPassword) {
      const storedPassword = userLogOnEntity.USERPASSWORD || '';
      const passwordOK = !storedPassword && !encryptedPassword ? true : storedPassword === encryptedPassword;
      if (!passwordOK) {
        const newErrorCount = (userLogOnEntity.PASSWORDERRORCOUNT || 0) + 1;
        await this.prisma.piuserlogon.update({
          where: { ID: userEntity.ID },
          data: { PASSWORDERRORCOUNT: newErrorCount }
        });
        const code = SystemInfo.EnableCheckPasswordStrength ? StatusCode.ErrorLogOn : StatusCode.PasswordError;
        return { returnStatusCode: code, userInfo: null };
      }
    }

    await this.prisma.piuserlogon.update({
      where: { ID: userEntity.ID },
      data: {
        PASSWORDERRORCOUNT: 0,
        IPADDRESS: ipAddress,
        MACADDRESS: macAddress
      }
    });

    returnStatusCode = StatusCode.OK;
    userInfo = await this.convertToUserInfo(new UserInfo(), userEntity, userLogOnEntity);
    userInfo.IPAddress = ipAddress;
    userInfo.MACAddress = macAddress;
    userInfo.Password = encryptedPassword;
    userInfo.IsAdministrator = userEntity.USERNAME === 'Administrator';

    if (returnStatusCode === StatusCode.OK) {
      if (!userInfo.OpenId || createNewOpenId) {
        userInfo.OpenId = await this.updateVisitDate(userEntity.ID, true);
      } else {
        await this.updateVisitDate(userEntity.ID, false);
      }
    }
    return { returnStatusCode, userInfo };
  }

  async checkOnLineLimit() {
    await this.checkOnLine();
    const count = await this.prisma.piuserlogon.count({ where: { USERONLINE: { gt: 0 } } });
    return SystemInfo.OnLineLimit > 0 && count >= SystemInfo.OnLineLimit;
  }

  async convertToUserInfo(userInfo, userEntity, userLogOnEntity) {
    userInfo.Id = userEntity.ID;
    userInfo.Code = userEntity.CODE;
    userInfo.UserName = userEntity.USERNAME;
    userInfo.CompanyId = userEntity.COMPANYID;
    userInfo.CompanyName = userEntity.COMPANYNAME;
    userInfo.DepartmentId = userEntity.DEPARTMENTID;
    userInfo.DepartmentName = userEntity.DEPARTMENTNAME;
    userInfo.WorkgroupId = userEntity.WORKGROUPID;
    userInfo.WorkgroupName = userEntity.WORKGROUPNAME;
    userInfo.RealName = userEntity.REALNAME;
    userInfo.SecurityLevel = Number(userEntity.SECURITYLEVEL || 0);
    if (userLogOnEntity) {
      userInfo.OpenId = userLogOnEntity.OPENID;
    }
    if (userEntity.ROLEID) {
      userInfo.RoleId = userEntity.ROLEID;
    }
    return userInfo;
  }

  async updateVisitDate(userId, createOpenId = false) {
    const logon = await this.prisma.piuserlogon.findUnique({ where: { ID: userId } });
    if (!logon) {
      return '';
    }
    const now = new Date();
    let newOpenId = logon.OPENID;
    if (SystemInfo.UpdateVisit) {
      if (!logon.FIRSTVISIT) {
        await this.prisma.piuserlogon.update({
          where: { ID: userId },
          data: { FIRSTVISIT: now, USERONLINE: 1 }
        });
      } else {
        const updateData = {
          PREVIOUSVISIT: logon.LASTVISIT,
          LASTVISIT: now,
          LOGONCOUNT: (logon.LOGONCOUNT || 0) + 1,
          USERONLINE: 1
        };
        if (createOpenId) {
          newOpenId = uuidv4();
          updateData.OPENID = newOpenId;
        }
        await this.prisma.piuserlogon.update({
          where: { ID: userId },
          data: updateData
        });
      }
    } else if (createOpenId) {
      newOpenId = uuidv4();
      await this.prisma.piuserlogon.update({
        where: { ID: userId },
        data: { PASSWORDERRORCOUNT: 0, OPENID: newOpenId }
      });
    }
    return newOpenId;
  }

  async changePassword(userId, oldPassword, newPassword) {
    let statusCode = '';
    let returnValue = 0;
    if (SystemInfo.EnableCheckPasswordStrength) {
      if (!newPassword) {
        statusCode = StatusCode.PasswordCanNotBeNull;
        return { statusCode, returnValue };
      }
      if (!ValidateUtil.enableCheckPasswordStrength(newPassword)) {
        statusCode = StatusCode.PasswordNotStrength;
        return { statusCode, returnValue };
      }
    }

    let oldPwd = oldPassword || '';
    let newPwd = newPassword || '';
    if (SystemInfo.EnableEncryptServerPassword) {
      oldPwd = SecretHelper.aesEncrypt(oldPwd);
      newPwd = SecretHelper.aesEncrypt(newPwd);
    }

    const entity = await this.prisma.piuserlogon.findUnique({ where: { ID: userId } });
    if (!entity) {
      return { statusCode: StatusCode.UserNotFound, returnValue: 0 };
    }
    if ((entity.USERPASSWORD || '') !== (oldPwd || '')) {
      return { statusCode: StatusCode.OldPasswordError, returnValue: 0 };
    }
    await this.prisma.piuserlogon.update({
      where: { ID: userId },
      data: { USERPASSWORD: newPwd, CHANGEPASSWORDDATE: new Date() }
    });
    return { statusCode: StatusCode.ChangePasswordOK, returnValue: 1 };
  }

  async getOnLineStateDT() {
    const sql = `
      SELECT id, useronline
        FROM piuserlogon
       WHERE lastvisit IS NOT NULL
         AND DATE_ADD(lastvisit, INTERVAL ${Number(SystemInfo.OnLineTime0ut || 0) + 5} SECOND) > NOW()
    `;
    return db.executeQuery(sql);
  }

  tableName() {
    return 'piuserlogon';
  }
}

module.exports = {
  LogOnService,
  logOnService: new LogOnService()
};
