'use strict';
/* Squelchbox — UI, sequencer clock, storage and export. */

/* ---------- storage: this browser's localStorage (works without it, e.g. in private windows) ---------- */
const store = {
  get: async () => { try { return JSON.parse(localStorage.getItem('squelchbox')); } catch (e) { return null; } },
  set: async s => { try { localStorage.setItem('squelchbox', JSON.stringify(s)); } catch (e) { /* ignore */ } }
};

let state = defaultState();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { store.set(JSON.parse(JSON.stringify(state))).catch(() => {}); }, 300);
}

/* ---------- small DOM helpers ---------- */
const $ = sel => document.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
let toastTimer = null;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- knob control ---------- */
const A0 = 0.75 * Math.PI, A1 = 2.25 * Math.PI, R = 17, CX = 22, CY = 22;
function arcPath(a0, a1) {
  const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
  const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function makeKnob({ label, min = 0, max = 1, step = 0, value, def, format, onInput, cls = '', aria }) {
  const root = el('div', { class: `knob ${cls}`, tabindex: 0, role: 'slider', 'aria-label': aria || label, 'aria-valuemin': min, 'aria-valuemax': max });
  root.innerHTML =
    `<svg viewBox="0 0 44 44" aria-hidden="true">
      <path class="k-track" d="${arcPath(A0, A1)}"/>
      <path class="k-val" d=""/>
      <circle class="k-cap" cx="22" cy="22" r="11.5"/>
      <line class="k-ptr" x1="22" y1="22" x2="22" y2="13"/>
    </svg>`;
  const val = root.querySelector('.k-val'), ptr = root.querySelector('.k-ptr');
  const read = el('div', { class: 'k-read' });
  root.append(el('div', { class: 'k-label', text: label }), read);
  const range = max - min;
  const fmt = format || (v => Math.round(((v - min) / range) * 100));
  let v = value;

  function render() {
    const n = (v - min) / range;
    const a = A0 + n * (A1 - A0);
    val.setAttribute('d', n > 0.004 ? arcPath(A0, a) : '');
    ptr.setAttribute('x2', (CX + 9 * Math.cos(a)).toFixed(2));
    ptr.setAttribute('y2', (CY + 9 * Math.sin(a)).toFixed(2));
    const txt = String(fmt(v));
    read.textContent = txt;
    root.setAttribute('aria-valuenow', v);
    root.setAttribute('aria-valuetext', txt);
  }
  function set(nv, emit = true) {
    nv = Math.min(max, Math.max(min, nv));
    if (step) nv = Math.round(nv / step) * step;
    if (nv === v) return;
    v = nv;
    render();
    if (emit) onInput(v);
  }

  let drag = null;
  root.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    root.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v };
    root.focus();
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    set(drag.v + (dy / (e.shiftKey ? 700 : 160)) * range);
  });
  const end = () => { drag = null; };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('dblclick', () => set(def));
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const inc = step || range * (e.shiftKey ? 0.005 : 0.02);
    set(v + (e.deltaY < 0 ? inc : -inc));
  }, { passive: false });
  root.addEventListener('keydown', e => {
    const inc = step || range * (e.shiftKey ? 0.01 : 0.05);
    const map = { ArrowUp: inc, ArrowRight: inc, ArrowDown: -inc, ArrowLeft: -inc, PageUp: inc * 4, PageDown: -inc * 4 };
    if (e.key in map) { e.preventDefault(); set(v + map[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); set(min); }
    else if (e.key === 'End') { e.preventDefault(); set(max); }
  });

  render();
  return { el: root, set: nv => { v = Math.min(max, Math.max(min, nv)); render(); } };
}

/* Waveform pictograms for wave switches (viewBox 0 0 22 12). */
const WAVE_ICONS = {
  sine: 'M2 6 Q5 0 8 6 T14 6 T20 6',
  triangle: 'M2 9 L6 3 L11 9 L16 3 L20 9',
  sawtooth: 'M2 9 L10 3 V9 L18 3 V9',
  square: 'M2 9 V3 H7 V9 H12 V3 H17 V9 H20'
};

