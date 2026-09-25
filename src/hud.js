// ── HUD ──────────────────────────────────────────────────────────────────────
// Plain DOM over the canvas. Nothing here knows game rules; it renders state
// and reports clicks back through callbacks.

import { ITEMS, RECIPES, BUILDABLES } from './items.js';
import { SLOTS } from './hotbar.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      reticle: $('reticle'), prompt: $('prompt'), log: $('log'),
      inv: $('inv'), buildbar: $('buildbar'),
      hotbar: $('hotbar'), pack: $('packPanel'), packGrid: $('packGrid'),
      packSlotLine: $('packSlotLine'),
      admin: $('adminPanel'), adminClock: $('adminClock'),
      adminTime: $('adminTime'), adminHold: $('adminHold'), adminHint: $('adminHint'),
      adminRestore: $('adminRestore'),
      adminGiveMats: $('adminGiveMats'), adminGiveGear: $('adminGiveGear'),
      clock: $('clock'), daynum: $('daynum'), tags: $('tags'),
      craft: $('craftPanel'), craftGrid: $('craftGrid'),
      underwater: $('underwater'), hurt: $('hurt'), splash: $('splash'),
      hp: [$('hpF'), $('hpV')], hu: [$('huF'), $('huV')],
      th: [$('thF'), $('thV')], ox: [$('oxF'), $('oxV')], oxRow: $('oxRow'),
      fishing: $('fishing'),
    };
    const f = this.el.fishing;
    this.fish = f && {
      name: f.querySelector('.fname'), meta: f.querySelector('.fmeta'),
      cast: f.querySelector('.fb.cast i'), tension: f.querySelector('.fb.tension i'),
      slack: f.querySelector('.fb.tension .slack'), danger: f.querySelector('.fb.tension .danger'),
      line: f.querySelector('.fb.line i'), stam: f.querySelector('.fb.stam i'),
      hint: f.querySelector('.fh'),
    };
    this._fishHint = '';
    this.msgs = [];
    this._invSig = '';
    this._craftSig = '';
    this._barSig = '';
    this._tagSig = '';
    this._prompt = null;
    this.onCraft = () => {};
    this.onAdminTime = () => {};      // minutes since midnight
    this.onAdminHold = () => {};      // true to stop the clock
    this.onAdminRestore = () => {};   // refill health, hunger and thirst
    this.onAdminGive = () => {};      // 'materials' | 'equipment'
    this.onSelectSlot = () => {};     // hotbar slot clicked
    this.onAssign = () => {};         // (slot, itemId)
    this._hotSig = '';
    this._packSig = '';
    this._scrubbing = false;          // don't fight the slider while it is dragged
    this._presetSig = '';
    this.bindAdmin();
  }

  // ── messages ───────────────────────────────────────────────────────────────
  /** A line in the message log, for `ms` (something said stays up longer). */
  log(text, kind = '', ms = 5200) {
    const node = document.createElement('div');
    node.className = `msg ${kind}`;
    node.textContent = text;
    this.el.log.appendChild(node);
    const entry = { node, until: performance.now() + ms };
    this.msgs.push(entry);
    while (this.msgs.length > 5) {
      const old = this.msgs.shift();
      old.node.remove();
    }
  }

  tickMessages(now) {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      if (now > this.msgs[i].until) {
        this.msgs[i].node.style.transition = 'opacity .5s';
        this.msgs[i].node.style.opacity = '0';
        const n = this.msgs[i].node;
        setTimeout(() => n.remove(), 520);
        this.msgs.splice(i, 1);
      }
    }
  }

  setPrompt(html) {
    if (html === this._prompt) return;
    this._prompt = html;
    this.el.prompt.classList.toggle('show', !!html);
    this.el.reticle.classList.toggle('hot', !!html);
    if (html) this.el.prompt.innerHTML = html;
  }

  // ── vitals ─────────────────────────────────────────────────────────────────
  updateVitals(p) {
    const set = ([fill, val], n) => {
      fill.style.width = `${Math.max(0, Math.min(100, n))}%`;
      val.textContent = Math.round(n);
    };
    set(this.el.hp, p.health);
    set(this.el.hu, p.hunger);
    set(this.el.th, p.thirst);
    const showBreath = p.breath < 99.5;
    this.el.oxRow.style.display = showBreath ? 'block' : 'none';
    if (showBreath) set(this.el.ox, p.breath);
  }

  updateClock(sky, player, raft) {
    this.el.clock.textContent = sky.clock;
    this.el.daynum.textContent = `Day ${sky.day} adrift · ${raft.size} deck${raft.size === 1 ? '' : 's'}`;
    const tags = [];
    // Non-default world state should never be invisible: it is why the sun is
    // not moving.
    if (this.adminOpen) tags.push(['Admin', 'warn']);
    if (sky.held) tags.push(['Time held', 'warn']);
    if (player.cave) tags.push([player.cave.kind === 'sea' ? 'In a sea cave' : 'In a cave', 'warn']);
    else if (player.onLand) tags.push(player.wading > 0.5 ? [`Wading · ${player.wading.toFixed(1)} m`, 'cold'] : ['Ashore', 'ok']);
    if (player.sheltered) tags.push(['Sheltered', 'ok']);
    if (sky.isNight) tags.push(['Night', 'cold']);
    if (player.state === 'swim') {
      tags.push([player.depth > 0.3 ? `Diving · ${player.depth.toFixed(1)} m` : 'In the water', 'cold']);
    }
    const sig = tags.map(t => t[0]).join('|');   // depth changes, so this re-renders while diving
    if (sig !== this._tagSig) {
      this._tagSig = sig;
      this.el.tags.innerHTML = tags.map(([t, c]) => `<span class="tag ${c}">${t}</span>`).join('');
    }
  }

  /**
   * The rod's meters: the swing while casting, and tension, line and the
   * fish's fight while reeling. `null` hides them. The zones are passed in, not
   * known here — this only draws what fight.js decides.
   */
  setFishing(v) {
    const el = this.el.fishing, f = this.fish;
    if (!el) return;
    if (!v) {
      if (el.classList.contains('open')) el.className = 'panel';
      return;
    }
    el.classList.add('open');
    el.classList.toggle('cast', v.mode === 'cast');
    el.classList.toggle('fight', v.mode === 'fight');
    const pct = x => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(1)}%`;
    let hint;
    if (v.mode === 'cast') {
      f.name.textContent = 'Cast';
      f.meta.textContent = `${v.metres.toFixed(0)} m`;
      f.cast.style.width = pct(v.power);
      el.classList.remove('strain');
      hint = 'Let go at the top of the swing to throw it furthest';
    } else {
      f.name.textContent = v.title;
      f.meta.textContent = `${v.line.toFixed(1)} m out`;
      f.slack.style.width = pct(v.slackAt);
      f.danger.style.width = pct(1 - v.dangerAt);
      f.tension.style.width = pct(v.tension);
      f.tension.style.background = v.tension >= v.dangerAt ? 'var(--bad)'
        : v.tension >= v.dangerAt - 0.15 ? 'var(--warn)'
        : v.tension < v.slackAt ? '#9ad8f5' : 'var(--good)';
      const out = v.line / v.lineMax;
      f.line.style.width = pct(out);
      f.line.style.background = out > 0.8 ? 'var(--bad)' : 'var(--water)';
      f.stam.style.width = pct(v.stamina);
      el.classList.toggle('strain', v.overload > 0.05);
      hint = v.overload > 0.05 ? '<b>Let go</b> — the line is about to snap'
        : v.looseness > 0.15 ? '<b>Reel</b> — the line is going slack'
        : out > 0.8 ? '<b>Reel</b> — it is nearly out of line'
        : v.cover > 0.3 ? '<b>Reel</b> — it is heading for the rocks, turn it'
        : v.jumping ? 'It is jumping — keep the line tight'
        : v.running ? 'It is running — ease off and let it tire'
        : '<b>Hold</b> to reel it in';
    }
    if (hint !== this._fishHint) { f.hint.innerHTML = hint; this._fishHint = hint; }
  }

  /** @param strength 0..1, so deep water reads darker than a dunk at the surface. */
  setUnderwater(on, strength = 1) {
    this.el.underwater.classList.toggle('on', on);
    this.el.underwater.style.opacity = on ? String(0.55 + 0.45 * strength) : '0';
  }


  flashHurt() {
    this.el.hurt.style.opacity = '0.9';
    setTimeout(() => { this.el.hurt.style.opacity = '0'; }, 90);
  }

  // ── inventory ──────────────────────────────────────────────────────────────
  refreshInventory(inv) {
    // Tools and usables are shown in the hotbar, so this strip is raw stock.
    const entries = [...inv.slots.entries()]
      .filter(([id, n]) => n > 0 && !ITEMS[id].action);
    const sig = entries.map(e => e.join(':')).join(',');
    if (sig === this._invSig) return;
    this._invSig = sig;
    this.el.inv.innerHTML = entries.map(([id, n]) =>
      `<div class="slot"><div class="n">${ITEMS[id].name}</div>` +
      `<div class="q">×${n}</div></div>`).join('');
  }

  // ── hotbar ─────────────────────────────────────────────────────────────────
  refreshHotbar(hotbar, inv) {
    const sig = hotbar.slots.map(id => `${id}:${id ? inv.count(id) : 0}`).join('|') +
                `#${hotbar.selected}`;
    if (sig === this._hotSig) return;
    this._hotSig = sig;

    this.el.hotbar.innerHTML = hotbar.slots.map((id, i) => {
      const sel = i === hotbar.selected ? ' sel' : '';
      if (!id) {
        return `<div class="hs empty${sel}" data-slot="${i}">
          <span class="k">${i + 1}</span><div class="n">empty</div><div class="q">-</div></div>`;
      }
      const it = ITEMS[id];
      const n = inv.count(id);
      const out = n === 0 ? ' out' : '';
      const qty = it.tool ? (n ? 'ready' : 'none') : `×${n}`;
      return `<div class="hs${it.tool ? ' tool' : ''}${it.cooked ? ' cooked' : ''}${sel}${out}" data-slot="${i}" title="${it.name}">
        <span class="k">${i + 1}</span><div class="n">${it.short || it.name}</div>
        <div class="q">${qty}</div></div>`;
    }).join('');

    for (const el of this.el.hotbar.querySelectorAll('[data-slot]')) {
      el.onclick = () => this.onSelectSlot(Number(el.dataset.slot));
    }
  }

  // ── pack (slot registration) ───────────────────────────────────────────────
  get packOpen() { return this.el.pack.classList.contains('open'); }

  togglePack(inv, hotbar) {
    const open = !this.packOpen;
    this.el.pack.classList.toggle('open', open);
    if (open) this.refreshPack(inv, hotbar, true);
    return open;
  }

  closePack() { this.el.pack.classList.remove('open'); }

  refreshPack(inv, hotbar, force = false) {
    if (!this.packOpen && !force) return;
    const carried = [...inv.slots.entries()].filter(([, n]) => n > 0);
    const sig = `${hotbar.selected}|${hotbar.slots.join(',')}|` +
                carried.map(e => e.join(':')).join(',');
    if (sig === this._packSig) return;
    this._packSig = sig;

    this.el.packSlotLine.innerHTML = hotbar.slots.map((id, i) =>
      `<div class="ps${i === hotbar.selected ? ' sel' : ''}" data-pslot="${i}">
        <b>${i + 1}</b>${id ? ITEMS[id].name : '<em>empty</em>'}</div>`).join('');

    if (!carried.length) {
      this.el.packGrid.innerHTML =
        '<div class="card no"><div class="t">Nothing carried</div>' +
        '<div class="d">Gather some driftwood first.</div></div>';
    } else {
      carried.sort((a, b) => (ITEMS[b[0]].action ? 1 : 0) - (ITEMS[a[0]].action ? 1 : 0));
      this.el.packGrid.innerHTML = carried.map(([id, n]) => {
        const it = ITEMS[id];
        const slot = hotbar.slots.indexOf(id);
        return `<div class="card${slot === hotbar.selected ? ' sel' : ''}" data-item="${id}">
          <div class="t">${it.name}<em>${it.tool ? 'tool' : '×' + n}</em></div>
          <div class="c">${slot === -1 ? 'not in a slot' : `slot ${slot + 1}`}</div>
          <div class="d">${it.hint || 'Raw material — nothing happens when held.'}</div></div>`;
      }).join('');
    }

    for (const el of this.el.packSlotLine.querySelectorAll('[data-pslot]')) {
      el.onclick = () => this.onSelectSlot(Number(el.dataset.pslot));
    }
    for (const el of this.el.packGrid.querySelectorAll('[data-item]')) {
      el.onclick = () => this.onAssign(hotbar.selected, el.dataset.item);
    }
  }

  // ── crafting ───────────────────────────────────────────────────────────────
  get craftOpen() { return this.el.craft.classList.contains('open'); }

  toggleCraft(inv) {
    const open = !this.craftOpen;
    this.el.craft.classList.toggle('open', open);
    if (open) this.refreshCraft(inv, true);
    return open;
  }

  closeCraft() { this.el.craft.classList.remove('open'); }

  refreshCraft(inv, force = false) {
    if (!this.craftOpen && !force) return;
    const sig = RECIPES.map(r => `${r.id}${inv.canAfford(r.cost) ? 1 : 0}${inv.count(r.out[0])}`).join('|');
    if (sig === this._craftSig) return;
    this._craftSig = sig;

    this.el.craftGrid.innerHTML = RECIPES.map(r => {
      const item = ITEMS[r.out[0]];
      const owned = inv.count(r.out[0]);
      const blocked = item.tool && owned > 0;
      const can = inv.canAfford(r.cost) && !blocked;
      return `<div class="card ${can ? '' : 'no'}" data-recipe="${r.id}">
        <div class="t">${item.name}${r.out[1] > 1 ? ` ×${r.out[1]}` : ''}
          <em>${blocked ? 'owned' : item.tool ? 'tool' : ''}</em></div>
        <div class="c">${inv.costText(r.cost)}</div>
        <div class="d">${r.desc}</div></div>`;
    }).join('');

    for (const card of this.el.craftGrid.querySelectorAll('[data-recipe]')) {
      card.onclick = () => {
        if (card.classList.contains('no')) return;
        this.onCraft(card.dataset.recipe);
      };
    }
  }

  // ── build bar ──────────────────────────────────────────────────────────────
  setBuildBar(open, index, inv) {
    this.el.buildbar.classList.toggle('open', open);
    if (!open) return;
    const sig = `${index}|` + BUILDABLES.map(b => (inv.canAfford(b.cost) ? 1 : 0)).join('');
    if (sig === this._barSig) return;
    this._barSig = sig;
    this.el.buildbar.innerHTML = BUILDABLES.map((b, i) => {
      const can = inv.canAfford(b.cost);
      return `<div class="bslot ${i === index ? 'sel' : ''} ${can ? '' : 'no'}">
        ${b.name}
        <span class="k">${Object.entries(b.cost).map(([k, v]) => v + ' ' + ITEMS[k].name).join(' + ')}</span>
      </div>`;
    }).join('');
  }

  showSplash(on) { this.el.splash.classList.toggle('hide', !on); }

  // ── admin panel (only ever shown on a local dev host) ──────────────────────
  // Sunrise is 06:00 and sunset 18:00, so 05:30/18:30 would both put the sun
  // under the horizon with no directional light at all. These sit inside the
  // golden hour on each side.
  static PRESETS = { dawn: 405, day: 720, dusk: 1050, night: 0 };

  bindAdmin() {
    const t = this.el.adminTime;
    t.addEventListener('input', () => this.onAdminTime(Number(t.value)));
    t.addEventListener('pointerdown', () => { this._scrubbing = true; });
    addEventListener('pointerup', () => { this._scrubbing = false; });

    for (const b of this.el.admin.querySelectorAll('[data-preset]')) {
      b.onclick = () => this.onAdminTime(HUD.PRESETS[b.dataset.preset], true);
    }
    this.el.adminHold.onchange = () => this.onAdminHold(this.el.adminHold.checked);
    this.el.adminRestore.onclick = () => this.onAdminRestore();
    this.el.adminGiveMats.onclick = () => this.onAdminGive('materials');
    this.el.adminGiveGear.onclick = () => this.onAdminGive('equipment');
  }

  /** Reveal the key hint on the splash; called only when admin is available. */
  enableAdmin() { this.el.adminHint.hidden = false; }

  get adminOpen() { return this.el.admin.classList.contains('open'); }

  toggleAdmin(sky) {
    const open = !this.adminOpen;
    this.el.admin.classList.toggle('open', open);
    if (open) this.syncAdmin(sky, true);
    return open;
  }

  closeAdmin() { this.el.admin.classList.remove('open'); }

  syncAdmin(sky, force = false) {
    if (!this.adminOpen && !force) return;
    const m = Math.round(sky.minutes);
    this.el.adminClock.textContent = sky.clock;
    if (!this._scrubbing) this.el.adminTime.value = String(m);
    this.el.adminHold.checked = sky.held;

    // Light up whichever preset the clock is sitting on.
    const active = Object.keys(HUD.PRESETS)
      .find(k => Math.abs(((m - HUD.PRESETS[k] + 720) % 1440) - 720) < 8) || '';
    const sig = `${active}${sky.held ? 1 : 0}`;
    if (sig !== this._presetSig) {
      this._presetSig = sig;
      for (const b of this.el.admin.querySelectorAll('[data-preset]')) {
        b.classList.toggle('on', b.dataset.preset === active);
      }
    }
  }
}
