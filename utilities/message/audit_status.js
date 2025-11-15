'use strict';

class AuditStatus {
  static Draft = 0; // 00 草稿状态
  static StartAudit = 1; // 01 开始审核
  static AuditPass = 2; // 02 审核通过
  static WaitForAudit = 3; // 03 待审核
  static Transit = 4; // 04 转发
  static AuditReject = 5; // 05 已退回
  static AuditComplete = 6; // 06 审核结束
  static AuditQuash = 7; // 07 撤销,废弃
}

module.exports = AuditStatus;