function makeSwitch({ label, options, value, onInput }) {
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  const btns = options.map(([val, text]) => {
    const b = el('button', { type: 'button', 'aria-pressed': String(val === value), onclick: () => { api.set(val); onInput(val); } });
    if (WAVE_ICONS[val]) {
      b.classList.add('wave-opt');
      b.title = text;
      b.innerHTML = `<svg viewBox="0 0 22 12" aria-hidden="true"><path d="${WAVE_ICONS[val]}"/></svg>`;
      b.append(el('span', { text }));
    } else b.textContent = text;
    b.dataset.val = val;
    seg.append(b);
    return b;
  });
  const api = { el: el('div', { class: 'switch' }, seg, el('div', { class: 'k-label', text: label })), set: nv => btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === nv))) };
  return api;
}

/* ---------- audio + clock ---------- */
let ctx = null, engine = null, timer = null;
let playing = false, nextTime = 0, step = 0, barCount = 0;
let queue = [], playhead = -1;

function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    engine = new Engine(ctx, { analyser: true });
    engine.apply(state, true);
    scopeData = null;
    ctx.onstatechange = () => { if (playing && ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}
function applySound() {
  if (!engine) return;
  try { engine.apply(state); } catch (e) { console.error('Squelchbox: applying a setting failed', e); }
}

let lastTickAt = 0;
function startTimer() {
  if (!timer) {
    try {
      timer = new Worker('timer-worker.js');   // keeps ticking when the tab is in the background
      timer.onmessage = tick;
      timer.onerror = () => { timer = null; startFallbackTimer(); };
    } catch (e) {
      startFallbackTimer();
      return;
    }
  }
  timer.postMessage('start');
}
function startFallbackTimer() {
  if (timer && timer.fallback) return timer.postMessage('start');
  timer = { fallback: true, postMessage(m) { clearInterval(this.id); if (m === 'start') this.id = setInterval(tick, 25); } };
  timer.postMessage('start');
}

function play() {
  ensureAudio();
  playing = true;
  step = 0;
  barCount = 0;
  nextTime = ctx.currentTime + 0.06;
  resetWatchdog();
  startTimer();
  tick();
  for (const b of document.querySelectorAll('.play')) { b.classList.add('on'); b.setAttribute('aria-label', 'Stop'); }
  setLogo(true);
}
function stop() {
  playing = false;
  if (timer) timer.postMessage('stop');
  if (engine) engine.panic();
  queue = [];
  setPlayhead(-1);
  for (const b of document.querySelectorAll('.play')) { b.classList.remove('on'); b.setAttribute('aria-label', 'Play'); }
  setLogo(false);
}
function togglePlay() { playing ? stop() : play(); }

/* Header logo: the melting smiley animates while playing (static frame when stopped or with reduced motion). */
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function setLogo(on) {
  const img = document.getElementById('logo');
  if (!img) return;
  img.src = on && !reduceMotion ? `icons/logo-melt.gif?${Date.now()}` : 'icons/logo-still.png';   // query restarts the GIF
}

/* ---------- watchdog: keeps playback alive ----------
   Runs twice a second while playing and repairs, in order of severity:
   - a suspended / interrupted AudioContext       -> resume it
   - the step clock stopped ticking               -> restart the timer
   - the audio clock froze, the context closed, or
     the output went silent / NaN when it shouldn't -> rebuild the whole audio engine and carry on */
let wd = { lastCt: -1, frozen: 0, silent: 0, lastRebuild: 0 };
function resetWatchdog() { wd.lastCt = -1; wd.frozen = 0; wd.silent = 0; }

function expectSound() {
  const bank = curBank();
  return TRACKS.some(t => trackAudible(state, t) && state.params[t].level > 0.05 &&
    (t === 'kick' || t === 'hats' ? bank[t].some(v => v) : bank[t].some(s => s.on)));
}

function rebuildAudio(reason) {
  const now = performance.now();
  if (now - wd.lastRebuild < 3000) return;          // don't thrash
  wd.lastRebuild = now;
  console.warn('Squelchbox: restarting audio engine —', reason);
  const old = ctx;
  ctx = null; engine = null;
  try {
    old.onstatechange = null;
    if (old.state !== 'closed') old.close().catch(() => {});
  } catch (e) { /* ignore */ }
  ensureAudio();
  queue = [];
  nextTime = ctx.currentTime + 0.08;
  resetWatchdog();
  toast('Audio restarted');
}

function watchdog() {
  if (!playing) return;
  try {
    if (!ctx || !engine || ctx.state === 'closed') return rebuildAudio('audio context closed');
    if (ctx.state !== 'running') ctx.resume().catch(() => {});

    if (performance.now() - lastTickAt > 400) {     // step clock stalled
      if (timer) { timer.postMessage('stop'); timer.postMessage('start'); } else startTimer();
      tick();
    }

    const ct = ctx.currentTime;
    wd.frozen = (ctx.state === 'running' && ct === wd.lastCt) ? wd.frozen + 1 : 0;
    wd.lastCt = ct;
    if (wd.frozen >= 4) return rebuildAudio('audio clock froze');

    if (engine.analyser) {
      if (!scopeData) scopeData = new Float32Array(engine.analyser.fftSize);
      engine.analyser.getFloatTimeDomainData(scopeData);
      let peak = 0, bad = false;
      for (let i = 0; i < scopeData.length; i++) {
        const x = scopeData[i];
        if (!isFinite(x)) { bad = true; break; }
        if (x > peak) peak = x; else if (-x > peak) peak = -x;
      }
      if (bad) return rebuildAudio('output became NaN');
      wd.silent = (peak < 1e-4 && expectSound()) ? wd.silent + 1 : 0;
      if (wd.silent >= 6) return rebuildAudio('output went silent');
    }
  } catch (e) {
    console.error('Squelchbox watchdog', e);
  }
}
setInterval(watchdog, 500);

function swingOffset(i, stepDur) { return i % 2 ? state.swing * 0.5 * stepDur : 0; }

function onBarStart() {
  if (barCount > 0 && state.chain) {
    state.bank = (state.bank + 1) % BANKS;
    renderBanks();
    renderAllGrids();
  }
  const drift = state.params.mutate.drift;
  if (barCount > 0 && drift > 0 && Math.random() < drift) {
    mutateAcid(state.banks[state.bank].acid, state.scale, drift);
    renderGrid('acid');
    save();
  }
  barCount++;
}

function tick() {
  if (!playing || !ctx || !engine) return;
  lastTickAt = performance.now();
  const stepDur = 60 / state.bpm / 4;
  const now = ctx.currentTime;

  // Fell behind (tab was frozen, main thread blocked, audio rebuilt): skip ahead on the grid instead of
  // firing a burst of late notes.
  if (nextTime < now - 0.2) {
    let guard = 0;
    while (nextTime < now && guard++ < 4096) {
      if (step === 0) onBarStart();
      nextTime += stepDur;
      step = (step + 1) % STEPS;
    }
    queue = [];
  }

  let guard = 0;
  while (nextTime < now + 0.12 && guard++ < 64) {
    // whatever goes wrong with one step, the clock must keep moving
    try {
      if (step === 0) onBarStart();
      const t = nextTime + swingOffset(step, stepDur);
      engine.playStep(state.banks[state.bank], step, t, stepDur);
      queue.push({ step, time: t });
    } catch (e) {
      console.error('Squelchbox: step', step, 'failed', e);
    }
    nextTime += stepDur;
    step = (step + 1) % STEPS;
  }
}

/* ---------- export ---------- */
async function exportWav() {
  const btn = $('#export');
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    const stepDur = 60 / state.bpm / 4;
    const banks = state.chain ? [0, 1, 2, 3] : [state.bank, state.bank, state.bank, state.bank];
    const loopLen = banks.length * STEPS * stepDur;
    const sr = 44100;
    // render the loop twice and keep the second pass, so delay tails wrap around seamlessly
    const oc = new OfflineAudioContext(2, Math.ceil(loopLen * 2 * sr), sr);
    const eng = new Engine(oc, {});
    eng.apply(state, true);
    for (let pass = 0; pass < 2; pass++) {
      banks.forEach((b, bar) => {
        for (let i = 0; i < STEPS; i++) {
          const t = pass * loopLen + (bar * STEPS + i) * stepDur + swingOffset(i, stepDur);
          eng.playStep(state.banks[b], i, t, stepDur);
        }
      });
    }
    const buf = await oc.startRendering();
    const blob = encodeWav(buf, Math.round(loopLen * sr), Math.round(loopLen * sr));
    const a = el('a', { href: URL.createObjectURL(blob), download: `squelchbox-${state.bpm}bpm-${state.chain ? 'chain' : BANK_NAMES[state.bank]}.wav` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Loop exported');
  } catch (e) {
    console.error(e);
    toast('Export failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export WAV';
  }
}

function encodeWav(buf, start, length) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate;
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  const bytes = 44 + length * ch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, length * ch * 2, true);
  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][start + i] || 0));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/* ---------- header ---------- */
