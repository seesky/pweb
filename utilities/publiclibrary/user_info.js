'use strict';

const SystemInfo = require('./system_info');
const MachineInfoHelper = require('./machine_info_helper');

class UserInfo {
  constructor() {
    this.Id = '';
    this.UserName = '';
    this.RealName = '';
    this.CompanyId = '';
    this.ServicePassword = SystemInfo.ServicePassword;
    this.ServiceUsername = SystemInfo.ServiceUserName;
    this.RoleId = '';
    this.WorkgroupId = '';
    this.SubCompanyId = '';
    this.CurrentLanguage = SystemInfo.CurrentLanguage;
    this.Themes = SystemInfo.Themes;
    this.IPAddress = null;
    this.MACAddress = null;
    this.OpenId = '';
    this.TargetUserId = '';
    this.StaffId = '';
    this.Code = '';
    this.CompanyCode = '';
    this.CompanyName = '';
    this.SubCompanyName = '';
    this.SubCompanyCode = '';
    this.DepartmentId = '';
    this.DepartmentCode = '';
    this.DepartmentName = '';
    this.WorkgroupCode = '';
    this.WorkgroupName = '';
    this.SecurityLevel = 0;
    this.RoleName = '';
    this.IsAdministrator = '';
    this.Password = '';
    this.ProcessName = '';
    this.ProcessId = '';
    this.LastVisit = '';

    this.initializeMachineInfo();
  }

  async initializeMachineInfo() {
    // NOTE: Only machine/network fields may be populated here. Never assign
    // user-identity fields (Id / RealName): this method runs asynchronously and
    // is NOT awaited by the constructor, so any write here lands *after* callers
    // have set the real per-user identity — clobbering it. Writing the server
    // hostname into `Id` previously collapsed every logged-in user onto the same
    // identity (the server's hostname), leaking all users' devices into each
    // other's device list. Keep this limited to IP/MAC.
    this.IPAddress = await MachineInfoHelper.getIPAddress();
    this.MACAddress = MachineInfoHelper.getMacAddress();
  }

  static objToJson(obj) {
    const fields = [
      'Id',
      'UserName',
      'RealName',
      'CompanyId',
      'ServicePassword',
      'ServiceUsername',
      'RoleId',
      'WorkgroupId',
      'SubCompanyId',
      'CurrentLanguage',
      'Themes',
      'IPAddress',
      'MACAddress',
      'OpenId',
      'TargetUserId',
      'StaffId',
      'Code',
      'CompanyCode',
      'CompanyName',
      'SubCompanyName',
      'SubCompanyCode',
      'DepartmentId',
      'DepartmentCode',
      'DepartmentName',
      'WorkgroupCode',
      'WorkgroupName',
      'SecurityLevel',
      'RoleName',
      'IsAdministrator',
      'Password',
      'ProcessName',
      'ProcessId',
      'LastVisit'
    ];
    return fields.reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
  }

  static jsonToObj(data = {}) {
    const userInfo = new UserInfo();
    Object.keys(data).forEach((key) => {
      if (key in userInfo) {
        userInfo[key] = data[key];
      }
    });
    return userInfo;
  }
}

module.exports = UserInfo;
