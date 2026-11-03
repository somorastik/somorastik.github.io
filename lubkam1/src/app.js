/* LubkaM1 front panel. GPL-3.0-only (see notes on the page). */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const META = JSON.parse($('#d-meta').textContent);
  const TJ = JSON.parse($('#d-tables').textContent);
  const BANKS = JSON.parse($('#d-banks').textContent);
  const P = META.P, END = META.END, PARAMS = META.params, MENUS = META.menus;
  const PNAME = []; for (const k in P) if (PNAME[P[k]] === undefined) PNAME[P[k]] = k;
  for (let i = 0; i < PARAMS.length; i++) if (PARAMS[i]) PNAME[i] = PARAMS[i].n;

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const tables = (() => {
    const i16 = (s) => { const u = b64(s); return new Int16Array(u.buffer); };
    const i8 = (s) => { const u = b64(s); return new Int8Array(u.buffer); };
    return { sine: i16(TJ.sine), saw: i16(TJ.saw), tri: i16(TJ.tri), rec: i16(TJ.rec), trans: i8(TJ.trans), notes: TJ.notes, ecc83: TJ.ecc83, diode: TJ.diode };
  })();
  // the firmware's 8-character LCD words, spelled out for a wider screen
  const WORDS = { Oscilltr: 'Oscillator', 'Nois/Osc': 'Noise / osc', 'Mod EG': 'Pitch EG', 'Mod Osc': 'Mod osc', PitchMod: 'Pitch mod', Transnt: 'Click', 'Veloc EG': 'Amp EG', Generatr: 'Generator', Parametr: 'Parameter', Sequencr: 'Sequencer', Fx: 'FX',
    AudioOut: 'audio out', 'Dcy Clsd': 'decay (closed)', 'Dcy Open': 'decay (open)', DstParam: 'target', DstVoice: 'target voice', 'Freqcy 1': 'frequency 1', 'Freqcy 2': 'frequency 2', Frequncy: 'frequency', Overdriv: 'overdrive', Panning: 'pan', Prbablty: 'probability', PulsWdth: 'pulse width', RepeatCt: 'repeats', Resnance: 'resonance', Retriggr: 'retrigger', SampleRt: 'sample rate', Threshld: 'threshold', 'Vol mod': 'velocity to volume', ClockSnc: 'tempo sync', 'Aut Dest': 'automation target', AutValue: 'automation value' };
  const nice = (cat, lng) => { const c = WORDS[cat] || cat || ''; let l = WORDS[lng] || (lng || '').toLowerCase(); return (c + ' ' + l).trim().replace(/^./, (x) => x.toUpperCase()); };
  const MT = META.modTargets; // [[short,cat,long], param, name]
  const modTargetParams = MT.map((m) => m[1]);

  /* ---------------------------------------------------------------- model */
  const TRACKS = [
    { name: 'Drum 1', short: 'D1', voice: 0 }, { name: 'Drum 2', short: 'D2', voice: 1 }, { name: 'Drum 3', short: 'D3', voice: 2 },
    { name: 'Snare', short: 'SN', voice: 3 }, { name: 'Cymbal', short: 'CY', voice: 4 },
    { name: 'Hat closed', short: 'CH', voice: 5 }, { name: 'Hat open', short: 'OH', voice: 5 },
  ];
  const PAGE_NAMES = ['Osc', 'Amp', 'Mod', 'FM', 'Click', 'Filter', 'LFO', 'Mix'];
  const SKIP = new Set(['PAR_NONE', 'PAR_MIDI_CHAN_1', 'PAR_MIDI_CHAN_2', 'PAR_MIDI_CHAN_3', 'PAR_MIDI_CHAN_4', 'PAR_MIDI_CHAN_5', 'PAR_MIDI_CHAN_6', 'PAR_MIDI_CHAN_7', 'PAR_MIDI_NOTE1', 'PAR_MIDI_NOTE2', 'PAR_MIDI_NOTE3', 'PAR_MIDI_NOTE4', 'PAR_MIDI_NOTE5', 'PAR_MIDI_NOTE6', 'PAR_MIDI_NOTE7']);
  // modulation-target index -> voice (blocks in the firmware table start at each voice's coarse tune)
  const mtVoice = MT.map(() => -1);
  { let cur = -1; MT.forEach((m, i) => { const mm = /^PAR_COARSE(\d)$/.exec(m[2]); if (mm) cur = +mm[1] - 1; if (i >= 2) mtVoice[i] = cur; }); }
  const targetsFor = (voice) => [0].concat(MT.map((m, i) => i).filter((i) => i >= 1 && (mtVoice[i] === voice || i === 1)));
  const autoDest = (param) => (param < 128 ? param + 1 : param);
  const autoName = (dest) => {
    if (dest === 255) return ['off', 'No automation'];
    const p = dest > 127 ? dest : dest - 1;
    const i = MT.findIndex((m, k) => k > 0 && m[1] === p);
    return i > 0 ? [MT[i][0][0], nice(MT[i][0][1], MT[i][0][2])] : ['p' + p, PNAME[p] || 'Parameter ' + p];
  };

  const emptySteps = () => Array.from({ length: 7 }, () => Array.from({ length: 64 }, () => [0, 127, 100, 60, 0, 7, 255, 0, 255, 0]));
  const fromFile = (p) => {
    const steps = emptySteps(), len = [];
    for (let t = 0; t < 7; t++) {
      for (const s of p.tracks[t].s) steps[t][s[0]] = [1, s[1], s[2], s[3], s[4] & 15, s[4] >> 4, s[5], s[6], s[7], s[8]];
      len.push(p.tracks[t].len > 0 && p.tracks[t].len <= 64 ? p.tracks[t].len : 16);
    }
    return { steps, len, shuffle: p.shuffle || 0, kit: p.kit || 0 };
  };
  const projects = BANKS.map((b) => ({
    label: b.label, credit: b.credit || '',
    kits: b.kits.map((k) => ({ slot: k.slot, name: k.name, p: b64(k.p) })),
    pats: (() => { const a = new Array(16).fill(null); for (const p of b.pats) if (p.slot < 16) a[p.slot] = fromFile(p); return a; })(),
  }));

  const S = {
    proj: 0, kitIdx: 0, kit: new Uint8Array(END), loaded: new Uint8Array(END), kitName: '',
    morph: 0, morphIdx: -1,
    pat: 0, pending: -1, track: 0, page: 0, bar: 0, sel: -1, follow: true, kitFollow: true,
    playing: false, bpm: 120, swing: 0, faders: [1, 1, 1, 1, 1, 1], master: 0.75, mutes: [0, 0, 0, 0, 0, 0, 0],
    stepIdx: [-1, -1, -1, -1, -1, -1, -1], focus: null,
  };
  const proj = () => projects[S.proj];
  const curPat = () => { const pr = proj(); if (!pr.pats[S.pat]) pr.pats[S.pat] = { steps: emptySteps(), len: [16, 16, 16, 16, 16, 16, 16], shuffle: 0, kit: pr.kits[S.kitIdx] ? pr.kits[S.kitIdx].slot : 0 }; return pr.pats[S.pat]; };

  /* ---------------------------------------------------------------- audio */
  let ctx = null, node = null, mode = 'off', mainEngine = null;
  const pendingMsgs = [];
  function post(m) { if (node && mode === 'worklet') node.port.postMessage(m); else if (mainEngine) mainEngine.handle(m); else pendingMsgs.push(m); }
  const initMsg = () => ({ t: 'init', tables, P, END, modTargetParams });
  async function ensureAudio() {
    if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
    try { ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' }); } catch (e) { ctx = new AudioContext(); }
    const tryWorklet = async (url) => { await ctx.audioWorklet.addModule(url); return new AudioWorkletNode(ctx, 'lubka-m1', { numberOfInputs: 0, outputChannelCount: [2] }); };
    let wn = null;
    if (ctx.audioWorklet) {
      try { wn = await tryWorklet('engine.js'); } catch (e) {
        try { const tag = $('#engine-src'); const src = tag ? tag.textContent : await (await fetch('engine.js')).text(); wn = await tryWorklet(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); } catch (e2) { wn = null; }
      }
    }
    if (wn) {
      node = wn; mode = 'worklet';
      node.port.onmessage = (e) => onEngine(e.data);
      node.connect(ctx.destination);
      node.port.postMessage(initMsg());
    } else {
      // fallback: same engine on the main thread
      mainEngine = new window.LubkaEngine(ctx.sampleRate, initMsg());
      const sp = ctx.createScriptProcessor(1024, 0, 2);
      let meterN = 0;
      sp.onaudioprocess = (ev) => {
        const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
        mainEngine.process(L, R, L.length);
        if (mainEngine.events.length) { onEngine({ t: 'events', ev: mainEngine.events.slice() }); mainEngine.events.length = 0; }
        if (++meterN % 2 === 0) { onEngine({ t: 'meter', l: mainEngine.meterL, r: mainEngine.meterR }); mainEngine.meterL = mainEngine.meterR = 0; }
      };
      sp.connect(ctx.destination); node = sp; mode = 'main';
      onEngine({ t: 'ready', fs: ctx.sampleRate });
    }
    for (const m of pendingMsgs.splice(0)) post(m);
    syncAll();
    if (ctx.state === 'suspended') await ctx.resume();
  }
  function syncAll() {
    post({ t: 'kit', p: Array.from(effectiveKit()) });
    post({ t: 'bpm', v: S.bpm });
    post({ t: 'shuffle', v: S.swing / 127 });
    S.faders.forEach((v, i) => post({ t: 'fader', v: i, val: v }));
    post({ t: 'master', val: S.master });
    S.mutes.forEach((m, t) => post({ t: 'mute', track: t, on: m }));
    sendPattern();
  }
  const enginePat = (pt) => ({ steps: pt.steps, len: pt.len });
  function sendPattern() { post({ t: 'pattern', pat: enginePat(curPat()) }); }

  /* kit + morph */
  const NO_MORPH = new Set();
  ['PAR_VEL_DEST_', 'PAR_TARGET_LFO', 'PAR_VOICE_LFO'].forEach((pre) => { for (let n = 1; n <= 6; n++) { const k = P[pre + n]; if (k !== undefined) NO_MORPH.add(k); } });
  function effectiveKit() {
    if (!S.morph || S.morphIdx < 0) return S.kit;
    const b = proj().kits[S.morphIdx]; if (!b) return S.kit;
    const out = new Uint8Array(END), x = S.morph / 127;
    for (let i = 0; i < END; i++) out[i] = NO_MORPH.has(i) ? S.kit[i] : Math.round(S.kit[i] + (b.p[i] - S.kit[i]) * x);
    return out;
  }
  function loadKit(idx, send = true) {
    const k = proj().kits[idx]; if (!k) return;
    S.kitIdx = idx; S.kit = new Uint8Array(k.p); S.loaded = new Uint8Array(k.p); S.kitName = k.name;
    if (send) post({ t: 'kit', p: Array.from(effectiveKit()) });
    renderKitSelect(); renderKnobs(); renderVfd();
  }
  function setParam(p, v) {
    S.kit[p] = v;
    if (S.morph && S.morphIdx >= 0) post({ t: 'kit', p: Array.from(effectiveKit()) });
    else post({ t: 'param', i: p, v });
  }

  /* ---------------------------------------------------------------- engine events */
  let readyFs = 0;
  function onEngine(m) {
    if (m.t === 'ready') { readyFs = m.fs; renderStatus(); return; }
    if (m.t === 'meter') { meter(m.l, m.r); return; }
    if (m.t === 'events') for (const ev of m.ev) {
      if (ev.t === 'step') { S.stepIdx = ev.idx; playhead(); }
      else if (ev.t === 'trig') flash(ev.track);
      else if (ev.t === 'patswitch') {
        if (S.pending >= 0) { S.pat = S.pending; S.pending = -1; const pt = curPat(); if (S.kitFollow) { const ki = proj().kits.findIndex((k) => k.slot === pt.kit); if (ki >= 0) loadKit(ki, false); } S.swing = pt.shuffle; renderTransport(); renderPatterns(); renderGrid(); renderKnobs(); renderVfd(); }
      }
    }
  }

  /* ---------------------------------------------------------------- value formatting */
  const dt = (p) => PARAMS[p] || { t: 'DTYPE_0B127', menu: null };
  function range(p, track) {
    const d = dt(p);
    if (d.t === 'DTYPE_MENU') { const names = MENUS[d.menu] || []; const n = d.menu === 'MENU_FX' ? 5 : names.length; return { min: 0, max: Math.max(1, n - 1) }; }
    if (d.t === 'DTYPE_ON_OFF') return { min: 0, max: 1 };
    if (d.t === 'DTYPE_0B100') return { min: 0, max: 100 };
    if (d.t === 'DTYPE_VOICE_LFO') return { min: 1, max: 6 };
    if (d.t === 'DTYPE_TARGET_SELECTION_LFO' || d.t === 'DTYPE_TARGET_SELECTION_VELO') return { list: listFor(p, track) };
    return { min: 0, max: 127 };
  }
  function listFor(p, track) {
    const name = PNAME[p] || '';
    const m = /^PAR_TARGET_LFO(\d)$/.exec(name);
    if (m) { const vi = Math.min(6, Math.max(1, S.kit[P['PAR_VOICE_LFO' + m[1]]] || 1)) - 1; return targetsFor(vi); }
    return targetsFor(TRACKS[track].voice);
  }
  function fmt(p, v) {
    const d = dt(p);
    switch (d.t) {
      case 'DTYPE_PM63': { const x = v - 63; return (x > 0 ? '+' : '') + x; }
      case 'DTYPE_MENU': { const n = MENUS[d.menu]; return n && n[v] !== undefined ? n[v] : String(v); }
      case 'DTYPE_ON_OFF': return v ? 'on' : 'off';
      case 'DTYPE_VOICE_LFO': return TRACKS[Math.max(0, Math.min(5, v - 1))].short;
      case 'DTYPE_TARGET_SELECTION_LFO': case 'DTYPE_TARGET_SELECTION_VELO': { const t = MT[v]; return !t || v === 0 ? 'off' : t[0][0]; }
    }
    return String(v);
  }
  function longFmt(p, v) {
    const d = dt(p);
    if (d.t === 'DTYPE_TARGET_SELECTION_LFO' || d.t === 'DTYPE_TARGET_SELECTION_VELO') {
      const t = MT[v]; if (!t || v === 0) return 'off';
      const vi = mtVoice[v]; return (vi >= 0 ? TRACKS[vi === 5 ? 5 : vi].short + ' ' : '') + nice(t[0][1], t[0][2]);
    }
    if (d.t === 'DTYPE_MENU') { const nm = { MENU_WAVEFORM: ['sine', 'triangle', 'saw', 'square', 'noise', 'pulse'], MENU_FILTER: ['low-pass', 'high-pass', 'band-pass', 'unity band-pass', 'notch', 'peak', 'low-pass 2-pole', 'off'], MENU_FX: ['off', 'distortion', 'ring mod', 'compressor', 'delay'], MENU_DIST: ['tube', 'wavefolder', 'diode clipper'], MENU_DELAY: ['mono', 'ping-pong'], MENU_AUDIO_OUT: ['stereo 1', 'stereo 2', 'left 1', 'right 1', 'left 2', 'right 2', 'FX bus'], MENU_AUDIO_OUT_FX: ['stereo 1', 'stereo 2', 'left 1', 'right 1', 'left 2', 'right 2'] }[d.menu]; if (nm && nm[v] !== undefined) return nm[v]; }
    return fmt(p, v);
  }

  /* ---------------------------------------------------------------- page definitions */
  const FLAMS = ['off', 'x2', 'x3', 'x4', 'x6', 'x8'];
  function pageEntries() {
    const t = S.track;
    if (S.page === 'fx') {
      const ty = Math.min(4, S.kit[P.PAR_FX_TYPE]);
      const pages = { 0: 77, 1: 78, 3: 79, 4: 80 };
      if (ty === 2) return [['typ', 'PAR_FX_TYPE'], ['out', 'PAR_FX_ROUTING'], ['d/w', 'PAR_FX_DRY_WET'], ['wav', 'PAR_FX_WAVE'], ['frq', 'PAR_FX_P1']].map(([s, n]) => kitKnob(P[n], s, fxLong(n, ty)));
      return META.pages[pages[ty]].filter((e) => e[3] !== 'PAR_NONE').map((e) => kitKnob(e[1], e[0][0], fxLong(e[3], ty, e[0])));
    }
    if (S.page === 'step') return stepKnobs();
    const pg = META.pages[t * 8 + S.page] || [];
    const out = [];
    for (const e of pg) {
      if (SKIP.has(e[3])) continue;
      if (e[3] === 'PAR_TRACK_LENGTH') { out.push(lenKnob()); continue; }
      out.push(kitKnob(e[1], e[0][0], nice(e[0][1], e[0][2])));
    }
    // the hat's amp page shows both decays so either hat track can reach them
    if ((t === 5 || t === 6) && S.page === 1) {
      const have = new Set(out.map((k) => k.p));
      const add = t === 5 ? 'PAR_VELOD6_OPEN' : 'PAR_VELOD6_CLOSED';
      if (!have.has(P[add])) out.splice(2, 0, kitKnob(P[add], t === 5 ? 'd2' : 'd1', t === 5 ? 'Amp decay (open hat)' : 'Amp decay (closed hat)'));
    }
    return out;
  }
  function fxLong(name, ty, e) {
    const L = { PAR_FX_TYPE: 'FX type', PAR_FX_ROUTING: 'FX output', PAR_FX_DRY_WET: 'Dry / wet %', PAR_FX_DIST_TYPE: 'Distortion type', PAR_FX_RATIO: 'Ratio', PAR_FX_WAVE: 'Ring carrier wave', PAR_FX_DELAY_TYPE: 'Delay type' };
    if (L[name]) return L[name];
    const per = { 1: ['Drive', 'Colour', 'Tone', 'Output'], 2: ['Carrier frequency'], 3: ['Attack', 'Release', 'Threshold', 'Make-up gain'], 4: ['Time', 'Range', 'Tone', 'Feedback'] }[ty] || [];
    const k = { PAR_FX_P1: 0, PAR_FX_P2: 1, PAR_FX_P3: 2, PAR_FX_P4: 3 }[name];
    return per[k] || (e ? e[2] : name);
  }
  function kitKnob(p, short, long) {
    const r = range(p, S.track);
    return {
      p, short, long, kind: 'kit',
      get: () => S.kit[p], set: (v) => { setParam(p, v); if (/VOICE_LFO|FX_TYPE/.test(PNAME[p])) renderKnobs(); },
      list: r.list, min: r.min, max: r.max, fmt: (v) => fmt(p, v), longFmt: (v) => longFmt(p, v), def: () => S.loaded[p],
    };
  }
  function lenKnob() {
    const t = S.track;
    return { short: 'len', long: 'Track length (steps)', kind: 'len', min: 1, max: 64, get: () => curPat().len[t], set: (v) => { curPat().len[t] = v; sendPattern(); renderGrid(); }, fmt: String, longFmt: String, def: () => 16 };
  }
  function stepKnobs() {
    const t = S.track, i = S.sel;
    const st = () => curPat().steps[t][S.sel];
    const mk = (short, long, idx, min, max, f, lf) => ({ short, long, kind: 'step', min, max, get: () => (S.sel < 0 ? min : st()[idx]), set: (v) => { if (S.sel < 0) return; st()[idx] = v; sendPattern(); renderGrid(); }, fmt: f || String, longFmt: lf || f || String, def: () => min });
    const noteName = (n) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n % 12] + (Math.floor(n / 12) - 1);
    const dests = [255].concat(targetsFor(TRACKS[t].voice).filter((k) => k > 0).map((k) => autoDest(MT[k][1])));
    const dk = (short, idx, n) => ({ short, long: 'Automation ' + n + ' target', kind: 'step', list: dests, get: () => (S.sel < 0 ? 255 : st()[idx]), set: (v) => { if (S.sel < 0) return; st()[idx] = v; sendPattern(); renderGrid(); }, fmt: (v) => autoName(v)[0], longFmt: (v) => autoName(v)[1], def: () => 255 });
    void i;
    return [
      mk('vel', 'Step velocity', 1, 0, 127),
      mk('nte', 'Step note (60 = kit pitch)', 3, 0, 127, (v) => String(v), (v) => noteName(v) + ' · ' + (v - 60 >= 0 ? '+' : '') + (v - 60) + ' st'),
      mk('prb', 'Step probability %', 2, 0, 100),
      mk('flm', 'Flam / ratchet', 4, 0, 5, (v) => FLAMS[v] || v),
      mk('shf', 'Micro shift (1/8 step)', 5, 0, 14, (v) => { const x = v - 7; return (x > 0 ? '+' : '') + x; }),
      dk('a1', 6, 1), mk('v1', 'Automation 1 value', 7, 0, 127),
      dk('a2', 8, 2), mk('v2', 'Automation 2 value', 9, 0, 127),
    ];
  }

  /* ---------------------------------------------------------------- knobs */
  const knobsEl = $('#knobs');
  let knobDefs = [];
  function renderKnobs() {
    knobDefs = pageEntries();
    knobsEl.innerHTML = '';
    knobsEl.dataset.count = knobDefs.length;
    if (S.page === 'step' && S.sel < 0) {
      const hint = h('p', 'knob-hint', 'Pick a step to edit: right-click, long-press or shift-click a step in the sequencer below.');
      knobsEl.appendChild(hint);
    }
    knobDefs.forEach((k, i) => knobsEl.appendChild(makeKnob(k, i)));
    renderPages();
  }
  function knobValueIndex(k) { return k.list ? Math.max(0, k.list.indexOf(k.get())) : k.get(); }
  function makeKnob(k, i) {
    const wrap = h('div', 'knob');
    const dial = h('div', 'dial');
    dial.tabIndex = 0; dial.setAttribute('role', 'slider'); dial.id = 'knob-' + i;
    dial.setAttribute('aria-label', k.long);
    dial.innerHTML = '<svg viewBox="0 0 60 60" aria-hidden="true"><path class="arc-bg" d=""/><path class="arc" d=""/><circle class="cap" cx="30" cy="30" r="17"/><line class="tick" x1="30" y1="30" x2="30" y2="15"/></svg>';
    const lab = h('div', 'k-label', k.short);
    const val = h('output', 'k-val');
    wrap.append(dial, val, lab);
    const lo = () => (k.list ? 0 : k.min), hi = () => (k.list ? k.list.length - 1 : k.max);
    const arcPath = (a0, a1) => { const r = 24, cx = 30, cy = 30; const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); const large = a1 - a0 > Math.PI ? 1 : 0; return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    dial.querySelector('.arc-bg').setAttribute('d', arcPath(A0, A1));
    const draw = () => {
      const vi = knobValueIndex(k), x = (vi - lo()) / Math.max(1, hi() - lo());
      const a = A0 + (A1 - A0) * x;
      dial.querySelector('.arc').setAttribute('d', x > 0.001 ? arcPath(A0, a) : '');
      const tick = dial.querySelector('.tick');
      tick.setAttribute('x2', (30 + 15 * Math.cos(a)).toFixed(2)); tick.setAttribute('y2', (30 + 15 * Math.sin(a)).toFixed(2));
      const v = k.get();
      val.textContent = k.fmt(v);
      dial.setAttribute('aria-valuetext', k.longFmt(v));
      dial.setAttribute('aria-valuenow', vi); dial.setAttribute('aria-valuemin', lo()); dial.setAttribute('aria-valuemax', hi());
    };
    const setIdx = (vi) => {
      vi = Math.round(Math.max(lo(), Math.min(hi(), vi)));
      const v = k.list ? k.list[vi] : vi;
      if (v !== k.get()) { k.set(v); }
      draw(); S.focus = k; renderVfd();
    };
    k.draw = draw;
    draw();
    let drag = null;
    dial.addEventListener('pointerdown', (e) => { ensureAudio(); dial.setPointerCapture(e.pointerId); drag = { y: e.clientY, v: knobValueIndex(k) }; S.focus = k; renderVfd(); dial.classList.add('on'); e.preventDefault(); });
    dial.addEventListener('pointermove', (e) => { if (!drag) return; const span = hi() - lo(); const px = e.shiftKey ? 600 : 180; setIdx(drag.v + ((drag.y - e.clientY) / px) * Math.max(span, 6)); });
    const end = () => { drag = null; dial.classList.remove('on'); };
    dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
    dial.addEventListener('wheel', (e) => { e.preventDefault(); setIdx(knobValueIndex(k) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 8 : 1)); }, { passive: false });
    dial.addEventListener('dblclick', () => { const d = k.def(); setIdx(k.list ? Math.max(0, k.list.indexOf(d)) : d); });
    dial.addEventListener('focus', () => { S.focus = k; renderVfd(); });
    dial.addEventListener('keydown', (e) => {
      const m = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (m) { e.preventDefault(); setIdx(knobValueIndex(k) + m); }
      else if (e.key === 'Home') { e.preventDefault(); setIdx(lo()); }
      else if (e.key === 'End') { e.preventDefault(); setIdx(hi()); }
    });
    return wrap;
  }
  const redrawKnobs = () => knobDefs.forEach((k) => k.draw && k.draw());

  /* ---------------------------------------------------------------- display */
  const vfd = { track: $('#v-track'), page: $('#v-page'), pname: $('#v-pname'), pval: $('#v-pval'), kit: $('#v-kit'), pat: $('#v-pat'), pos: $('#v-pos'), tempo: $('#v-tempo'), leds: $('#v-leds') };
  function pageLabel() { return S.page === 'fx' ? 'FX bus' : S.page === 'step' ? 'Step ' + (S.sel >= 0 ? String(S.sel + 1).padStart(2, '0') : '--') : PAGE_NAMES[S.page]; }
  function renderVfd() {
    vfd.track.textContent = S.page === 'fx' ? 'Master' : TRACKS[S.track].name;
    vfd.page.textContent = pageLabel();
    const k = S.focus || knobDefs[0];
    if (k) { vfd.pname.textContent = k.long; vfd.pval.textContent = k.longFmt(k.get()); } else { vfd.pname.textContent = ''; vfd.pval.textContent = ''; }
    vfd.kit.textContent = (S.kitName || '—') + (S.morph && S.morphIdx >= 0 ? ' ⇢ ' + proj().kits[S.morphIdx].name + ' ' + Math.round((S.morph / 127) * 100) + '%' : '');
    vfd.pat.textContent = 'P' + String(S.pat + 1).padStart(2, '0') + (S.pending >= 0 ? ' → P' + String(S.pending + 1).padStart(2, '0') : '');
    vfd.tempo.textContent = S.bpm + ' bpm';
    renderPos();
  }
  function renderPos() {
    const i = S.stepIdx[S.track];
    vfd.pos.textContent = i >= 0 ? 'bar ' + (Math.floor(i / 16) + 1) + ' · step ' + String((i % 16) + 1).padStart(2, '0') : S.playing ? '' : 'stopped';
  }
  for (let t = 0; t < 7; t++) { const l = h('span', 'vled'); l.title = TRACKS[t].name; vfd.leds.appendChild(l); }

  /* ---------------------------------------------------------------- tracks and pages */
  const trackKeys = $('#track-keys');
  TRACKS.forEach((tr, t) => {
    const b = h('button', 'key track-key'); b.type = 'button'; b.id = 'trk-' + t;
    b.innerHTML = `<span class="led"></span><span class="kname">${tr.name}</span>`;
    b.addEventListener('click', () => { ensureAudio(); selectTrack(t); });
    trackKeys.appendChild(b);
  });
  function selectTrack(t) {
    S.track = t; if (S.page === 'fx') S.page = 0; S.sel = -1;
    renderTracks(); renderKnobs(); renderVfd(); renderGrid();
  }
  function renderTracks() { [...trackKeys.children].forEach((b, t) => b.setAttribute('aria-pressed', t === S.track)); }
  const pageKeys = $('#page-keys');
  const PAGE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 'step', 'fx'];
  PAGE_IDS.forEach((pid) => {
    const b = h('button', 'key page-key', pid === 'step' ? 'Step' : pid === 'fx' ? 'FX' : PAGE_NAMES[pid]); b.type = 'button'; b.dataset.page = pid;
    b.addEventListener('click', () => { S.page = pid; S.focus = null; renderKnobs(); renderVfd(); });
    pageKeys.appendChild(b);
  });
  function renderPages() {
    [...pageKeys.children].forEach((b) => {
      const pid = b.dataset.page === 'step' || b.dataset.page === 'fx' ? b.dataset.page : +b.dataset.page;
      b.setAttribute('aria-pressed', pid === S.page);
      if (typeof pid === 'number') { const pg = META.pages[S.track * 8 + pid] || []; b.disabled = !pg.some((e) => !SKIP.has(e[3])); }
    });
  }

  /* ---------------------------------------------------------------- mixer */
  const mixEl = $('#mixer');
  const faderDefs = [0, 1, 2, 3, 4, 5].map((i) => ({ label: ['D1', 'D2', 'D3', 'SN', 'CY', 'HH'][i], name: ['Drum 1', 'Drum 2', 'Drum 3', 'Snare', 'Cymbal', 'Hats'][i], get: () => S.faders[i], set: (v) => { S.faders[i] = v; post({ t: 'fader', v: i, val: v }); } }));
  faderDefs.push({ label: 'Out', name: 'Output volume', master: true, get: () => S.master, set: (v) => { S.master = v; post({ t: 'master', val: v }); } });
  faderDefs.forEach((f, i) => {
    const col = h('div', 'fader' + (f.master ? ' master' : ''));
    const slot = h('div', 'slot'); slot.tabIndex = 0; slot.setAttribute('role', 'slider'); slot.setAttribute('aria-label', f.name + ' fader'); slot.id = 'fader-' + i;
    slot.setAttribute('aria-orientation', 'vertical'); slot.setAttribute('aria-valuemin', 0); slot.setAttribute('aria-valuemax', 100);
    const cap = h('div', 'fcap'); slot.appendChild(cap);
    if (f.master) { const m = h('div', 'meter'); m.innerHTML = '<i id="ml"></i><i id="mr"></i>'; col.appendChild(m); }
    const lab = h('div', 'f-label', f.label); const led = h('span', 'led');
    col.append(slot, led, lab); mixEl.appendChild(col);
    const draw = () => { const v = f.get(); cap.style.bottom = `calc(${(v * 100).toFixed(1)}% - ${(v * 22).toFixed(1)}px)`; slot.setAttribute('aria-valuenow', Math.round(v * 100)); };
    f.draw = draw; draw();
    const setFromY = (y) => { const r = slot.getBoundingClientRect(); const v = Math.max(0, Math.min(1, 1 - (y - r.top - 11) / (r.height - 22))); f.set(v); draw(); };
    slot.addEventListener('pointerdown', (e) => { ensureAudio(); slot.setPointerCapture(e.pointerId); setFromY(e.clientY); slot.classList.add('on'); });
    slot.addEventListener('pointermove', (e) => { if (slot.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
    slot.addEventListener('pointerup', () => slot.classList.remove('on'));
    slot.addEventListener('keydown', (e) => { const m = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key]; if (m) { e.preventDefault(); f.set(Math.max(0, Math.min(1, f.get() + m))); draw(); } });
    slot.addEventListener('wheel', (e) => { e.preventDefault(); f.set(Math.max(0, Math.min(1, f.get() + (e.deltaY < 0 ? 0.02 : -0.02)))); draw(); }, { passive: false });
  });
  const mlEl = () => $('#ml'), mrEl = () => $('#mr');
  let mL = 0, mR = 0;
  function meter(l, r) { mL = Math.max(l, mL * 0.82); mR = Math.max(r, mR * 0.82); const s = (x) => Math.min(100, (x / 0.8) * 100).toFixed(1) + '%'; mlEl().style.height = s(mL); mrEl().style.height = s(mR); }

  /* ---------------------------------------------------------------- sequencer grid */
  const grid = $('#grid');
  const cells = [];
  const rowEls = [];
  TRACKS.forEach((tr, t) => {
    const row = h('div', 'row'); row.dataset.t = t;
    const pad = h('button', 'pad'); pad.type = 'button'; pad.title = 'Play ' + tr.name + ' (key ' + (t + 1) + ')'; pad.setAttribute('aria-label', 'Play ' + tr.name);
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); audition(t); });
    const name = h('button', 'rname'); name.type = 'button'; name.innerHTML = `<b>${tr.short}</b><span>${tr.name}</span>`;
    name.addEventListener('click', () => selectTrack(t));
    const mute = h('button', 'mute', 'M'); mute.type = 'button'; mute.setAttribute('aria-label', 'Mute ' + tr.name);
    mute.addEventListener('click', () => { S.mutes[t] ^= 1; post({ t: 'mute', track: t, on: S.mutes[t] }); renderGrid(); });
    const steps = h('div', 'steps');
    const rc = [];
    for (let i = 0; i < 16; i++) {
      const c = h('button', 'cell'); c.type = 'button'; c.dataset.i = i;
      let lp = null, lpFired = false;
      c.addEventListener('pointerdown', (e) => { ensureAudio(); lpFired = false; lp = setTimeout(() => { lpFired = true; selectStep(t, S.bar * 16 + i); }, 450); });
      c.addEventListener('pointerleave', () => clearTimeout(lp));
      c.addEventListener('click', (e) => { clearTimeout(lp); if (lpFired) return; if (e.shiftKey || e.altKey) selectStep(t, S.bar * 16 + i); else toggleStep(t, S.bar * 16 + i); });
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(lp); selectStep(t, S.bar * 16 + i); });
      steps.appendChild(c); rc.push(c);
    }
    const len = h('span', 'rlen');
    row.append(pad, name, mute, steps, len);
    grid.appendChild(row); cells.push(rc); rowEls.push({ row, mute, len, pad });
  });
  function toggleStep(t, i) {
    const pt = curPat(), s = pt.steps[t][i];
    s[0] = s[0] ? 0 : 1;
    if (s[0]) { S.sel = i; if (t !== S.track) { S.track = t; renderTracks(); } }
    sendPattern(); renderGrid(); if (S.page === 'step') { renderKnobs(); renderVfd(); }
  }
  function selectStep(t, i) { S.track = t; S.sel = i; S.page = 'step'; S.focus = null; renderTracks(); renderGrid(); renderKnobs(); renderVfd(); }
  function renderGrid() {
    const pt = curPat();
    for (let t = 0; t < 7; t++) {
      const re = rowEls[t];
      re.row.classList.toggle('sel', t === S.track);
      re.mute.setAttribute('aria-pressed', !!S.mutes[t]);
      re.row.classList.toggle('muted', !!S.mutes[t]);
      re.len.textContent = pt.len[t];
      for (let c = 0; c < 16; c++) {
        const i = S.bar * 16 + c, s = pt.steps[t][i], el = cells[t][c];
        const out = i >= pt.len[t];
        el.classList.toggle('on', !!s[0]);
        el.classList.toggle('out', out);
        el.classList.toggle('chosen', t === S.track && i === S.sel);
        el.classList.toggle('prob', !!s[0] && s[2] < 100);
        el.classList.toggle('flam', !!s[0] && s[4] > 0);
        el.classList.toggle('auto', !!s[0] && (s[6] !== 255 || s[8] !== 255));
        el.classList.toggle('shift', !!s[0] && s[5] !== 7);
        el.style.setProperty('--vel', s[0] ? (0.35 + 0.65 * (s[1] / 127)).toFixed(2) : 0);
        el.setAttribute('aria-pressed', !!s[0]);
        el.setAttribute('aria-label', `${TRACKS[t].name} step ${i + 1}${s[0] ? ', on, velocity ' + s[1] : ', off'}`);
      }
    }
    renderBars(); playhead();
  }
  const barsEl = $('#bars');
  for (let b = 0; b < 4; b++) {
    const k = h('button', 'key bar-key', String(b + 1)); k.type = 'button'; k.setAttribute('aria-label', 'Show bar ' + (b + 1));
    k.addEventListener('click', () => { S.bar = b; S.follow = false; $('#follow').checked = false; renderGrid(); });
    barsEl.appendChild(k);
  }
  function renderBars() {
    const pt = curPat();
    [...barsEl.children].forEach((k, b) => {
      k.setAttribute('aria-pressed', b === S.bar);
      const has = pt.steps.some((tr, t) => tr.slice(b * 16, b * 16 + 16).some((s, c) => s[0] && b * 16 + c < pt.len[t]));
      k.classList.toggle('has', has);
      const playingBar = S.stepIdx[S.track] >= 0 && Math.floor(S.stepIdx[S.track] / 16) === b;
      k.classList.toggle('live', S.playing && playingBar);
    });
  }
  let lastHead = [];
  function playhead() {
    for (const el of lastHead) el.classList.remove('head');
    lastHead = [];
    if (S.follow && S.playing) { const i = S.stepIdx[S.track]; if (i >= 0 && Math.floor(i / 16) !== S.bar) { S.bar = Math.floor(i / 16); renderGrid(); return; } }
    for (let t = 0; t < 7; t++) {
      const i = S.stepIdx[t]; if (i < 0 || Math.floor(i / 16) !== S.bar) continue;
      const el = cells[t][i % 16]; el.classList.add('head'); lastHead.push(el);
    }
    renderBarsLive(); renderPos();
  }
  function renderBarsLive() { [...barsEl.children].forEach((k, b) => k.classList.toggle('live', S.playing && S.stepIdx[S.track] >= 0 && Math.floor(S.stepIdx[S.track] / 16) === b)); }
  const flashTimers = [];
  function flash(t) {
    const els = [rowEls[t].pad, vfd.leds.children[t], trackKeys.children[t].querySelector('.led'), mixEl.children[Math.min(5, t)].querySelector('.led')];
    els.forEach((e) => e && e.classList.add('lit'));
    clearTimeout(flashTimers[t]);
    flashTimers[t] = setTimeout(() => els.forEach((e) => e && e.classList.remove('lit')), 90);
  }
  async function audition(t) { await ensureAudio(); post({ t: 'trig', track: t, vel: 127, note: 60 }); if (!S.playing) flash(t); }

  /* ---------------------------------------------------------------- patterns, kits, projects */
  const patsEl = $('#patterns');
  for (let i = 0; i < 16; i++) {
    const k = h('button', 'key pat-key', String(i + 1)); k.type = 'button'; k.setAttribute('aria-label', 'Pattern ' + (i + 1));
    k.addEventListener('click', () => { ensureAudio(); choosePattern(i); });
    patsEl.appendChild(k);
  }
  function choosePattern(i) {
    const pr = proj();
    if (!pr.pats[i]) pr.pats[i] = { steps: emptySteps(), len: [16, 16, 16, 16, 16, 16, 16], shuffle: S.swing, kit: pr.kits[S.kitIdx] ? pr.kits[S.kitIdx].slot : 0 };
    const pt = pr.pats[i];
    const ki = proj().kits.findIndex((k) => k.slot === pt.kit);
    if (S.playing && i !== S.pat) {
      S.pending = i;
      post({ t: 'queue', pat: enginePat(pt), kit: S.kitFollow && ki >= 0 ? Array.from(kitWithMorph(proj().kits[ki].p)) : undefined, shuffle: pt.shuffle / 127, id: i });
      renderPatterns(); renderVfd();
      return;
    }
    S.pat = i; S.pending = -1; S.sel = -1;
    if (S.kitFollow && ki >= 0) loadKit(ki);
    S.swing = pt.shuffle; post({ t: 'shuffle', v: S.swing / 127 });
    sendPattern(); renderTransport(); renderPatterns(); renderGrid(); renderKnobs(); renderVfd();
  }
  function kitWithMorph(p) { const save = S.kit; S.kit = new Uint8Array(p); const r = effectiveKit(); S.kit = save; return r; }
  function renderPatterns() {
    const pr = proj();
    [...patsEl.children].forEach((k, i) => {
      k.setAttribute('aria-pressed', i === S.pat);
      k.classList.toggle('empty', !pr.pats[i] || !pr.pats[i].steps.some((tr) => tr.some((s) => s[0])));
      k.classList.toggle('pending', i === S.pending);
    });
  }
  const projSel = $('#proj'), kitSel = $('#kit'), morphSel = $('#morph-kit');
  projects.forEach((p, i) => { const o = h('option', '', `${p.label} · ${p.kits.length} kits${p.pats.some(Boolean) ? ', ' + p.pats.filter(Boolean).length + ' patterns' : ''}`); o.value = i; projSel.appendChild(o); });
  projSel.addEventListener('change', () => { ensureAudio(); openProject(+projSel.value); });
  kitSel.addEventListener('change', () => { ensureAudio(); loadKit(+kitSel.value); const pt = curPat(); pt.kit = proj().kits[S.kitIdx].slot; });
  morphSel.addEventListener('change', () => { S.morphIdx = +morphSel.value; post({ t: 'kit', p: Array.from(effectiveKit()) }); renderVfd(); });
  function renderKitSelect() {
    const pr = proj();
    kitSel.innerHTML = ''; morphSel.innerHTML = '<option value="-1">none</option>';
    pr.kits.forEach((k, i) => {
      const o = h('option', '', `${String(k.slot + 1).padStart(2, '0')} ${k.name}`); o.value = i; kitSel.appendChild(o);
      const o2 = h('option', '', `${String(k.slot + 1).padStart(2, '0')} ${k.name}`); o2.value = i; morphSel.appendChild(o2);
    });
    kitSel.value = S.kitIdx; morphSel.value = S.morphIdx;
  }
  function openProject(i) {
    S.proj = i; projSel.value = i; $('#proj-credit').textContent = proj().credit || ''; S.morphIdx = -1; S.morph = 0; morphKnob.draw();
    const pr = proj();
    const first = pr.pats.findIndex(Boolean);
    S.pat = first >= 0 ? first : 0; S.pending = -1;
    const pt = curPat();
    const ki = pr.kits.findIndex((k) => k.slot === pt.kit);
    loadKit(ki >= 0 ? ki : 0);
    S.swing = pt.shuffle; post({ t: 'shuffle', v: S.swing / 127 });
    sendPattern(); renderTransport(); renderPatterns(); renderGrid(); renderVfd();
  }

  /* morph + transport small knobs */
  function miniKnob(el, def) {
    const k = Object.assign({ short: '', long: '', list: null, fmt: String, longFmt: String, def: () => def.min }, def);
    const node = makeKnob(k, el.id.replace('host-', ''));
    node.classList.add('mini'); el.appendChild(node); return k;
  }
  const morphKnob = miniKnob($('#host-morph'), { short: 'morph', long: 'Kit morph amount', min: 0, max: 127, get: () => S.morph, set: (v) => { S.morph = v; post({ t: 'kit', p: Array.from(effectiveKit()) }); }, fmt: (v) => Math.round((v / 127) * 100) + '%', longFmt: (v) => Math.round((v / 127) * 100) + '% toward morph kit' });
  const swingKnob = miniKnob($('#host-swing'), { short: 'swing', long: 'Swing (pattern shuffle)', min: 0, max: 127, get: () => S.swing, set: (v) => { S.swing = v; curPat().shuffle = v; post({ t: 'shuffle', v: v / 127 }); }, fmt: (v) => Math.round((v / 127) * 100) + '%', longFmt: (v) => Math.round((v / 127) * 100) + '% (odd steps delayed up to 2/3 step)' });
  const bpmKnob = miniKnob($('#host-bpm'), { short: 'tempo', long: 'Tempo (BPM)', min: 40, max: 240, get: () => S.bpm, set: (v) => { S.bpm = v; post({ t: 'bpm', v }); }, fmt: String, longFmt: (v) => v + ' BPM', def: () => 120 });
  function renderTransport() {
    swingKnob.draw(); bpmKnob.draw(); morphKnob.draw();
    $('#play').setAttribute('aria-pressed', S.playing);
    $('#play .lbl').textContent = S.playing ? 'Stop' : 'Play';
  }
  $('#play').addEventListener('click', togglePlay);
  async function togglePlay() {
    await ensureAudio();
    S.playing = !S.playing;
    if (S.playing) { post({ t: 'play' }); } else { post({ t: 'stop' }); S.stepIdx = [-1, -1, -1, -1, -1, -1, -1]; if (S.pending >= 0) { S.pending = -1; renderPatterns(); } }
    renderTransport(); playhead(); renderVfd();
  }
  $('#follow').addEventListener('change', (e) => { S.follow = e.target.checked; });
  $('#kitfollow').addEventListener('change', (e) => { S.kitFollow = e.target.checked; });
  $('#clear-track').addEventListener('click', () => { const pt = curPat(); pt.steps[S.track] = Array.from({ length: 64 }, () => [0, 127, 100, 60, 0, 7, 255, 0, 255, 0]); sendPattern(); renderGrid(); renderPatterns(); });
  $('#copy-bar').addEventListener('click', () => {
    const pt = curPat(), b = S.bar;
    for (let t = 0; t < 7; t++) for (let k = 1; k < 4; k++) { const nb = (b + k) % 4; for (let c = 0; c < 16; c++) pt.steps[t][nb * 16 + c] = pt.steps[t][b * 16 + c].slice(); }
    sendPattern(); renderGrid();
  });

  /* file import (.SND kits, .PAT patterns) */
  const fileIn = $('#file');
  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files]; if (!files.length) return;
    let user = projects.find((p) => p.label === 'Your files');
    if (!user) { user = { label: 'Your files', kits: [], pats: new Array(16).fill(null) }; projects.push(user); const o = h('option', '', 'Your files'); o.value = projects.length - 1; projSel.appendChild(o); }
    const msgs = [];
    for (const f of files) {
      const u = new Uint8Array(await f.arrayBuffer());
      const nm = new TextDecoder('latin1').decode(u.slice(0, 8)).replace(/\0.*$/, '').trim() || f.name.replace(/\.[^.]+$/, '');
      if (/\.snd$/i.test(f.name) && u.length >= 8 + 200) {
        const p = new Uint8Array(END); p.set(u.slice(8, 8 + END));
        user.kits.push({ slot: user.kits.length, name: nm, p }); msgs.push('kit ' + nm);
      } else if (/\.pat$/i.test(f.name)) {
        const pt = parsePat(u); const slot = user.pats.findIndex((x) => !x);
        if (pt && slot >= 0) { pt.kit = user.kits.length ? user.kits[user.kits.length - 1].slot : 0; user.pats[slot] = pt; msgs.push('pattern ' + (slot + 1)); }
      }
    }
    fileIn.value = '';
    $('#file-msg').textContent = msgs.length ? 'Loaded ' + msgs.join(', ') + ' into “Your files”.' : 'No .SND or .PAT data found in those files.';
    if (msgs.length) openProject(projects.indexOf(user));
  });
  function parsePat(u) {
    let pos = 8, ver = 1;
    if (String.fromCharCode(...u.slice(8, 12)) === 'PatV') { ver = +String.fromCharCode(...u.slice(12, 14)); pos = 14; }
    const need = pos + 7 * (448 + (ver > 2 ? 64 : 0)) + 56 + 8; if (u.length < need) return null;
    const steps = emptySteps(), len = [];
    const raw = [];
    for (let t = 0; t < 7; t++) {
      const st = [];
      for (let i = 0; i < 64; i++) { st.push(Array.from(u.slice(pos, pos + 7))); pos += 7; }
      const tim = ver > 2 ? Array.from(u.slice(pos, pos + 64)) : new Array(64).fill(0x70); if (ver > 2) pos += 64;
      raw.push({ st, tim });
    }
    for (let t = 0; t < 7; t++) {
      let bits = 0n; for (let b = 0; b < 4; b++) { bits |= BigInt(u[pos] | (u[pos + 1] << 8)) << BigInt(16 * b); pos += 2; }
      for (let i = 0; i < 64; i++) { const s = raw[t].st[i]; steps[t][i] = [Number((bits >> BigInt(i)) & 1n), s[0] & 127, s[1], s[2], raw[t].tim[i] & 15, raw[t].tim[i] >> 4, s[3], s[4], s[5], s[6]]; }
    }
    const shuffle = u[pos++];
    for (let t = 0; t < 7; t++) { const l = u[pos++]; len.push(l > 0 && l <= 64 ? l : 16); }
    return { steps, len, shuffle, kit: 0 };
  }

  /* ---------------------------------------------------------------- status + keyboard */
  function renderStatus() {
    const st = $('#status');
    st.textContent = mode === 'worklet' ? `Audio on · ${Math.round(readyFs / 100) / 10} kHz` : mode === 'main' ? `Audio on (compat) · ${Math.round(readyFs / 100) / 10} kHz` : 'Audio starts on first touch';
    st.classList.toggle('on', mode !== 'off');
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, [role="slider"]')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (/^Digit[1-7]$/.test(e.code)) { e.preventDefault(); audition(+e.code.slice(5) - 1); }
  });
  document.addEventListener('pointerdown', () => { ensureAudio().then(renderStatus); }, { once: true });

  /* ---------------------------------------------------------------- boot */
  renderKitSelect();
  openProject(Math.max(0, projects.findIndex((p) => p.pats.some(Boolean))));
  selectTrack(0);
  renderTransport(); renderStatus();
})();
