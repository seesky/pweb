'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function normalizeRelayHost(value) {
  let host = String(value || '').trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

function isValidRelayHostSyntax(value) {
  const host = normalizeRelayHost(value);
  if (!host || host.length > 200 || /\s/.test(host)) return false;
  if (host.includes('://') || host.includes('/') || host.includes('\\') || host.includes('@')) return false;
  if (net.isIP(host)) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.length > 253 || !/^[a-z0-9.-]+$/i.test(host)) return false;
  const labels = host.split('.');
  return labels.every((label) => label && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function ipv4Number(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inV4Range(value, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (ipv4Number(base) & mask);
}

function isPublicIpv4(address) {
  const value = ipv4Number(address);
  if (value == null) return false;
  const blocked = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
  ];
  return !blocked.some(([base, prefix]) => inV4Range(value, base, prefix));
}

function isPublicIpv6(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (!value || value === '::' || value === '::1') return false;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    return net.isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  if (/^(fc|fd)/.test(value) || /^fe[89ab]/.test(value) || value.startsWith('ff')) return false;
  if (value.startsWith('2001:db8:') || value === '2001:db8::') return false;
  return net.isIP(value) === 6;
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function resolveRelayProbeTarget(host, options = {}) {
  const normalized = normalizeRelayHost(host);
  if (!isValidRelayHostSyntax(normalized)) throw new Error('invalid relay host');
  const allowPrivate = options.allowPrivate ?? envBool('RELAY_ALLOW_PRIVATE_HOSTS', false);
  const lookup = options.lookup || dns.lookup;
  const literalFamily = net.isIP(normalized);
  let records = literalFamily
    ? [{ address: normalized, family: literalFamily }]
    : await lookup(normalized, { all: true, verbatim: true });
  records = (records || []).filter((record) => record && net.isIP(record.address));
  if (!allowPrivate) records = records.filter((record) => isPublicAddress(record.address));
  // Current Poleis TURN clients and the health prober use UDP/IPv4.
  const ipv4 = records.find((record) => Number(record.family) === 4 || net.isIP(record.address) === 4);
  if (!ipv4) throw new Error('relay host has no permitted public IPv4 address');
  return { host: normalized, address: ipv4.address, family: 4 };
}

module.exports = {
  normalizeRelayHost,
  isValidRelayHostSyntax,
  isPublicAddress,
  resolveRelayProbeTarget
};