const knobs = {};   // knobs[track][param] -> control

function buildHeader() {
  $('#play').addEventListener('click', togglePlay);
  $('#fab-play').addEventListener('click', togglePlay);
  // phones: the header scrolls away, so a floating play button takes over when it's out of view
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { $('#fab-play').hidden = e.isIntersecting; }).observe($('.top'));
  }

  knobs.tempo = {
    bpm: makeKnob({ label: 'Tempo', min: 60, max: 200, step: 1, value: state.bpm, def: 128, format: v => v, onInput: v => { state.bpm = v; applySound(); save(); } }),
    swing: makeKnob({ label: 'Swing', value: state.swing, def: 0, format: v => Math.round(50 + v * 25) + '%', onInput: v => { state.swing = v; save(); } })
  };
  $('#tempo').append(knobs.tempo.bpm.el, knobs.tempo.swing.el);

  const key = $('#key');
  NOTE_NAMES.forEach((n, i) => key.append(el('option', { value: i, text: n })));
  key.addEventListener('change', () => { state.key = +key.value; renderGrid('bass'); renderGrid('acid'); save(); });

  const scale = $('#scale');
  Object.keys(SCALES).forEach(s => scale.append(el('option', { value: s, text: s })));
  scale.addEventListener('change', () => { state.scale = scale.value; renderGrid('bass'); renderGrid('acid'); save(); });

  const bb = $('#bank-btns');
  BANK_NAMES.forEach((n, b) => bb.append(el('button', { type: 'button', text: n, title: `Bank ${n} (${b + 1})`, onclick: () => selectBank(b) })));

  $('#chain').addEventListener('click', () => { state.chain = !state.chain; renderBanks(); save(); });

  let clip = null;
  $('#copy').addEventListener('click', () => { clip = JSON.parse(JSON.stringify(curBank())); $('#paste').disabled = false; toast(`Bank ${BANK_NAMES[state.bank]} copied`); });
  $('#paste').addEventListener('click', () => { if (!clip) return; state.banks[state.bank] = JSON.parse(JSON.stringify(clip)); renderAllGrids(); save(); toast(`Pasted into bank ${BANK_NAMES[state.bank]}`); });
  $('#clear-bank').addEventListener('click', () => { state.banks[state.bank] = emptyBank(); renderAllGrids(); save(); });
  $('#export').addEventListener('click', exportWav);
}

