'use strict';

// 进程内桥接：让 HTTP 控制器（managementPlatformController）能调用 socket.io 层的
// 能力（如管理员强制断开会话）。socket_server 在启动时 register 真正的实现；
// 在 socket 服务未就绪时调用返回 SOCKET_UNAVAILABLE，不抛错。
let forceDisconnectImpl = null;

module.exports = {
  registerForceDisconnect(fn) {
    forceDisconnectImpl = fn;
  },
  async forceDisconnectSession(sessionId) {
    if (typeof forceDisconnectImpl !== 'function') {
      return { ok: false, reason: 'SOCKET_UNAVAILABLE' };
    }
    return forceDisconnectImpl(sessionId);
  }
};
