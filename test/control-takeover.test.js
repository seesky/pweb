'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ControlSessions = require('../services/realtime/control_sessions');

const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the production socket handlers without Redis/MySQL or network ports.
async function fixture(options = {}) {
  const denied = new Set();
  const completed = [];
  const intervals = [];
  let id = 0;
  class FakeIO {
    constructor() { this.sockets = { sockets: new Map() }; this.handlers = new Map(); }
    use() {}
    on(event, fn) { this.handlers.set(event, fn); }
    to(sid) { return { emit: (event, value) => {
      const socket = this.sockets.sockets.get(sid);
      if (socket) socket.messages.push({ event, value });
    } }; }
  }
  class Presence {
    async clearAllEndpoints() {}
    async addEndpoint() {}
    async getEndpointsByUser() { return []; }
    async getEndpointsByTerminal() { return []; }
    async removeBySocket() {}
    async getEndpoint() { return { os: 'Windows' }; }
  }
  class Assistance {
    async clearAllPartners() {}
    async removeByTerminal() {}
    async consumeGrant() { return null; }
  }
  const platform = new Proxy({
    isAuthorized: async ({ controllerUserId }) => ({ allowed: !denied.has(controllerUserId), reason: 'DENIED' }),
    createSession: async () => `db-${++id}`,
    completeSession: async (...args) => { completed.push(args); },
    completeActiveSessionsBetween: async () => [],
    completeActiveSessionsForTerminal: async () => [],
    listTenantsForUser: async () => [],
    getDeviceByTerminal: async () => ({ os: 'Windows' }),
    findActiveSession: async () => null
  }, { get: (object, key) => object[key] || (async () => {}) });
  const imports = {
    'socket.io': { Server: FakeIO },
    '@prisma/client': { PrismaClient: class { constructor() {
      this.poleis_device = { findFirst: async () => ({ TENANTID: 'test' }) };
    } } },
    './token_service': { SocketTokenService: class {} },
    './presence_service': { PresenceService: Presence },
    './audit_service': { AuditService: class { log() {} } },
    './assistance_service': { AssistanceService: Assistance },
    '../management/platform_service': { platformService: platform, classifyDeviceOs: () => 'pc' },
    '../management/tenant_context': { resolveTenantId: async () => null },
    './relay_registry': { relayRegistry: { allocateForPair: async () => null, listForProbe: async () => [] } },
    './socket_control': { registerForceDisconnect() {} },
    './control_sessions': ControlSessions
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../services/realtime/socket_server.js'), 'utf8');
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => imports[name] || require(name),
    process, console: { log() {}, error() {} },
    setTimeout: (fn, delay) => setTimeout(fn, delay === 10000 && options.fastTimeout ? 10 : delay), clearTimeout,
    setInterval: fn => { intervals.push(fn); return { unref() {} }; },
    clearInterval() {}
  });
  const io = module.exports.buildSocketServer({});
  const connect = async terminal => {
    const socket = {
      id: terminal, data: { terminalId: terminal, userId: terminal },
      handshake: { headers: {}, address: '127.0.0.1' },
      handlers: new Map(), messages: [], join() {},
      on(event, fn) { this.handlers.set(event, fn); },
      emit(event, value) { this.messages.push({ event, value }); }
    };
    io.sockets.sockets.set(socket.id, socket);
    await io.handlers.get('connection')(socket);
    return socket;
  };
  const old = await connect('old');
  const next = await connect('next');
  const agent = await connect('agent');
  const request = (socket, event, payload) => new Promise((resolve, reject) => {
    Promise.resolve(socket.handlers.get(event)(payload, resolve)).catch(reject);
  });
  const nat = (socket, sessionId, takeoverToken) => request(socket, 'poleis_nat_connect_request', {
    toTerminalId: 'agent', sessionId, takeoverToken
  });
  const messages = (socket, type) => socket.messages.filter(m => m.value.payload?.type === type);
  return { io, old, next, agent, request, nat, denied, completed, intervals, messages };
}

test('busy request preserves old session; confirmation waits for agent teardown before new request', async () => {
  const f = await fixture();
  assert.equal((await f.nat(f.old, 'session-old')).success, true);
  const busy = await f.nat(f.next, 'session-new');
  assert.equal(busy.code, 'AGENT_BUSY');
  assert.equal(f.messages(f.agent, 'POLEIS_NAT_CONNECT_REQUEST').length, 1);
  assert.equal(f.messages(f.old, 'POLEIS_DISCONNECT').length, 0);
  let finished = false;
  const takeover = f.nat(f.next, 'session-new', busy.takeoverToken).then(r => { finished = true; return r; });
  await tick();
  const disconnect = f.messages(f.agent, 'POLEIS_DISCONNECT').at(-1).value.payload;
  assert.equal(disconnect.fromTerminalId, 'old');
  assert.equal(disconnect.sessionId, 'session-old');
  assert.equal(f.messages(f.old, 'POLEIS_DISCONNECT').length, 1);
  assert.equal(finished, false);
  f.next.handlers.get('poleis_takeover_ready')(disconnect);
  await tick();
  assert.equal(finished, false, 'a controller cannot acknowledge for the agent');
  f.agent.handlers.get('poleis_takeover_ready')(disconnect);
  assert.equal((await takeover).success, true);
  assert.equal(f.messages(f.agent, 'POLEIS_NAT_CONNECT_REQUEST').length, 2);
  assert.equal(f.completed[0][1], 'ended');
  const stale = await f.request(f.old, 'poleis_disconnect', { toTerminalId: 'agent', sessionId: 'session-old' });
  assert.equal(stale.success, false);
  assert.equal(f.messages(f.agent, 'POLEIS_DISCONNECT').length, 1);
  assert.equal((await f.nat(f.old, 'old-retry')).code, 'AGENT_BUSY');
});