function syncHeader() {
  knobs.tempo.bpm.set(state.bpm);
  knobs.tempo.swing.set(state.swing);
  $('#key').value = state.key;
  $('#scale').value = state.scale;
  renderBanks();
}

function renderBanks() {
  document.querySelectorAll('#bank-btns button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.bank)));
  $('#chain').setAttribute('aria-pressed', String(state.chain));
}
function selectBank(b) { state.bank = b; renderBanks(); renderAllGrids(); save(); }
const curBank = () => state.banks[state.bank];

/* ---------- rack ---------- */
const grids = {}, cols = {}, trackUi = {};

/* Sync mute/solo buttons and dim every track that is currently silent. */
function refreshAudible() {
  for (const t of TRACKS) {
    const u = trackUi[t];
    if (!u) continue;
    u.mute.setAttribute('aria-pressed', String(state.mute[t]));
    u.solo.setAttribute('aria-pressed', String(state.solo[t]));
    u.sec.classList.toggle('muted', !trackAudible(state, t));
  }
}

function buildParamControls(t, onChange, filter = () => true, opts = {}) {
  const row = el('div', { class: 'knob-row' });
  knobs[t] = knobs[t] || {};
  for (const p of PARAMS[t].filter(filter)) {
    const ctl = p.options
      ? makeSwitch({ label: p.label, options: p.options, value: state.params[t][p.id], onInput: v => onChange(p, v) })
      : makeKnob({ label: p.label, value: state.params[t][p.id], def: p.def, format: p.fmt, cls: opts.cls, aria: opts.aria && opts.aria(p), onInput: v => onChange(p, v) });
    if (p.send) ctl.el.style.setProperty('--c', `var(--${p.id})`);
    knobs[t][p.id] = ctl;
    row.append(ctl.el);
  }
  return row;
}

function buildTrack(t) {
  const sec = el('section', { class: `track ${t}`, 'aria-label': TRACK_NAMES[t] });
  const preset = el('select', { 'aria-label': `${TRACK_NAMES[t]} preset` });
  preset.append(el('option', { value: 'Custom', text: 'Custom', hidden: true }));
  Object.keys(PRESETS[t]).forEach(n => preset.append(el('option', { value: n, text: n })));
  preset.value = PRESETS[t][state.presets[t]] ? state.presets[t] : 'Custom';
  preset.addEventListener('change', () => {
    Object.assign(state.params[t], PRESETS[t][preset.value]);
    state.presets[t] = preset.value;
    for (const id in knobs[t]) knobs[t][id].set(state.params[t][id]);
    applySound();
    save();
  });

  const mute = el('button', { type: 'button', class: 'btn icon-btn mute', 'aria-label': `Mute ${TRACK_NAMES[t]}`, title: 'Mute', text: 'M' });
  const solo = el('button', { type: 'button', class: 'btn icon-btn solo', 'aria-label': `Solo ${TRACK_NAMES[t]}`, title: 'Solo (Alt-click or long-press: solo only this track)', text: 'S' });
  mute.addEventListener('click', () => { state.mute[t] = !state.mute[t]; refreshAudible(); applySound(); save(); });
  const soloOnly = () => {
    const only = !(state.solo[t] && TRACKS.every(x => x === t || !state.solo[x]));
    for (const x of TRACKS) state.solo[x] = only && x === t;
  };
  // long-press does what Alt-click does, for touch screens
  let pressTimer = null, longPressed = false;
  solo.addEventListener('pointerdown', () => {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressed = true; soloOnly(); refreshAudible(); applySound(); save(); }, 550);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) solo.addEventListener(ev, () => clearTimeout(pressTimer));
  solo.addEventListener('contextmenu', e => e.preventDefault());
  solo.addEventListener('click', e => {
    if (longPressed) { longPressed = false; return; }
    if (e.altKey) soloOnly();
    else state.solo[t] = !state.solo[t];
    refreshAudible();
    applySound();
    save();
  });
  trackUi[t] = { sec, mute, solo };

  const dice = el('button', { type: 'button', class: 'btn icon-btn', title: `New random ${TRACK_NAMES[t].toLowerCase()} pattern`, text: 'Random', onclick: () => { randomizeTrack(t); renderGrid(t); save(); } });
  const clear = el('button', { type: 'button', class: 'btn icon-btn', title: `Clear ${TRACK_NAMES[t].toLowerCase()}`, text: 'Clear', onclick: () => { curBank()[t] = emptyBank()[t]; renderGrid(t); save(); } });

  const knobRow = buildParamControls(t, (p, v) => {
    state.params[t][p.id] = v;
    if (p.id !== 'level') { state.presets[t] = 'Custom'; preset.value = 'Custom'; }
    applySound();
    save();
  });

  const head = el('div', { class: 't-head' }, el('h2', { text: TRACK_NAMES[t] }), preset, el('span', { class: 'spacer' }), dice, clear,
    el('div', { class: 'ms', role: 'group', 'aria-label': `${TRACK_NAMES[t]} mute and solo` }, mute, solo));
  grids[t] = el('div', { class: 'grid-wrap' });
  grids[t].addEventListener('click', e => onGridClick(t, e));
  sec.append(el('div', {}, head, knobRow), grids[t]);
  return sec;
}

