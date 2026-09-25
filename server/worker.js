// ── The relay, on Cloudflare ─────────────────────────────────────────────────
// A Worker that hands each room code its own Durable Object — one small,
// single-threaded instance per game, wherever Cloudflare puts it — and the
// Durable Object runs a Room (room.js) over the players' WebSockets.
//
//   wss://<your worker>.workers.dev/room/ABCDE    join room ABCDE
//
// Deploy with `npx wrangler deploy` from this folder (see README.md here).

import { Room } from './room.js';

const CODE = /^\/room\/([A-Za-z0-9]{4,12})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(CODE);
    if (!m) {
      return new Response('Adrift relay. Connect a WebSocket to /room/<code>.\n',
                          { headers: { 'content-type': 'text/plain' } });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket.', { status: 426 });
    }
    const id = env.ROOMS.idFromName(m[1].toUpperCase());
    return env.ROOMS.get(id).fetch(request);
  },
};

export class RoomObject {
  constructor(state, env) {
    this.room = new Room();
  }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const peer = this.room.join(text => server.send(text), () => server.close(1008, 'room full'));
    if (peer) {
      server.addEventListener('message', e => this.room.message(peer, typeof e.data === 'string' ? e.data : ''));
      const gone = () => this.room.leave(peer);
      server.addEventListener('close', gone);
      server.addEventListener('error', gone);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
