// Simulate the rod's fight: every species, played by five kinds of player.
//
//     node tools/simulate_fight.mjs
//
// src/fight.js is pure maths with no imports, which is the point: it can be
// run here, thousands of times, instead of tuned by feel one catch at a time.
// Each player sees the fight a human reaction late and decides whether to hold
// the reel. What to look for after changing FIGHTERS or the line constants:
//
//   careful  should land nearly everything — skill has to be enough
//   holder   should lose the strong fish — holding the button is not a strategy
//   lazy     should lose everything — a fish is not landed by waiting
//
// The numbers are quoted in README.md; update them if they move.

import { Fight, FIGHTERS } from '../src/fight.js';
const DT = 1/60;
// How each kind of player decides to hold or let go, seeing the state `lag`
// seconds late — a human reaction, not a perfect one.
const POLICIES = {
  // Reads the meters the way a player would, including the warning that a
  // burying fish is heading for the reef — which means hold it, hard.
  skilled: { lag: 0.15, decide: (s, reeling) => s.looseness > 0.3 || s.cover > 0.25 ? s.tension < 0.9
                                                 : reeling ? s.tension < 0.80 : s.tension < 0.66 },
  // Lets go when the bar turns red, a little late — most players, probably.
  typical: { lag: 0.20, decide: (s, reeling) => reeling ? s.tension < 0.85 : s.tension < 0.70 },
  casual:  { lag: 0.25, decide: (s, reeling) => reeling ? s.tension < 0.92 : s.tension < 0.75 },
  holder:  { lag: 0,    decide: () => true },            // holds the button the whole time
  lazy:    { lag: 0,    decide: () => false },           // never reels
  masher:  { lag: 0,    decide: (s, r, t) => Math.floor(t / 0.5) % 2 === 0 },  // on-off, blind
};
function run(key, policy, n = 400) {
  const out = { landed: 0, snapped: 0, thrown: 0, spooled: 0, rocked: 0, timeout: 0 }, times = [];
  for (let i = 0; i < n; i++) {
    const f = new Fight(key, { size: 1 + Math.random() * 0.2, line: 6 + Math.random() * 18 });
    const hist = []; let reeling = true, t = 0;
    while (!f.outcome && t < 120) {
      hist.push({ tension: f.tension, looseness: f.looseness, cover: f.cover });
      const seen = hist[Math.max(0, hist.length - 1 - Math.round(policy.lag / DT))];
      reeling = policy.decide(seen, reeling, t);
      f.step(DT, reeling); t += DT;
    }
    out[f.outcome || 'timeout']++;
    if (f.outcome === 'landed') times.push(t);
  }
  times.sort((a, b) => a - b);
  const pct = k => Math.round(100 * out[k] / n);
  return { landed: pct('landed'), snapped: pct('snapped'), thrown: pct('thrown'), spooled: pct('spooled'), rocked: pct('rocked'),
           timeout: pct('timeout'), median: times.length ? times[times.length >> 1].toFixed(0) + 's' : '-' };
}
const rows = [];
for (const key of Object.keys(FIGHTERS)) for (const [name, pol] of Object.entries(POLICIES)) {
  const r = run(key, pol); rows.push({ fish: key, player: name, ...r });
}
const only = process.argv.slice(2);
console.log('fish      player    landed snapped thrown spooled rocked  median-fight');
for (const r of rows) {
  if (only.length && !only.includes(r.fish)) continue;
  console.log(`${r.fish.padEnd(9)} ${r.player.padEnd(8)} ${String(r.landed).padStart(5)}% ${String(r.snapped).padStart(6)}% ${String(r.thrown).padStart(5)}% ${String(r.spooled).padStart(6)}% ${String(r.rocked).padStart(5)}%   ${r.median}${r.timeout?'  timeout '+r.timeout+'%':''}`);
}
