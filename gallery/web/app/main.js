// ── Asset gallery ────────────────────────────────────────────────────────────
// Browse every asset in the game by category, and open any one of them in a
// 3D viewer. The list comes from registry.js; the building and lighting from
// the game's own code (see stage.js).

import * as THREE from 'three';
import { GLTFLoader } from '/vendor/jsm/loaders/GLTFLoader.js';
import { CATEGORIES, GAPS, loadRegistry } from './registry.js';
import { Stage } from './stage.js';
import { Orbit } from './orbit.js';

const $ = id => document.getElementById(id);
const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'glTF model', label: 'glTF models', cls: 'k-glTF' },
  { id: 'built in code', label: 'Built in code', cls: 'k-code' },
  { id: 'shader', label: 'Shaders', cls: 'k-shader' },
  { id: 'unregistered', label: 'Unregistered', cls: 'k-unreg' },
];
const kindClass = k => KINDS.find(x => x.id === k)?.cls || 'k-code';
const PRESETS = [['Dawn', 405], ['Noon', 720], ['Dusk', 1050], ['Night', 0]];

const state = { cat: 'all', kind: 'all', q: '', open: null, variant: null };
let entries = [];
let files = new Map();                 // file name -> bytes, from the server

// ── startup ──────────────────────────────────────────────────────────────────
async function start() {
  const [list, api] = await Promise.all([loadRegistry(), fetch('/api/assets').then(r => r.json()).catch(() => null)]);
  entries = list;
  for (const f of api?.files || []) files.set(f.name, f.bytes);

  // Anything in assets/models/ that no entry claims is shown anyway, flagged,
  // so a model dropped into the folder is never silently invisible here.
  const claimed = new Set(entries.flatMap(e => e.files));
  for (const name of files.keys()) {
    if (!name.endsWith('.glb') || claimed.has(name)) continue;
    entries.push(unregistered(name));
  }
  // And anything the manifest lists that is not on disk is a gap.
  for (const key of api?.manifest?.models || []) {
    const name = key + '.glb';
    if (!files.has(name) && ![...files.keys()].some(f => f.startsWith(key + '.'))) {
      GAPS.push({ category: 'objects', name: `${name} (listed, not on disk)`,
                  note: 'assets/models/manifest.json names it but the file is missing.' });
    }
  }

  buildChrome();
  readHash();
  render();
  addEventListener('hashchange', () => { readHash(); render(); });
  thumbs.run();
}

function unregistered(name) {
  return {
    id: 'file-' + name.replace(/\W/g, '-'), name, category: 'objects', group: 'Unregistered',
    kind: 'unregistered', files: [name], backdrop: 'studio', variants: null,
    source: `assets/models/${name} — not used by the game, and not in gallery/web/app/registry.js`,
    facts: [['Status', 'on disk, but nothing registers it'], ['To fix', 'wire it into the game, then add an entry to the registry']],
    async build() {
      const gltf = await new GLTFLoader().loadAsync('/assets/models/' + name);
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      root.position.y -= box.min.y;
      const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
      let action = null;
      const play = n => {
        const clip = gltf.animations.find(c => c.name === n);
        if (!clip) return;
        action?.fadeOut(0.2);
        action = mixer.clipAction(clip).reset().fadeIn(0.2).play();
      };
      const clips = gltf.animations.map(c => c.name);
      if (clips[0]) play(clips[0]);
      return { object: root, clips, play, current: () => action?.getClip().name, update: dt => mixer?.update(dt) };
    },
  };
}

// ── list ─────────────────────────────────────────────────────────────────────
function buildChrome() {
  $('chips').innerHTML = KINDS.map(k => `<button class="chip" data-k="${k.id}">${k.label}</button>`).join('');
  $('chips').onclick = e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k) { state.kind = k; render(); }
  };
  $('search').oninput = e => { state.q = e.target.value.trim().toLowerCase(); render(); };
  $('nav').onclick = e => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c) location.hash = c === 'all' ? '' : 'cat=' + c;
  };
  $('list').onclick = e => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (id) location.hash = 'asset=' + id;
  };
  const n = entries.length, models = entries.filter(e => e.kind === 'glTF model').length;
  $('foot').textContent = `${n} assets · ${models} from glTF files · ${files.size} files in assets/models`;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const id = p.get('asset');
  if (id) {
    const e = entries.find(x => x.id === id);
    if (e) { state.cat = state.cat === 'gaps' ? 'all' : state.cat; openDetail(e); return; }
  }
  closeDetail();
  state.cat = p.get('cat') || 'all';
}

