'use strict';

class DefaultRole {
  static Config = 'Config'; // 系统配置员
  static Administrator = 'Administrator'; // 系统管理员
  static Administrators = 'Administrators'; // 系统管理组
  static ChairmanOfTheBoard = 'ChairmanOfTheBoard'; // 董事长
  static VicePrecident = 'VicePrecident'; // 副总裁
  static GeneralManager = 'GeneralManager'; // 总经理
  static ViceManager = 'ViceManager'; // 副经理
  static Minister = 'Minister'; // 部长
  static ViceMinsiter = 'ViceMinsiter'; // 副部长
  static HumanResourceManager = 'HumanResourceManager'; // 人力资源主管
  static HumanResource = 'HumanResource'; // 人力资源
  static FinanceManager = 'FinanceManager'; // 财务人员
  static Finance = 'Finance'; // 财务人员
  static EquipmentManager = 'EquipmentManager'; // 设备管理主管
  static Equipment = 'Equipment'; // 设备管理人员
  static Staff = 'Staff'; // 普通员工
  static User = 'User'; // 普通用户
}

module.exports = DefaultRole;
