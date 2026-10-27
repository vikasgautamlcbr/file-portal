'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const config = require('./config');
const memory = require('./memory');
const { FriendSession } = require('./session');

if (!config.accessToken || config.accessToken.length < 12) {
  console.error('FRIEND_ACCESS_TOKEN must be set (at least 12 characters). Devices use it to connect.');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY must be set.');
  process.exit(1);
}

const MAX_SESSIONS = 2;
const sessions = new Set();

function tokenOk(given) {
  if (typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(config.accessToken).digest();
  return crypto.timingSafeEqual(a, b);
}

function requestToken(req, url) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
}

// ---- HTTP: the browser test page and a memory viewer ------------------------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/capture-worklet.js': ['capture-worklet.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }

  if (url.pathname === '/api/memory') {
    if (!tokenOk(requestToken(req, url))) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"Unauthorized"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ facts: memory.list() }));
    return;
  }

  const entry = req.method === 'GET' && STATIC[url.pathname];
  if (entry) {
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache' });
    fs.createReadStream(path.join(PUBLIC_DIR, entry[0])).pipe(res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
});

// ---- WebSocket: one connection = one conversation ---------------------------
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' || !tokenOk(requestToken(req, url))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (sessions.size >= MAX_SESSIONS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const label = `${url.searchParams.get('device') || 'device'}-${crypto.randomBytes(2).toString('hex')}`;
    const session = new FriendSession(ws, label);
    sessions.add(session);
    session.onEnd = () => sessions.delete(session);
    session.log('connected');
    session.start().catch((err) => session.fail(err));
  });
});

server.listen(config.port, () => {
  console.log(
    `${config.friendName} is listening on port ${config.port} ` +
      `(model ${config.realtimeModel}, voice ${config.voice}, ${memory.list().length} memories)`,
  );
});