function visible() {
  return entries.filter(e =>
    (state.cat === 'all' || e.category === state.cat ||
     (state.cat === 'unregistered' && e.kind === 'unregistered')) &&
    (state.kind === 'all' || e.kind === state.kind) &&
    (!state.q || `${e.name} ${e.group || ''} ${e.category} ${e.source}`.toLowerCase().includes(state.q)));
}

function render() {
  const unreg = entries.filter(e => e.kind === 'unregistered').length;
  const count = c => entries.filter(e => e.category === c).length;
  $('nav').innerHTML =
    `<button data-c="all" class="${state.cat === 'all' ? 'on' : ''}">All assets<span class="n">${entries.length}</span></button>` +
    '<div class="sep"></div>' +
    CATEGORIES.map(c => `<button data-c="${c.id}" class="${state.cat === c.id ? 'on' : ''}">${c.name}<span class="n">${count(c.id)}</span></button>`).join('') +
    '<div class="sep"></div>' +
    `<button data-c="gaps" class="gaps ${state.cat === 'gaps' ? 'on' : ''}">Gaps &amp; missing<span class="n">${GAPS.length}</span></button>` +
    (unreg ? `<button data-c="unregistered" class="unreg ${state.cat === 'unregistered' ? 'on' : ''}">Unregistered<span class="n">${unreg}</span></button>` : '');
  for (const b of $('chips').children) b.classList.toggle('on', b.dataset.k === state.kind);

  const cat = CATEGORIES.find(c => c.id === state.cat);
  $('title').textContent = cat?.name || (state.cat === 'gaps' ? 'Gaps & missing' : state.cat === 'unregistered' ? 'Unregistered files' : 'All assets');
  $('blurb').textContent = cat?.blurb || (state.cat === 'gaps'
    ? 'What the game does not have yet. Useful for deciding what to make next.'
    : state.cat === 'unregistered' ? 'Models in assets/models/ that nothing registers.'
    : 'Everything the game draws, by category. Click one to inspect it.');

  if (state.cat === 'gaps') { $('list').innerHTML = gapsHTML(); return; }

  const items = visible();
  const sections = state.cat === 'all'
    ? CATEGORIES.map(c => [c.name, items.filter(e => e.category === c.id)])
    : groupBy(items);
  let html = '';
  for (const [head, list] of sections) {
    if (!list.length) continue;
    html += `<div class="group">${esc(head)}</div><div class="grid">${list.map(cardHTML).join('')}</div>`;
  }
  // A category's own gaps, under what it does have.
  const gaps = cat ? GAPS.filter(g => g.category === cat.id) : [];
  if (gaps.length && !state.q && state.kind === 'all') {
    html += `<div class="group">Not in the game yet</div>` + gaps.map(gapHTML).join('');
  }
  $('list').innerHTML = html || '<div class="empty">Nothing matches.</div>';
  thumbs.paint();
}