function buildFx() {
  const sec = el('section', { class: 'track fx', 'aria-label': 'Effects' });
  const units = el('div', { class: 'fx-units' });

  for (const u of FX_UNITS) {
    const card = el('div', { class: `fx-unit ${u.id}`, role: 'group', 'aria-label': u.name });
    const change = (p, v) => { state.params[u.id][p.id] = v; applySound(); save(); };
    const head = el('div', { class: 'u-head' }, el('h3', { text: u.name }));

    if (u.bypass) {
      const on = el('button', { type: 'button', class: 'btn icon-btn toggle power', 'aria-label': `${u.name} on` });
      const sync = () => {
        on.setAttribute('aria-pressed', String(state.fxOn[u.id]));
        on.textContent = state.fxOn[u.id] ? 'On' : 'Off';
        card.classList.toggle('off', !state.fxOn[u.id]);
      };
      on.addEventListener('click', () => { state.fxOn[u.id] = !state.fxOn[u.id]; sync(); applySound(); save(); });
      sync();
      head.append(on);
    }
    card.append(head, buildParamControls(u.id, change, p => !p.send));

    if (PARAMS[u.id].some(p => p.send)) {
      const sends = buildParamControls(u.id, change, p => p.send, { cls: 'mini', aria: p => `${u.name} send from ${p.label}` });
      card.append(el('div', { class: 'sends' }, el('span', { class: 'rl', text: 'Sends' }), sends));
    }

    if (u.id === 'mutate') {
      card.append(el('div', { class: 'u-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Scramble acid', onclick: () => { mutateAcid(curBank().acid, state.scale, 0.8); renderGrid('acid'); save(); } }),
        el('button', { type: 'button', class: 'btn', text: 'Randomize bank', onclick: () => { TRACKS.forEach(randomizeTrack); renderAllGrids(); save(); } })));
    }
    card.append(el('p', { class: 'hint', text: u.note }));
    units.append(card);
  }

  sec.append(el('div', { class: 't-head' }, el('h2', { text: 'FX' })), units);
  return sec;
}

