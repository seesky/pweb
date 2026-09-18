'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidRelayHostSyntax,
  isPublicAddress,
  resolveRelayProbeTarget
} = require('../services/realtime/relay_host_policy');

test('relay host syntax accepts hostnames and rejects URL-like or local input', () => {
  assert.equal(isValidRelayHostSyntax('relay.example.com'), true);
  assert.equal(isValidRelayHostSyntax('203.0.113.9'), true);
  assert.equal(isValidRelayHostSyntax('https://relay.example.com'), false);
  assert.equal(isValidRelayHostSyntax('relay.example.com/path'), false);
  assert.equal(isValidRelayHostSyntax('localhost'), false);
});

test('public address policy blocks private, loopback and documentation ranges', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('10.0.0.1'), false);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('169.254.1.1'), false);
  assert.equal(isPublicAddress('203.0.113.10'), false);
  assert.equal(isPublicAddress('::1'), false);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
});

test('resolver selects a permitted public IPv4 address', async () => {
  const result = await resolveRelayProbeTarget('relay.example.com', {
    lookup: async () => [
      { address: '10.0.0.2', family: 4 },
      { address: '8.8.4.4', family: 4 }
    ]
  });
  assert.deepEqual(result, { host: 'relay.example.com', address: '8.8.4.4', family: 4 });
});

test('resolver rejects private-only DNS unless explicitly enabled', async () => {
  const lookup = async () => [{ address: '192.168.1.20', family: 4 }];
  await assert.rejects(resolveRelayProbeTarget('relay.example.com', { lookup }), /no permitted public IPv4/);
  const result = await resolveRelayProbeTarget('relay.example.com', { lookup, allowPrivate: true });
  assert.equal(result.address, '192.168.1.20');
});