function groupBy(items) {
  const m = new Map();
  for (const e of items) {
    const k = e.group || 'Assets';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return [...m.entries()];
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cardHTML(e) {
  const t = thumbs.get(e.id);
  const style = t?.url ? ` style="background-image:url(${t.url})"` : '';
  const cls = t?.url ? '' : t?.failed ? ' fail' : ' wait';
  return `<button class="card" data-id="${e.id}"><div class="thumb${cls}" data-thumb="${e.id}"${style}>${t?.failed ? 'no preview' : ''}</div>` +
    `<div class="meta"><b>${esc(e.name)}</b><span>${esc(e.group || '')}</span><br>` +
    `<span class="badge ${kindClass(e.kind)}">${esc(e.kind)}</span></div></button>`;
}

const gapHTML = g => `<div class="gap"><em>${esc(CATEGORIES.find(c => c.id === g.category)?.name || '')}</em><br>` +
  `<b>${esc(g.name)}</b><span>${esc(g.note)}</span></div>`;
function gapsHTML() {
  return CATEGORIES.map(c => {
    const gs = GAPS.filter(g => g.category === c.id);
    return gs.length ? `<div class="group">${esc(c.name)}</div>` + gs.map(gapHTML).join('') : '';
  }).join('');
}

// ── thumbnails ───────────────────────────────────────────────────────────────
// One offscreen renderer draws every card's picture, one at a time, with the
// same stage and builders as the viewer.
const thumbs = {
  done: new Map(),
  get(id) { return this.done.get(id); },
  paint() {
    for (const el of document.querySelectorAll('[data-thumb]')) {
      const t = this.done.get(el.dataset.thumb);
      if (!t) continue;
      if (t.url) { el.style.backgroundImage = `url(${t.url})`; el.classList.remove('wait'); }
      else if (t.failed) { el.classList.remove('wait'); el.classList.add('fail'); el.textContent = 'no preview'; }
    }
  },
  async run() {
    const W = 400, H = 300;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const stage = new Stage();
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 3000);
    const orbit = new Orbit(camera, document.createElement('div'));
    stage.showFigure = false;
    // Cards on screen first, then the rest in list order.
    const order = [...entries].sort((a, b) => onScreen(b) - onScreen(a));
    for (const e of order) {
      try {
        const asset = await e.build(e.variants?.[0].id);
        if (!asset || (!asset.object && !asset.ownsWater)) throw new Error(asset?.missing || 'nothing built');
        stage.setBackdrop(e.backdrop, 11 * 60);
        const b = stage.show(asset);
        const v = asset.view || {};
        orbit.frame(b.box, v.yaw ?? 0.75, v.pitch ?? 0.28);
        // Let animation, the swim and the surge settle into a pose.
        for (let i = 0; i < 12; i++) stage.tick(1 / 30, 0.6 + i / 30, camera);
        renderer.render(stage.scene, camera);
        this.done.set(e.id, { url: renderer.domElement.toDataURL('image/jpeg', 0.86) });
        stage.clear();
      } catch (err) {
        console.warn(`[gallery] no preview for ${e.id}:`, err);
        this.done.set(e.id, { failed: true });
      }
      this.paint();
      await new Promise(r => setTimeout(r, 0));          // keep the page responsive
    }
    renderer.dispose();
  },
};
const onScreen = e => (visible().includes(e) ? 1 : 0);

// ── detail viewer ────────────────────────────────────────────────────────────
const viewer = {
  renderer: null, stage: null, camera: null, orbit: null, asset: null, clock: new THREE.Clock(),
  time: 0, token: 0,
  init() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('view').prepend(this.renderer.domElement);
    this.stage = new Stage();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 3000);
    this.orbit = new Orbit(this.camera, this.renderer.domElement);
    new ResizeObserver(() => this.resize()).observe($('view'));
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  },
  resize() {
    const el = $('view');
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },
  frame() {
    if (!state.open) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.orbit.tick(dt);
    this.stage.tick(dt, this.time, this.camera);
    this.renderer.render(this.stage.scene, this.camera);
  },
};

async function openDetail(e, variant = null) {
  viewer.init();
  const same = state.open === e;
  state.open = e;
  state.variant = variant || (same ? state.variant : e.variants?.[0].id) || null;
  $('detail').classList.add('open');
  document.title = `${e.name} · Adrift Asset Gallery`;

  $('dCrumb').textContent = `${CATEGORIES.find(c => c.id === e.category)?.name || ''}${e.group ? ' · ' + e.group : ''}`;
  $('dName').textContent = e.name;
  $('dBadge').innerHTML = `<span class="badge ${kindClass(e.kind)}">${esc(e.kind)}</span>`;
  $('dFacts').innerHTML = e.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('dSource').textContent = e.source;
  $('dVariantsSec').hidden = !e.variants;
  $('dVariants').innerHTML = (e.variants || []).map(v =>
    `<button data-v="${v.id}" class="${v.id === state.variant ? 'on' : ''}">${esc(v.label)}</button>`).join('');
  $('dNote').hidden = true;

  if (!same || variant) {
    // First time, or a new variant: start in the backdrop the asset lives in.
    if (!same) viewer.stage.setBackdrop(e.backdrop);
    $('loading').classList.add('on');
    const token = ++viewer.token;
    let asset = null;
    try { asset = await e.build(state.variant); } catch (err) { console.error(err); asset = { missing: String(err.message || err) }; }
    if (token !== viewer.token) return;                  // a newer open won the race
    $('loading').classList.remove('on');
    viewer.asset = asset;
    viewer.resize();                     // the panel has only just been laid out
    const b = viewer.stage.show(asset);
    const v = asset.view || {};
    viewer.orbit.frame(b.box, v.yaw ?? 0.75, v.pitch ?? 0.28);
    applyToggles();
    if (asset.missing) { $('dNote').hidden = false; $('dNote').textContent = asset.missing; }
    stats(e, asset);
  }
  clipsUI();
  backdropUI();
  viewsUI();
}

function closeDetail() {
  if (!state.open) return;
  state.open = null;
  $('detail').classList.remove('open');
  document.title = 'Adrift Asset Gallery';
  viewer.stage?.clear();
}

function clipsUI() {
  const a = viewer.asset;
  const clips = a?.clips || [];
  $('dClipsSec').hidden = !clips.length;
  const cur = a?.current?.();
  $('dClips').innerHTML = clips.map(c => `<button data-clip="${esc(c)}" class="${c === cur ? 'on' : ''}">${esc(c)}</button>`).join('');
}

