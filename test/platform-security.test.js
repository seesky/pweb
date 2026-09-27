'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _testing } = require('../services/management/platform_service');

test('CIDR matching supports IPv4 and IPv6 and rejects missing addresses', () => {
  assert.equal(_testing.ipMatchesRule('10.20.30.40', '10.20.0.0/16'), true);
  assert.equal(_testing.ipMatchesRule('10.21.30.40', '10.20.0.0/16'), false);
  assert.equal(_testing.ipMatchesRule('::ffff:192.0.2.5', '192.0.2.0/24'), true);
  assert.equal(_testing.ipMatchesRule('2001:db8::42', '2001:db8::/32'), true);
  assert.equal(_testing.ipMatchesRule('', '0.0.0.0/0'), false);
  assert.equal(_testing.ipMatchesRule('192.0.2.5', 'not-a-cidr'), false);
});