function randomizeTrack(t) {
  const b = curBank();
  if (t === 'kick') b.kick = randomKick();
  else if (t === 'hats') b.hats = randomHats();
  else if (t === 'bass') b.bass = randomBass(state.scale);
  else b.acid = randomAcid(state.scale);
}

/* ---------- grids ---------- */
const BLACK = new Set([1, 3, 6, 8, 10]);

/* Phones show the 16 steps as two rows of 8; wider screens one row of 16. */
const narrowMq = window.matchMedia('(max-width: 640px)');

function renderGrid(t) {
  const wrap = grids[t];
  const c = cols[t] = Array.from({ length: STEPS }, () => []);
  const per = narrowMq.matches ? 8 : STEPS;
  const parts = [];
  for (let start = 0; start < STEPS; start += per) parts.push(buildGrid(t, start, start + per, c, per < STEPS));
  wrap.replaceChildren(...parts);
  if (playhead >= 0) c[playhead].forEach(x => x.classList.add('now'));
}

function buildGrid(t, from, to, c, numbered) {
  const bank = curBank();
  const n16 = to - from;
  const range = Array.from({ length: n16 }, (_, k) => from + k);
  const numbers = grid => {
    if (!numbered) return;
    grid.append(el('div', { class: 'rl' }));
    range.forEach(i => grid.append(el('div', { class: `num${i % 4 === 0 ? ' beat' : ''}`, text: i + 1, 'aria-hidden': 'true' })));
  };
  let grid;

  if (t === 'kick' || t === 'hats') {
    grid = el('div', { class: 'steps', style: `--cols:${n16}` });
    numbers(grid);
    grid.append(el('div', { class: 'rl', text: t === 'kick' ? 'Hit' : 'Hat' }));
    const names = t === 'kick' ? ['off', 'on', 'accent'] : ['off', 'closed', 'open'];
    for (const i of range) {
      const v = bank[t][i];
      const b = el('button', { type: 'button', class: `step s${v}${i % 4 === 0 ? ' beat' : ''}`, 'aria-label': `Step ${i + 1}: ${names[v]}`, text: v === 2 ? (t === 'kick' ? '>' : 'o') : '' });
      b.dataset.kind = 'step'; b.dataset.i = i;
      grid.append(b); c[i].push(b);
    }
  } else {
    grid = el('div', { class: 'roll', style: `--cols:${n16}` });
    numbers(grid);
    const steps = bank[t];
    const inScale = new Set(SCALES[state.scale]);
    for (let n = 11; n >= 0; n--) {
      const pc = (state.key + n) % 12;
      grid.append(el('div', { class: `rl${n === 0 ? ' root' : ''}`, text: NOTE_NAMES[pc] }));
      for (const i of range) {
        const s = steps[i];
        const on = s.on && s.note === n;
        let cls = 'cell';
        if (BLACK.has(pc)) cls += ' black';
        if (i % 4 === 0) cls += ' beat';
        if (inScale.has(n)) cls += ' inscale';
        if (on) cls += ' on';
        if (on && s.acc) cls += ' acc';
        const b = el('button', { type: 'button', class: cls, 'aria-label': `Step ${i + 1} ${NOTE_NAMES[pc]}${on ? ' (on)' : ''}` });
        b.dataset.kind = 'note'; b.dataset.i = i; b.dataset.n = n;
        grid.append(b); c[i].push(b);
      }
    }
    grid.append(el('div', { class: 'sep' }));
    const rows = t === 'acid'
      ? [['oct', 'Oct', s => (s.oct > 0 ? '+' : s.oct < 0 ? '−' : '·'), s => s.oct !== 0],
         ['acc', 'Acc', s => (s.acc ? '>' : '·'), s => s.acc],
         ['slide', 'Slide', s => (s.slide ? '~' : '·'), s => s.slide]]
      : [['oct', 'Oct', s => (s.oct > 0 ? '+' : '·'), s => s.oct !== 0]];
    for (const [kind, label, txt, isSet] of rows) {
      grid.append(el('div', { class: 'rl', text: label }));
      for (const i of range) {
        const s = steps[i];
        const b = el('button', { type: 'button', class: `ctl${i % 4 === 0 ? ' beat' : ''}${isSet(s) ? ' set' : ''}${s.on ? '' : ' dim'}`, 'aria-label': `Step ${i + 1} ${label}`, text: txt(s) });
        b.dataset.kind = kind; b.dataset.i = i;
        grid.append(b); c[i].push(b);
      }
    }
  }
  return grid;
}
function renderAllGrids() { TRACKS.forEach(renderGrid); }

