'use strict';
/* Squelchbox — static data: parameters, presets, default patterns, pattern generators. */

const STEPS = 16;
const BANKS = 4;
const TRACKS = ['kick', 'hats', 'bass', 'acid'];
const TRACK_NAMES = { kick: 'Kick', hats: 'Hats', bass: 'Bass', acid: 'Acid' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BANK_NAMES = ['A', 'B', 'C', 'D'];

const SCALES = {
  'Minor': [0, 2, 3, 5, 7, 8, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'Minor pentatonic': [0, 3, 5, 7, 10],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

// Delay times in beats (quarter notes)
const DELAY_TIMES = { '1/16': 0.25, '1/8': 0.5, '3/16': 0.75, '1/4': 1, '3/8': 1.5 };

/* Parameter definitions. Continuous params are 0..1; `options` makes a switch. */
const PARAMS = {
  kick: [
    { id: 'level', label: 'Level', def: 0.8 },
    { id: 'tune', label: 'Tune', def: 0.35 },
    { id: 'punch', label: 'Punch', def: 0.6 },
    { id: 'decay', label: 'Decay', def: 0.45 },
    { id: 'drive', label: 'Drive', def: 0.25 }
  ],
  hats: [
    { id: 'level', label: 'Level', def: 0.5 },
    { id: 'tone', label: 'Tone', def: 0.65 },
    { id: 'decay', label: 'Closed', def: 0.3 },
    { id: 'open', label: 'Open', def: 0.45 }
  ],
  bass: [
    { id: 'level', label: 'Level', def: 0.7 },
    { id: 'cutoff', label: 'Cutoff', def: 0.4 },
    { id: 'decay', label: 'Decay', def: 0.35 },
    { id: 'drive', label: 'Drive', def: 0.15 },
    { id: 'wave', label: 'Wave', def: 'sine', options: [['sine', 'Sine'], ['triangle', 'Tri'], ['sawtooth', 'Saw']] }
  ],
  acid: [
    { id: 'level', label: 'Level', def: 0.6 },
    { id: 'cutoff', label: 'Cutoff', def: 0.3 },
    { id: 'reso', label: 'Reso', def: 0.7 },
    { id: 'envmod', label: 'Env mod', def: 0.6 },
    { id: 'decay', label: 'Decay', def: 0.35 },
    { id: 'accent', label: 'Accent', def: 0.6 },
    { id: 'grit', label: 'Grit', def: 0.25 },
    { id: 'wave', label: 'Wave', def: 'sawtooth', options: [['sawtooth', 'Saw'], ['square', 'Square']] }
  ],

  /* FX units. `send: true` params are per-track send amounts. */
  drive: [
    { id: 'amount', label: 'Drive', def: 0.4 },
    { id: 'tone', label: 'Tone', def: 0.6 },
    { id: 'mix', label: 'Mix', def: 0.7 }
  ],
  delay: [
    { id: 'feedback', label: 'Feedback', def: 0.4 },
    { id: 'tone', label: 'Tone', def: 0.55 },
    { id: 'spread', label: 'Spread', def: 0.6 },
    { id: 'level', label: 'Return', def: 0.8 },
    { id: 'time', label: 'Time', def: '3/16', options: Object.keys(DELAY_TIMES).map(k => [k, k]) },
    { id: 'kick', label: 'Kick', def: 0, send: true },
    { id: 'hats', label: 'Hats', def: 0.1, send: true },
    { id: 'bass', label: 'Bass', def: 0, send: true },
    { id: 'acid', label: 'Acid', def: 0.35, send: true }
  ],
  reverb: [
    { id: 'size', label: 'Size', def: 0.45, fmt: v => (0.4 + v * 3.6).toFixed(1) + 's' },
    { id: 'damp', label: 'Damp', def: 0.45 },
    { id: 'predelay', label: 'Pre-delay', def: 0.1, fmt: v => Math.round(v * 200) + 'ms' },
    { id: 'level', label: 'Return', def: 0.7 },
    { id: 'kick', label: 'Kick', def: 0.04, send: true },
    { id: 'hats', label: 'Hats', def: 0.2, send: true },
    { id: 'bass', label: 'Bass', def: 0, send: true },
    { id: 'acid', label: 'Acid', def: 0.18, send: true }
  ],
  mutate: [
    { id: 'drift', label: 'Drift', def: 0 }
  ]
};

/* FX units shown in the FX section, in order. `bypass` units get an on/off switch. */
const FX_UNITS = [
  { id: 'drive', name: 'Overdrive', bypass: true, on: false, note: 'Saturates the whole drum + synth mix before the delay and reverb.' },
  { id: 'delay', name: 'Delay', bypass: true, on: true, note: 'Tempo-synced. Spread bounces the echoes left and right. Off lets the echoes ring out.' },
  { id: 'reverb', name: 'Reverb', bypass: true, on: true, note: 'Size sets the tail length, Damp darkens it. Off lets the tail ring out.' },
  { id: 'mutate', name: 'Mutate', bypass: false, note: 'Drift rewrites a little of the acid line at the start of each bar while playing.' }
];

/* Instrument presets (sound params only; level stays where the user put it). */
const PRESETS = {
  kick: {
    'Warehouse': { tune: 0.35, punch: 0.6, decay: 0.45, drive: 0.25 },
    'Deep': { tune: 0.2, punch: 0.4, decay: 0.75, drive: 0.1 },
    'Tight': { tune: 0.5, punch: 0.8, decay: 0.2, drive: 0.15 },
    'Blown out': { tune: 0.3, punch: 0.7, decay: 0.55, drive: 0.85 }
  },
  hats: {
    'Crisp': { tone: 0.65, decay: 0.3, open: 0.45 },
    'Dusty': { tone: 0.3, decay: 0.45, open: 0.6 },
    'Needle': { tone: 0.95, decay: 0.1, open: 0.25 },
    'Wash': { tone: 0.55, decay: 0.6, open: 0.9 }
  },
  bass: {
    'Sub': { wave: 'sine', cutoff: 0.4, decay: 0.35, drive: 0.15 },
    'Rubber': { wave: 'triangle', cutoff: 0.5, decay: 0.25, drive: 0.3 },
    'Growl': { wave: 'sawtooth', cutoff: 0.35, decay: 0.45, drive: 0.55 },
    'Pluck': { wave: 'sawtooth', cutoff: 0.6, decay: 0.12, drive: 0.2 }
  },
  acid: {
    'Classic': { wave: 'sawtooth', cutoff: 0.3, reso: 0.7, envmod: 0.6, decay: 0.35, accent: 0.6, grit: 0.25 },
    'Squelch': { wave: 'sawtooth', cutoff: 0.18, reso: 0.88, envmod: 0.8, decay: 0.25, accent: 0.8, grit: 0.4 },
    'Bubble': { wave: 'square', cutoff: 0.25, reso: 0.75, envmod: 0.5, decay: 0.2, accent: 0.5, grit: 0.15 },
    'Screamer': { wave: 'sawtooth', cutoff: 0.45, reso: 0.95, envmod: 0.9, decay: 0.55, accent: 1, grit: 0.6 },
    'Mellow': { wave: 'square', cutoff: 0.35, reso: 0.4, envmod: 0.3, decay: 0.5, accent: 0.3, grit: 0.05 }
  }
};

/* ---------- pattern helpers ---------- */

function emptyBank() {
  return {
    kick: new Array(STEPS).fill(0),           // 0 off, 1 on, 2 accent
    hats: new Array(STEPS).fill(0),           // 0 off, 1 closed, 2 open
    bass: Array.from({ length: STEPS }, () => ({ on: false, note: 0, oct: 0 })),
    acid: Array.from({ length: STEPS }, () => ({ on: false, note: 0, oct: 0, acc: false, slide: false }))
  };
}

function acidFrom(spec) {
  // spec: array of 16 strings like "0", "0+", "3a", "7s", "0+as", "-" (off), "10-" (octave down)
  return spec.map(str => {
    if (str === '-') return { on: false, note: 0, oct: 0, acc: false, slide: false };
    const m = /^(\d+)([+-]?)([as]*)$/.exec(str);
    return {
      on: true,
      note: +m[1],
      oct: m[2] === '+' ? 1 : m[2] === '-' ? -1 : 0,
      acc: m[3].includes('a'),
      slide: m[3].includes('s')
    };
  });
}

function bassFrom(spec) {
  return spec.map(str => {
    if (str === '-') return { on: false, note: 0, oct: 0 };
    const m = /^(\d+)(\+?)$/.exec(str);
    return { on: true, note: +m[1], oct: m[2] ? 1 : 0 };
  });
}

function demoBanks() {
  const a = emptyBank();
  a.kick = [2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0];
  a.hats = [0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 1, 2, 1];
  a.bass = bassFrom(['-', '-', '0', '-', '-', '-', '0', '-', '-', '-', '0', '-', '-', '-', '0', '0+']);
  a.acid = acidFrom(['0a', '0+s', '0', '-', '3a', '0s', '7', '0+a', '0', '10-s', '0', '5as', '3', '-', '0+a', '7s']);

  const b = emptyBank();
  b.kick = [2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 1, 0, 1, 0];
  b.hats = [1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 2];
  b.bass = bassFrom(['-', '-', '0', '0', '-', '-', '3', '-', '-', '-', '0', '0', '-', '-', '5', '-']);
  b.acid = acidFrom(['0a', '0', '0+s', '0+', '3', '5s', '7a', '-', '0a', '0', '10s', '8', '7as', '5', '3', '0+s']);

  const c = emptyBank();
  c.hats = [0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0];
  c.acid = acidFrom(['0a', '-', '0s', '0+', '-', '3', '-', '5as', '7', '-', '0+a', '-', '3s', '0', '-', '7']);

  const d = emptyBank();
  d.kick = [2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0];
  d.hats = [0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0];
  d.bass = bassFrom(['-', '-', '0', '-', '-', '-', '0', '-', '-', '-', '0', '-', '-', '-', '0', '-']);
  return [a, b, c, d];
}

/* A track sounds unless it is muted, or another track is soloed and it isn't. Mute wins over solo. */
function trackAudible(state, t) {
  if (state.mute[t]) return false;
  const anySolo = TRACKS.some(x => state.solo[x]);
  return !anySolo || !!state.solo[t];
}

function defaultParams() {
  const o = {};
  for (const t in PARAMS) {
    o[t] = {};
    for (const p of PARAMS[t]) o[t][p.id] = p.def;
  }
  return o;
}

function defaultState() {
  return {
    v: 1,
    bpm: 128,
    swing: 0.08,
    key: 9,               // A
    scale: 'Minor',
    bank: 0,
    chain: false,
    mute: { kick: false, hats: false, bass: false, acid: false },
    solo: { kick: false, hats: false, bass: false, acid: false },
    fxOn: Object.fromEntries(FX_UNITS.filter(u => u.bypass).map(u => [u.id, u.on])),
    params: defaultParams(),
    presets: { kick: 'Warehouse', hats: 'Crisp', bass: 'Sub', acid: 'Classic' },
    banks: demoBanks()
  };
}

/* Merge a saved state over the defaults so missing or corrupt fields can't break the app. */
function sanitizeState(saved) {
  const d = defaultState();
  if (!saved || typeof saved !== 'object') return d;
  const num = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  const s = d;
  s.bpm = Math.round(num(saved.bpm, 60, 200, d.bpm));
  s.swing = num(saved.swing, 0, 1, d.swing);
  s.key = Math.round(num(saved.key, 0, 11, d.key));
  s.scale = SCALES[saved.scale] ? saved.scale : d.scale;
  s.bank = Math.round(num(saved.bank, 0, BANKS - 1, 0));
  s.chain = !!saved.chain;
  if (saved.mute) for (const t of TRACKS) s.mute[t] = !!saved.mute[t];
  if (saved.solo) for (const t of TRACKS) s.solo[t] = !!saved.solo[t];
  if (saved.fxOn) for (const u in s.fxOn) if (typeof saved.fxOn[u] === 'boolean') s.fxOn[u] = saved.fxOn[u];
  const sp = saved.params && typeof saved.params === 'object' ? JSON.parse(JSON.stringify(saved.params)) : null;
  if (sp && sp.fx) {
    // v1 had a single FX row: grit, acid-only delay, drift
    sp.acid = sp.acid || {};
    if (sp.acid.grit === undefined) sp.acid.grit = sp.fx.grit;
    if (!sp.delay) sp.delay = { time: sp.fx.delayTime, feedback: sp.fx.feedback, acid: sp.fx.delay };
    if (!sp.mutate) sp.mutate = { drift: sp.fx.drift };
  }
  if (sp) {
    for (const t in PARAMS) {
      for (const p of PARAMS[t]) {
        const v = sp[t] && sp[t][p.id];
        if (p.options) { if (p.options.some(o => o[0] === v)) s.params[t][p.id] = v; }
        else s.params[t][p.id] = num(v, 0, 1, p.def);
      }
    }
  }
  if (saved.presets) for (const t of TRACKS) if (typeof saved.presets[t] === 'string') s.presets[t] = saved.presets[t];
  if (Array.isArray(saved.banks)) {
    for (let b = 0; b < BANKS; b++) {
      const sb = saved.banks[b];
      if (!sb) continue;
      const nb = emptyBank();
      for (let i = 0; i < STEPS; i++) {
        if (sb.kick) nb.kick[i] = Math.round(num(sb.kick[i], 0, 2, 0));
        if (sb.hats) nb.hats[i] = Math.round(num(sb.hats[i], 0, 2, 0));
        const bs = sb.bass && sb.bass[i];
        if (bs) nb.bass[i] = { on: !!bs.on, note: Math.round(num(bs.note, 0, 11, 0)), oct: Math.round(num(bs.oct, 0, 1, 0)) };
        const ac = sb.acid && sb.acid[i];
        if (ac) nb.acid[i] = { on: !!ac.on, note: Math.round(num(ac.note, 0, 11, 0)), oct: Math.round(num(ac.oct, -1, 1, 0)), acc: !!ac.acc, slide: !!ac.slide };
      }
      s.banks[b] = nb;
    }
  }
  return s;
}

/* ---------- generators ---------- */

const rnd = () => Math.random();
const pick = arr => arr[Math.floor(rnd() * arr.length)];

function scaleNote(scale, rootBias = 0.35) {
  return rnd() < rootBias ? 0 : pick(SCALES[scale] || SCALES.Minor);
}

function randomKick() {
  return Array.from({ length: STEPS }, (_, i) => {
    if (i % 4 === 0) return i % 8 === 0 ? 2 : 1;
    return rnd() < 0.07 ? 1 : 0;
  });
}

function randomHats() {
  return Array.from({ length: STEPS }, (_, i) => {
    if (i % 4 === 2) return rnd() < 0.85 ? 2 : 1;
    return rnd() < 0.3 ? 1 : 0;
  });
}

function randomBass(scale) {
  return Array.from({ length: STEPS }, (_, i) => {
    const on = i % 4 === 2 ? rnd() < 0.9 : (i % 4 !== 0 && rnd() < 0.18);
    return { on, note: scaleNote(scale, 0.6), oct: rnd() < 0.12 ? 1 : 0 };
  });
}

function randomAcid(scale) {
  return Array.from({ length: STEPS }, (_, i) => {
    const r = rnd();
    return {
      on: rnd() < (i % 4 === 0 ? 0.9 : 0.68),
      note: scaleNote(scale),
      oct: r < 0.2 ? 1 : r < 0.3 ? -1 : 0,
      acc: rnd() < 0.3,
      slide: rnd() < 0.25
    };
  });
}

/* Small random edits to an acid line, scaled by amount (0..1). Mutates in place. */
function mutateAcid(steps, scale, amount) {
  const edits = 1 + Math.floor(amount * 3.5);
  for (let n = 0; n < edits; n++) {
    const s = steps[Math.floor(rnd() * STEPS)];
    const op = rnd();
    if (op < 0.4) { s.note = scaleNote(scale, 0.25); s.on = true; }
    else if (op < 0.55) s.oct = s.oct === 0 ? (rnd() < 0.6 ? 1 : -1) : 0;
    else if (op < 0.7) s.acc = !s.acc;
    else if (op < 0.85) s.slide = !s.slide;
    else s.on = !s.on;
  }
}
