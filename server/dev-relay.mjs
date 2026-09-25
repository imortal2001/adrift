// ── The relay, on this machine ───────────────────────────────────────────────
// A stand-in for the Cloudflare Worker while developing: the same Room
// (room.js) over a WebSocket server written here, with nothing to install —
// just Node.
//
//   node server/dev-relay.mjs [port]         ws://localhost:8787/room/<code>
//
// The game connects to it when it is served from localhost (src/net.js).
// Only what the game needs of WebSockets is here: text frames, ping, close.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Room } from './room.js';

// Each room's world is kept in a file here, so it lasts across restarts too.
const WORLDS = path.join(path.dirname(new URL(import.meta.url).pathname), 'worlds');
function fileStore(code) {
  const file = path.join(WORLDS, `${code}.json`);
  let data = null, writing = null;
  const read = () => {
    if (!data) { try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; } }
    return data;
  };
  return {
    get: async key => read()[key] ?? null,
    put: async (key, text) => {
      read()[key] = text;
      clearTimeout(writing);
      writing = setTimeout(() => {
        fs.mkdirSync(WORLDS, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
      }, 300);
    },
  };
}

const PORT = Number(process.argv[2]) || 8787;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CODE = /^\/room\/([A-Za-z0-9]{4,12})$/;
const rooms = new Map();

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Adrift dev relay. Connect a WebSocket to /room/<code>.\n');
});

server.on('upgrade', (req, socket) => {
  const m = (req.url || '').split('?')[0].match(CODE);
  const key = req.headers['sec-websocket-key'];
  if (!m || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const code = m[1].toUpperCase();
  if (!rooms.has(code)) rooms.set(code, new Room(fileStore(code)));
  const room = rooms.get(code);
  let open = true;
  const send = text => { if (open) socket.write(frame(1, Buffer.from(text))); };
  const close = () => { if (open) { open = false; socket.end(frame(8, Buffer.alloc(0))); } };
  const peer = room.join(send, close);
  const gone = () => {
    open = false;
    room.leave(peer);
    if (room.peers.size === 0) rooms.delete(code);
  };
  if (!peer) return;
  console.log(`room ${code}: player ${peer.id} connected (${room.peers.size} in)`);

  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 15, masked = buf[1] & 128;
      let len = buf[1] & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const need = at + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(at + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(at, at + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
      }
      buf = buf.subarray(need);
      if (opcode === 1) room.message(peer, payload.toString('utf8')).catch(() => {});
      else if (opcode === 9) socket.write(frame(10, payload));          // ping → pong
      else if (opcode === 8) { close(); gone(); return; }
    }
  });
  socket.on('close', () => { gone(); console.log(`room ${code}: player ${peer.id} left`); });
  socket.on('error', gone);
});

server.listen(PORT, () => console.log(`Adrift dev relay on ws://localhost:${PORT}/room/<code>`));