function onGridClick(t, e) {
  const b = e.target.closest('button');
  if (!b || !b.dataset.kind) return;
  const i = +b.dataset.i;
  const bank = curBank();
  const kind = b.dataset.kind;
  if (kind === 'step') {
    bank[t][i] = (bank[t][i] + 1) % 3;
  } else {
    const s = bank[t][i];
    if (kind === 'note') {
      const n = +b.dataset.n;
      if (s.on && s.note === n) s.on = false;
      else { s.on = true; s.note = n; preview(t, s); }
    } else if (kind === 'oct') {
      s.oct = t === 'acid' ? (s.oct === 0 ? 1 : s.oct === 1 ? -1 : 0) : (s.oct ? 0 : 1);
      if (s.on) preview(t, s);
    } else if (kind === 'acc') s.acc = !s.acc;
    else if (kind === 'slide') s.slide = !s.slide;
  }
  renderGrid(t);
  save();
}

/* Audition a note when editing while stopped. */
function preview(t, s) {
  if (playing) return;
  try {
    ensureAudio();
    const now = ctx.currentTime + 0.01;
    if (t === 'bass') engine.bass(now, s);
    else {
      const fake = { acid: [{ ...s, slide: false }, ...Array.from({ length: STEPS - 1 }, () => ({ on: false }))] };
      engine.acidTie = false;
      engine.acid(fake, 0, now, 0.22);
    }
  } catch (e) { console.error(e); }
}