test('takeover rechecks permission and binds confirmation to controller, target and session', async () => {
  const f = await fixture();
  await f.nat(f.old, 'old');
  const busy = await f.nat(f.next, 'new');
  const wrongSession = await f.nat(f.next, 'different', busy.takeoverToken);
  assert.equal(wrongSession.code, 'AGENT_BUSY');
  assert.equal(f.messages(f.old, 'POLEIS_DISCONNECT').length, 0);
  f.denied.add('next');
  const denied = await f.nat(f.next, 'different', wrongSession.takeoverToken);
  assert.equal(denied.message, 'DENIED');
  assert.equal(f.messages(f.old, 'POLEIS_DISCONNECT').length, 0);
});

test('connected sessions survive pending-session expiry and release on normal disconnect', async () => {
  const f = await fixture();
  await f.nat(f.old, 'old');
  await f.request(f.old, 'poleis_connected', { toTerminalId: 'agent' });
  const original = Date.now;
  Date.now = () => original() + 180000;
  try { for (const run of f.intervals) run(); }
  finally { Date.now = original; }
  assert.equal((await f.nat(f.next, 'new')).code, 'AGENT_BUSY');
  assert.equal((await f.request(f.old, 'poleis_disconnect', { toTerminalId: 'agent', sessionId: 'old' })).success, true);
  assert.equal((await f.nat(f.next, 'new')).success, true);
});

test('concurrent confirmed requests serialize; the second confirmation cannot displace the replacement', async () => {
  const controls = new ControlSessions();
  await controls.acquire('agent', 'old', 'old', null, () => {});
  const first = await controls.acquire('agent', 'a', 'a', null, () => {});
  const second = await controls.acquire('agent', 'b', 'b', null, () => {});
  let ready;
  const teardown = new Promise(resolve => { ready = resolve; });
  const a = controls.run('agent', () => controls.acquire('agent', 'a', 'a', first.takeoverToken, () => teardown));
  const b = controls.run('agent', () => controls.acquire('agent', 'b', 'b', second.takeoverToken, () => assert.fail('stale confirmation')));
  await tick();
  assert.equal(controls.sessions.get('agent').client, 'old');
  ready();
  assert.equal((await a).success, true);
  assert.equal((await b).code, 'AGENT_BUSY');
  controls.release('agent', 'old', 'old');
  assert.equal(controls.sessions.get('agent').client, 'a');
});

test('failed teardown leaves the agent busy and expired confirmations do not disconnect it', async () => {
  const controls = new ControlSessions();
  await controls.acquire('agent', 'old', 'old', null, () => {});
  const busy = await controls.acquire('agent', 'new', 'new', null, () => {});
  controls.challenges.get(busy.takeoverToken).expiresAt = 0;
  assert.equal((await controls.acquire('agent', 'new', 'new', busy.takeoverToken, () => assert.fail())).code, 'AGENT_BUSY');
  const retry = await controls.acquire('agent', 'new', 'new', null, () => {});
  assert.equal((await controls.acquire('agent', 'new', 'new', retry.takeoverToken, () => { throw new Error('timeout'); })).code, 'TAKEOVER_FAILED');
  assert.equal(controls.sessions.get('agent').client, 'old');
});

test('agent without teardown acknowledgement reports failure and stays reserved', async () => {
  const f = await fixture({ fastTimeout: true });
  await f.nat(f.old, 'old');
  await f.request(f.old, 'poleis_connected', { toTerminalId: 'agent' });
  const busy = await f.nat(f.next, 'new');
  const result = await f.nat(f.next, 'new', busy.takeoverToken);
  assert.equal(result.code, 'TAKEOVER_FAILED');
  assert.equal(f.messages(f.agent, 'POLEIS_NAT_CONNECT_REQUEST').length, 1);
  assert.equal((await f.nat(f.next, 'retry')).code, 'AGENT_BUSY');
});

test('legacy sessions also reserve the agent and host rejection with NAT session id releases it', async () => {
  const f = await fixture();
  assert.equal((await f.request(f.old, 'poleis_connect_request', { toTerminalId: 'agent' })).success, true);
  assert.equal((await f.nat(f.next, 'new')).code, 'AGENT_BUSY');
  assert.equal((await f.request(f.agent, 'poleis_disconnect', { toTerminalId: 'old' })).success, true);
  assert.equal((await f.nat(f.next, 'new')).success, true);
  assert.equal((await f.request(f.agent, 'poleis_disconnect', { toTerminalId: 'next', sessionId: 'new' })).success, true);
  assert.equal((await f.nat(f.old, 'old-new')).success, true);
});

test('old session disconnect and NAT refresh cannot end a replacement from the same controller', async () => {
  const f = await fixture();
  await f.nat(f.old, 'old');
  const busy = await f.nat(f.old, 'replacement');
  const takeover = f.nat(f.old, 'replacement', busy.takeoverToken);
  await tick();
  const message = f.messages(f.agent, 'POLEIS_DISCONNECT').at(-1).value.payload;
  f.agent.handlers.get('poleis_takeover_ready')(message);
  assert.equal((await takeover).success, true);
  assert.equal((await f.request(f.old, 'poleis_disconnect', { toTerminalId: 'agent', sessionId: 'old' })).success, false);
  assert.equal((await f.request(f.old, 'poleis_nat_info', { toTerminalId: 'agent', sessionId: 'old', nat: '{}' })).success, false);
  assert.equal((await f.request(f.old, 'poleis_nat_info', { toTerminalId: 'agent', sessionId: 'replacement', nat: '{}' })).success, true);
  assert.equal((await f.nat(f.next, 'third')).code, 'AGENT_BUSY');
});