function backdropUI() {
  const s = viewer.stage;
  for (const b of $('dBackdrop').children) b.classList.toggle('on', b.dataset.b === s.backdrop);
  $('dTimeRow').hidden = s.backdrop === 'studio';
  $('dTime').value = String(s.minutes);
  const m = Math.round(s.minutes);
  $('dClock').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const VIEWS = [['¾', 0.75, 0.28], ['Front', 0, 0.06], ['Left', Math.PI / 2, 0.06], ['Back', Math.PI, 0.06],
               ['Right', -Math.PI / 2, 0.06], ['Top', 0.0001, 1.5], ['Below', 0.75, -0.5]];
function viewsUI() {
  $('views').innerHTML = VIEWS.map(([n], i) => `<button class="vbtn" data-view="${i}">${n}</button>`).join('') +
    '<button class="vbtn" data-view="reset">Reset</button>';
}

function stats(e, asset) {
  let meshes = 0, tris = 0;
  const mats = new Set();
  asset.object?.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
    for (const m of [].concat(o.material)) mats.add(m);
  });
  const s = viewer.stage.bounds.size;
  // The fallback is built in code: it is not the file, whatever the entry uses.
  const bytes = state.variant === 'fallback' ? [] : e.files.map(f => files.get(f)).filter(Boolean);
  const rows = [];
  if (asset.object) {
    rows.push(['Size', asset.frame && asset.ownsWater ? 'see the chunk' : `${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} m`]);
    rows.push(['Triangles', Math.round(tris).toLocaleString()], ['Meshes', meshes], ['Materials', mats.size]);
  } else rows.push(['Drawn by', 'a shader, no mesh of its own']);
  if (asset.clips?.length) rows.push(['Animations', asset.clips.length]);
  if (bytes.length) rows.push(['File', e.files.map(f => `${f} (${kb(files.get(f))})`).join(', ')]);
  $('dStats').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}
const kb = n => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

// ── detail controls ──────────────────────────────────────────────────────────
$('back').onclick = () => { location.hash = state.cat && state.cat !== 'all' ? 'cat=' + state.cat : ''; };
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
function step(d) {
  const list = visible().length ? visible() : entries;
  const i = list.indexOf(state.open);
  const next = list[(i + d + list.length) % list.length];
  if (next) location.hash = 'asset=' + next.id;
}
addEventListener('keydown', e => {
  if (!state.open || e.target.matches('input[type=search]')) return;
  if (e.key === 'Escape') $('back').click();
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
});
$('dVariants').onclick = e => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v && v !== state.variant) openDetail(state.open, v);
};
$('dClips').onclick = e => {
  const c = e.target.closest('[data-clip]')?.dataset.clip;
  if (c) { viewer.asset?.play?.(c); clipsUI(); }
};
$('dBackdrop').onclick = e => {
  const b = e.target.closest('[data-b]')?.dataset.b;
  if (!b) return;
  viewer.stage.setBackdrop(b);
  const bd = viewer.stage.bounds;
  viewer.orbit.target.copy(bd.center);
  viewer.orbit.update();
  backdropUI();
};
$('dTime').oninput = e => { viewer.stage.setBackdrop(viewer.stage.backdrop, Number(e.target.value)); backdropUI(); };
$('views').onclick = e => {
  const v = e.target.closest('[data-view]')?.dataset.view;
  if (v === undefined) return;
  const b = viewer.stage.bounds;
  if (v === 'reset') {
    const av = viewer.asset?.view || {};
    viewer.orbit.frame(b.box, av.yaw ?? 0.75, av.pitch ?? 0.28);
  } else {
    const [, yaw, pitch] = VIEWS[v];
    viewer.orbit.target.copy(b.center);
    viewer.orbit.view(yaw, pitch);
  }
};
$('tRotate').onchange = e => { viewer.orbit.autoRotate = e.target.checked; };
$('tWire').onchange = applyToggles;
$('tGrid').onchange = applyToggles;
$('tFigure').onchange = applyToggles;

function applyToggles() {
  const s = viewer.stage;
  if (!s) return;
  s.showGrid = $('tGrid').checked;
  s.showFigure = $('tFigure').checked;
  const wire = $('tWire').checked;
  viewer.asset?.object?.traverse(o => {
    if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = wire;
  });
}

// Time presets under the slider.
$('dTimeRow').insertAdjacentHTML('beforeend', `<div class="seg" id="dPresets" style="margin-top:8px">${
  PRESETS.map(([n, m]) => `<button data-m="${m}">${n}</button>`).join('')}</div>`);
$('dPresets').onclick = e => {
  const m = e.target.closest('[data-m]')?.dataset.m;
  if (m !== undefined) { viewer.stage.setBackdrop(viewer.stage.backdrop, Number(m)); backdropUI(); }
};

start().catch(err => {
  console.error(err);
  $('foot').textContent = 'Could not load the registry — see the console.';
});