function setPlayhead(i) {
  if (i === playhead) return;
  for (const t of TRACKS) {
    if (!cols[t]) continue;
    if (playhead >= 0) cols[t][playhead].forEach(x => x.classList.remove('now'));
    if (i >= 0) cols[t][i].forEach(x => x.classList.add('now'));
  }
  playhead = i;
}

/* ---------- frame loop: playhead + scope ---------- */
const scope = $('#scope');
const sctx = scope.getContext('2d');
let scopeData = null;

function frame() {
  if (playing && ctx) {
    let cur = null;
    while (queue.length && queue[0].time <= ctx.currentTime) cur = queue.shift();
    if (cur) setPlayhead(cur.step);
  }
  drawScope();
  requestAnimationFrame(frame);
}

function drawScope() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(scope.clientWidth * dpr), h = Math.round(scope.clientHeight * dpr);
  if (scope.width !== w || scope.height !== h) { scope.width = w; scope.height = h; }
  sctx.clearRect(0, 0, w, h);
  sctx.lineWidth = 1.6 * dpr;
  sctx.strokeStyle = '#ff7a2e';
  sctx.beginPath();
  if (engine && engine.analyser) {
    if (!scopeData) scopeData = new Float32Array(engine.analyser.fftSize);
    engine.analyser.getFloatTimeDomainData(scopeData);
    // find a rising zero crossing so the trace sits still
    let s0 = 0;
    for (let i = 1; i < scopeData.length / 2; i++) if (scopeData[i - 1] < 0 && scopeData[i] >= 0) { s0 = i; break; }
    const n = 1024;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h / 2 - (scopeData[s0 + i] || 0) * h * 0.45;
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
  } else {
    sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2);
  }
  sctx.stroke();
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  if (e.target.closest('select, input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (/^[1-4]$/.test(e.key)) selectBank(+e.key - 1);
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && e.target.closest('button')) e.preventDefault(); });

/* ---------- boot ---------- */
(async function init() {
  try { state = sanitizeState(await store.get()); } catch (e) { state = defaultState(); }
  buildHeader();
  const rack = $('#rack');
  TRACKS.forEach(t => rack.append(buildTrack(t)));
  rack.append(buildFx());
  refreshAudible();
  syncHeader();
  renderAllGrids();
  narrowMq.addEventListener('change', renderAllGrids);
  requestAnimationFrame(frame);
})();
