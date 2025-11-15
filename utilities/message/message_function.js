'use strict';

class MessageFunction {
  static Message = '0'; // 0 消息
  static Remind = '1'; // 1 提示
  static Warning = '2'; // 2 警示
  static WaitForAudit = '3'; // 3 待审核事项
  static Comment = '4'; // 4 评论
  static TodoList = '5'; // 5 待审核
  static Note = '6'; // 6 备忘录
  static UserMessage = '7'; // 7 用户信息
  static RoleMessage = '8'; // 8 角色信息
  static OrganizeMessage = '9'; // 9 组织机构信息
  static SystemPush = '10'; // 10 系统推送
}

module.exports = MessageFunction;
