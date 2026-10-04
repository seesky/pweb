const { randomBytes } = require('crypto');

// Reservations cover both connecting and connected sessions. Serialize requests
// per agent, including the asynchronous teardown, so contenders cannot race.
class ControlSessions {
  constructor() {
    this.sessions = new Map();
    this.queues = new Map();
    this.challenges = new Map();
  }

  async run(target, work) {
    const previous = this.queues.get(target) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.queues.set(target, next);
    try { return await next; }
    finally { if (this.queues.get(target) === next) this.queues.delete(target); }
  }

  async acquire(target, client, sessionId, token, disconnect) {
    const old = this.sessions.get(target);
    if (old && old.client === client && old.sessionId === sessionId) {
      return { success: true, duplicate: true };
    }
    if (old) {
      const now = Date.now();
      for (const [key, value] of this.challenges) {
        if (value.expiresAt <= now) this.challenges.delete(key);
      }
      const challenge = this.challenges.get(token);
      this.challenges.delete(token);
      if (!challenge || challenge.target !== target || challenge.client !== client ||
          challenge.sessionId !== sessionId || challenge.old !== old) {
        const takeoverToken = randomBytes(24).toString('hex');
        this.challenges.set(takeoverToken, {
          target, client, sessionId, old, expiresAt: now + 120000
        });
        return { success: false, code: 'AGENT_BUSY', takeoverToken,
          message: 'Agent is already controlled by another session' };
      }
      try { await disconnect(old); }
      catch (error) {
        return { success: false, code: 'TAKEOVER_FAILED', message: error.message };
      }
    }
    this.sessions.set(target, { target, client, sessionId, createdAt: Date.now(), connected: false });
    return { success: true };
  }

  release(target, client, sessionId) {
    const current = this.sessions.get(target);
    if (current && current.client === client && current.sessionId === sessionId) {
      this.sessions.delete(target);
    }
  }

  releaseTerminal(terminal) {
    for (const session of this.sessions.values()) {
      if (session.target === terminal || session.client === terminal) {
        this.release(session.target, session.client, session.sessionId);
      }
    }
  }

  markConnected(a, b) {
    for (const session of this.sessions.values()) {
      if ((session.target === a && session.client === b) ||
          (session.target === b && session.client === a)) session.connected = true;
    }
  }

  expirePending() {
    for (const [token, challenge] of this.challenges) {
      if (challenge.expiresAt <= Date.now()) this.challenges.delete(token);
    }
    for (const session of this.sessions.values()) {
      if (!session.connected && session.createdAt < Date.now() - 120000) {
        this.release(session.target, session.client, session.sessionId);
      }
    }
  }
}

module.exports = ControlSessions;
