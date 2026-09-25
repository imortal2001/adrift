# The Adrift relay

Playing together needs something that holds players' connections open and
passes their messages between them — which a static site on Vercel cannot do.
This folder is that something: a very small relay, run as a Cloudflare Worker
with one Durable Object per room. It does not run the game; every player's
browser does. See *Playing together* in the main README.

| File | What it is |
|---|---|
| `room.js` | The room: who is in it, who is host, passing messages on. Rate- and size-limited. Shared by both below. |
| `worker.js` | The Cloudflare Worker: `wss://…/room/<code>` → that room's Durable Object. |
| `wrangler.toml` | Its configuration for Cloudflare's `wrangler` tool. |
| `dev-relay.mjs` | The same room on this machine, for developing: `node server/dev-relay.mjs` (port 8787). No install. |

## Running it locally

```bash
node server/dev-relay.mjs
```

The game, served from `localhost`, connects to it on its own (`src/net.js`).

## Putting it on Cloudflare (free)

1. Make a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. From this folder, sign in (a browser window opens) and deploy:

   ```bash
   npx wrangler login
   npx wrangler deploy
   ```

   The first run offers to install `wrangler` — say yes. If Cloudflare asks
   you to pick a `workers.dev` subdomain, pick one. Deploying prints the
   relay's address, `https://adrift-relay.<your-subdomain>.workers.dev`.
3. Put that address, as `wss://`, in `DEPLOYED_RELAY` at the top of
   `src/net.js`, and publish the game as usual.

After changing anything in this folder, deploy again the same way, from this
folder (`cd server && npx wrangler deploy`) — publishing the game does not
update the relay. Run it from anywhere else and wrangler offers to publish
the whole repository as a website instead: say no.

The free plan is enough for a small game. As Cloudflare's free tier stood
when this was written: 100,000 Durable Object requests a day, with incoming
WebSocket messages counted 20 to a request, and 13,000 GB-s of running time
a day. Three players for three hours send about 420,000 messages (where
each is twelve times a second, and the host's word on the world three) —
some 21,000 requests — and keep one room running for about 1,400 GB-s: well
inside both. Check Cloudflare's current limits if you expect a crowd.
