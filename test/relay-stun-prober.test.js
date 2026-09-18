'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { probeReachable } = require('../services/realtime/relay_stun_prober');

const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];

test('UDP failure is not treated as online through TCP by default', async () => {
  let tcpCalls = 0;
  const result = await probeReachable('relay.example.com', 3478, 10, {
    lookup: publicLookup,
    probeUdp: async () => ({ ok: false, rttMs: null }),
    probeTcp: async () => { tcpCalls += 1; return { ok: true, rttMs: 1 }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'udp_unreachable');
  assert.equal(tcpCalls, 0);
});

test('TCP fallback remains available only when explicitly requested', async () => {
  const result = await probeReachable('relay.example.com', 3478, 10, {
    lookup: publicLookup,
    allowTcpFallback: true,
    probeUdp: async () => ({ ok: false, rttMs: null }),
    probeTcp: async () => ({ ok: true, rttMs: 2 })
  });
  assert.deepEqual(result, { ok: true, rttMs: 2 });
});

test('private relay target is rejected before any network probe', async () => {
  let probeCalls = 0;
  const result = await probeReachable('relay.example.com', 3478, 10, {
    lookup: async () => [{ address: '10.0.0.8', family: 4 }],
    probeUdp: async () => { probeCalls += 1; return { ok: true, rttMs: 1 }; }
  });
  assert.equal(result.reason, 'host_not_allowed');
  assert.equal(probeCalls, 0);
});
