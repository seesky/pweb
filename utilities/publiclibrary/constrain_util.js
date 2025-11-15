'use strict';

const ParameterReference = [
  '当前用户主键：用户主键（CurrentUserId）',
  '当前用户编号：用户编号（CurrentUserCode）',
  '当前用户名：用户名（CurrentUserName）',
  '当前用户姓名：用户姓名（CurrentRealName）',
  '所在公司主键：公司主键（CurrentCompanyId）',
  '所在公司名称：公司名称（CurrentCompanyName）',
  '所在公司编号：公司编号（CurrentCompanyCode）',
  '所在部门主键：部门主键（CurrentDepartmentId）',
  '所在部门名称：部门名称（CurrentDepartmentName）',
  '所在部门编号：部门编号（CurrentDepartmentCode）',
  '所在工作组主键：工作组主键（CurrentWorkgroupId）',
  '所在工作组名称：工作组名称（CurrentWorkgroupName）',
  '所在工作组编号：工作组编号（CurrentWorkgroupCode）'
].join('\\\n');

class ConstrainUtil {
  static ParameterReference = ParameterReference;

  static prepareParameter(userInfo = {}, constraint = '') {
    if (!constraint) {
      return '';
    }

    const map = {
      用户主键: userInfo.Id,
      CurrentUserId: userInfo.Id,
      用户编号: userInfo.Code,
      CurrentUserCode: userInfo.Code,
      用户名: userInfo.UserName,
      CurrentUserName: userInfo.UserName,
      用户姓名: userInfo.RealName,
      CurrentRealName: userInfo.RealName,
      公司主键: userInfo.CompanyId,
      CurrentCompanyId: userInfo.CompanyId,
      公司编号: userInfo.CompanyCode,
      CurrentCompanyCode: userInfo.CompanyCode,
      公司名称: userInfo.CompanyName,
      CurrentCompanyName: userInfo.CompanyName,
      部门主键: userInfo.DepartmentId,
      CurrentDepartmentId: userInfo.DepartmentId,
      部门编号: userInfo.DepartmentCode,
      CurrentDepartmentCode: userInfo.DepartmentCode,
      部门名称: userInfo.DepartmentName,
      CurrentDepartmentName: userInfo.DepartmentName,
      工作组主键: userInfo.WorkgroupId,
      CurrentWorkgroupId: userInfo.WorkgroupId,
      工作组编号: userInfo.WorkgroupCode,
      CurrentWorkgroupCode: userInfo.WorkgroupCode,
      工作组名称: userInfo.WorkgroupName,
      CurrentWorkgroupName: userInfo.WorkgroupName
    };

    let result = constraint;
    Object.entries(map).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        result = result.split(key).join(String(value));
      }
    });
    return result;
  }
}

module.exports = ConstrainUtil;
