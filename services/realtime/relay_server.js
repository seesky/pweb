'use strict';

// Parsec-style custom UDP session relay (NOT standard TURN).
//
// Parsec's relay is a custom authenticated UDP forwarder (the decompiled client
// negotiates offer_relay/answer_relay with ice creds + aes256 and then tunnels
// its already-encrypted media stream through it). We reproduce that with a tiny
// session relay: two peers (client + agent) that share a one-time token BIND to
// the relay over UDP; the relay learns each peer's public address and forwards
// DATA packets between them. The relay never decrypts payloads — the tunnelled
// QUIC stream stays end-to-end encrypted, so the relay is a blind forwarder.
//
// Wire format (relay <-> peer), little-endian header, 24 bytes:
//   [0..3]  magic "PRLY" (0x50 0x52 0x4C 0x59)
//   [4]     version (1)
//   [5]     type (1=BIND, 2=DATA, 3=KEEPALIVE)
//   [6]     role (0=client, 1=agent)
//   [7]     reserved (0)
//   [8..23] token (16 bytes)
//   [24..]  payload (DATA only) — the opaque tunnelled datagram

const dgram = require('node:dgram');

const MAGIC0 = 0x50, MAGIC1 = 0x52, MAGIC2 = 0x4c, MAGIC3 = 0x59; // "PRLY"
const VERSION = 1;
const HEADER_LEN = 24;
const TYPE_BIND = 1;
const TYPE_DATA = 2;
const TYPE_KEEPALIVE = 3;

const ROLE_CLIENT = 0;
const ROLE_AGENT = 1;

const SESSION_IDLE_MS = 60 * 1000;

function tokenHex(buf) {
  return buf.toString('hex');
}

class RelayServer {
  constructor(options = {}) {
    this.port = options.port || Number(process.env.RELAY_UDP_PORT || 3479);
    this.host = options.host || process.env.RELAY_UDP_HOST || '0.0.0.0';
    // token(hex) -> { client: {address,port,lastSeen}, agent: {...}, createdAt, authorized }
    this.sessions = new Map();
    this.socket = null;
    this._gcTimer = null;
  }

  // Authorize a token for relaying (called by the socket.io signaling layer when
  // it allocates a relay session for a client/agent pair).
  authorizeSession(tokenHexStr) {
    let s = this.sessions.get(tokenHexStr);
    if (!s) {
      s = { client: null, agent: null, createdAt: Date.now(), authorized: true };
      this.sessions.set(tokenHexStr, s);
    } else {
      s.authorized = true;
      s.createdAt = Date.now();
    }
    return s;
  }

  revokeSession(tokenHexStr) {
    this.sessions.delete(tokenHexStr);
  }

  start() {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
      console.error('[relay] socket error:', err && err.message);
    });
    this.socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo));
    this.socket.on('listening', () => {
      const a = this.socket.address();
      console.log(`[relay] UDP session relay listening on ${a.address}:${a.port}`);
    });
    this.socket.bind(this.port, this.host);

    this._gcTimer = setInterval(() => this._gc(), 30 * 1000);
    if (this._gcTimer.unref) this._gcTimer.unref();
    return this;
  }

  stop() {
    if (this._gcTimer) clearInterval(this._gcTimer);
    if (this.socket) this.socket.close();
  }

  _gc() {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [token, s] of this.sessions.entries()) {
      const clientSeen = s.client ? s.client.lastSeen : s.createdAt;
      const agentSeen = s.agent ? s.agent.lastSeen : s.createdAt;
      if (Math.max(clientSeen, agentSeen, s.createdAt) < cutoff) {
        this.sessions.delete(token);
      }
    }
  }

  _onMessage(msg, rinfo) {
    if (msg.length < HEADER_LEN) return;
    if (msg[0] !== MAGIC0 || msg[1] !== MAGIC1 || msg[2] !== MAGIC2 || msg[3] !== MAGIC3) return;
    if (msg[4] !== VERSION) return;
    const type = msg[5];
    const role = msg[6];
    const token = tokenHex(msg.subarray(8, 24));

    const session = this.sessions.get(token);
    if (!session || !session.authorized) {
      // Unknown/unauthorized token — ignore (anti-abuse).
      return;
    }

    const peerEntry = { address: rinfo.address, port: rinfo.port, lastSeen: Date.now() };

    if (type === TYPE_BIND || type === TYPE_KEEPALIVE) {
      const firstBind = type === TYPE_BIND &&
        ((role === ROLE_CLIENT && !session.client) || (role === ROLE_AGENT && !session.agent));
      if (role === ROLE_CLIENT) session.client = peerEntry;
      else if (role === ROLE_AGENT) session.agent = peerEntry;
      if (firstBind) {
        console.log(`[relay] BIND ${role === ROLE_CLIENT ? 'client' : 'agent'} ` +
          `from ${rinfo.address}:${rinfo.port} token=${token.slice(0, 8)}.. ` +
          `(client=${!!session.client} agent=${!!session.agent})`);
      }
      if (type === TYPE_BIND) {
        // Echo a BIND back so the peer confirms the relay path is open.
        const ack = Buffer.from(msg.subarray(0, HEADER_LEN));
        this.socket.send(ack, rinfo.port, rinfo.address);
      }
      return;
    }

    if (type === TYPE_DATA) {
      // Refresh sender mapping, forward payload to the other role.
      const dest = role === ROLE_CLIENT ? session.agent : session.client;
      if (role === ROLE_CLIENT) session.client = peerEntry;
      else if (role === ROLE_AGENT) session.agent = peerEntry;
      if (!dest) return; // other side not bound yet
      // Re-wrap with the destination's view: keep token, mark sender role.
      // The receiver strips HEADER_LEN to recover the tunnelled datagram.
      this.socket.send(msg, dest.port, dest.address);
    }
  }
}

module.exports = { RelayServer, ROLE_CLIENT, ROLE_AGENT };
