/*
 * LubkaM1 sound engine (AudioWorklet).
 *
 * Modified JavaScript port of GPL-3.0-only drum-synth firmware.
 * Original work: Copyright (C) 2012-2026 Erica Synths. Modifications: Copyright (C) 2026 LubkaM1 authors.
 * SPDX-License-Identifier: GPL-3.0-only. Additional terms: see NOTICE-upstream.md.
 *
 * Processing mirrors the firmware: envelopes, LFOs and modulation are evaluated
 * once per 64-sample block, audio is computed per sample in a 16-bit signed scale,
 * and the sequencer runs a 96 PPQ clock (24 ticks per step).
 */
(function () {
  const BLOCK = 64;
  const U32 = 4294967296;
  const SEMI = 1.0594630943592952;
  // waveforms
  const SINE = 0, TRI = 1, SAW = 2, REC = 3, NOISE = 4, PWM = 5;
  // EG states
  const EG_STOPPED = 0, EG_A = 1, EG_D = 2, EG_REPEAT = 3;
  // filter types (value+1)
  const F_LP = 1, F_HP = 2, F_BP = 3, F_UBP = 4, F_NOTCH = 5, F_PEAK = 6, F_LP2 = 7, F_OFF = 8;

  const u32 = (x) => { if (!(x > 0)) return 0; if (x >= U32) return U32 - 1; return Math.floor(x); }; // ARM VCVT.U32 saturates
  // saturate to int16; NaN becomes 0 as in the ARM float-to-integer conversion
  const sat = (x) => (x > 32767 ? 32767 : x < -32768 ? -32768 : x === x ? x : 0);
  const trunc = Math.trunc;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const valueShaper = (val, shape) => { const k = (2 * shape) / (1.0001 - shape); return ((1 + k) * val) / (1 + k * Math.abs(val)); };
  const rnd16 = () => ((Math.random() * 65536) | 0) - 32768;

  class Engine {
    constructor(fs, init) {
      this.fs = fs;
      const T = (this.T = init.tables);
      this.P = init.P;
      this.END = init.END;
      this.modTargetParams = init.modTargetParams; // modTargets index -> param index
      this.kit = new Uint8Array(this.END);
      this.sine = T.sine; this.saw = T.saw; this.tri = T.tri; this.rec = T.rec;
      this.trans = T.trans; this.notes = T.notes; this.ecc = T.ecc83; this.diode = T.diode;

      this.bpm = 120;
      this.voices = [];
      for (let i = 0; i < 3; i++) this.voices.push(this.newDrum(i));
      this.voices.push(this.newSnare());
      this.voices.push(this.newMetal(4, 1.0));
      this.voices.push(this.newMetal(5, 0.5));
      this.velMods = [0, 1, 2, 3, 4, 5].map(() => ({ dest: 0, amount: 0, last: 0 }));
      this.decim = [1, 1, 1, 1, 1, 1, 1];
      this.decimCnt = new Float64Array(6);
      this.decimHold = new Float64Array(6);
      this.routing = new Uint8Array(6);
      this.fader = new Float64Array(6).fill(1);
      this.master = 0.8;
      this.mute = new Uint8Array(7);
      this.origCc = new Uint8Array(300); // original values in CC numbering for automation restore
      this.fx = this.newFx();
      this.buildHandlers();

      // block buffers
      this.b = new Float64Array(BLOCK);
      this.b2 = new Float64Array(BLOCK);
      this.b3 = new Float64Array(BLOCK);
      this.outL = new Float64Array(BLOCK); this.outR = new Float64Array(BLOCK);   // St1
      this.out2L = new Float64Array(BLOCK); this.out2R = new Float64Array(BLOCK); // St2
      this.fxL = new Float64Array(BLOCK); this.fxR = new Float64Array(BLOCK);
      this.ring = new Float64Array(BLOCK);

      this.seq = this.newSeq();
      this.events = [];
      this.meterL = 0; this.meterR = 0; this.meterCnt = 0;
    }

    /* ------------------------------------------------------------ objects */
    newOsc(wave) {
      return { phase: 0, inc: 0, freq: 440, wave: wave, tab: 0, pitchMod: 1, fmMod: 0, modNode: 1, midiFreq: (70 << 8) | 64, baseNote: 60, out: 0 };
    }
    newAmpEg() { const e = { attack: 0.01, decay: 0.01, value: 0, state: EG_STOPPED, repeat: 0, repeatCnt: 0, slope: 0, invSlope: 0 }; this.egSetSlope(e, 64); return e; }
    newFilter() { const f = { f: 0.2, g: 0, q: 0.9, s1: 0, s2: 0, a: 0, b: 0, drive: 0.315 }; this.svfDirect(f, 0.25); return f; }
    newLfo() { return { phase: 0, inc: 1, wave: 0, retrigger: 0, offset: 0, rnd: 0, sync: 0, freq: 1, node: { dest: 0, amount: 0 }, modNode: 1 }; }
    newTrans() { return { phase: 0, pitch: 1, wave: 0, volume: 1 }; }
    base(i) {
      return {
        idx: i, vol: 0.8, velo: 0, pan: 63, panL: 0.7, panR: 0.7, volumeMod: 1, pwm: 0,
        amp: this.newAmpEg(), filter: this.newFilter(), filterType: F_LP, trans: this.newTrans(), snap: 0,
        lfo: this.newLfo(), dist: 0, distSm: 0, faderSm: 1, volSm: 0.8, ampVal: 0,
      };
    }
    newDrum(i) {
      const v = this.base(i);
      v.kind = 'drum';
      v.osc = this.newOsc(TRI + i); v.modOsc = this.newOsc(TRI);
      v.fmModAmount = 0.5; v.pitchEg = { decay: 0.01, slope: 0, value: 0 }; v.egPitchModAmount = 0.5;
      v.mixOscs = 1; v.lastGain = 0; v.ampIn = 0;
      return v;
    }
    newSnare() {
      const v = this.base(3);
      v.kind = 'snare';
      v.osc = this.newOsc(TRI); v.noiseOsc = this.newOsc(TRI);
      v.mix = 0.5; v.pitchEg = { decay: 0.01, slope: 0, value: 0 }; v.egPitchModAmount = 0.5;
      return v;
    }
    newMetal(i, gain) {
      const v = this.base(i);
      v.kind = i === 4 ? 'cymbal' : 'hat';
      v.osc = this.newOsc(TRI); v.osc.fmMod = 1;
      v.modOsc = this.newOsc(SINE); v.modOsc2 = this.newOsc(NOISE);
      v.fm1 = 0.5; v.fm2 = 0.5; v.oscGain = gain;
      v.decayClosed = 0.01; v.decayOpen = 0.01;
      return v;
    }
    newFx() {
      const ringOsc = this.newOsc(REC); ringOsc.freq = 100;
      const fx = {
        type: 0, routing: 0, dryWet: 0, p: [0, 0, 0, 0], distType: 0,
        dist: { drive: 1, p1: 1, p2: 0, p3: 0, lp3: [0, 0], hp1: [0, 0], lp1: [0, 0], hp3: [0, 0], lp2: [0, 0], slew: [0, 0], last: [0, 0] },
        ringOsc,
        comp: { attack: 0.1, release: 0.999, env: 0, tresh: 3, makeup: 1, ratio: 1 },
        delay: { buf: new Float32Array(32768), oldRead: 0, newRead: 0, write: 1628, fracNew: 0, fracOld: 0, interp: 0, step: 0, fb: 0.7, range: 0, time: 0, pending: 0, timePending: 0, toneR: 0.01, toneL: 0, toneR2: 0, type: 0, t0: 0, t1: 0, u0: 0, u1: 0 },
      };
      this.setOscFreq(ringOsc);
      return fx;
    }
    newSeq() {
      return {
        running: false, pattern: null, pending: null, pendingKit: null, stepIdx: new Int16Array(7).fill(-1),
        tick: 0, t: 0, delay: 0, masterCnt: 0, shuffle: 0,
        rndPrev: new Uint8Array(7), rndCur: new Uint8Array(7), rndNext: new Uint8Array(7).fill(100),
        lastWasOn: new Uint8Array(7), autom: [0, 1, 2, 3, 4, 5, 6].map(() => [255, 255]),
      };
    }

    /* ------------------------------------------------------------ oscillator */
    detune(v) { return 1 + (v / 127 - 0.5) * (SEMI - 1); }
    recalcFreq(o) {
      let n = (o.midiFreq >> 8) + (o.baseNote - 60);
      if (n > 127) n = 127; if (n < 0) n = 0;
      o.freq = this.notes[n] * this.detune(o.midiFreq & 0xff);
    }
    setBaseNote(o, note) { o.baseNote = note; this.recalcFreq(o); }
    tableIndex(f) {
      const q = u32(f / 440);
      const lg = q === 0 ? 255 : 31 - Math.clz32(q);
      const note = 12 * lg + 70;
      const idx = Math.floor(note / 12) & 255;
      return idx > 10 ? 10 : idx;
    }
    setOscFreq(o) {
      const f = o.freq * o.pitchMod * o.modNode;
      const fs = this.fs;
      switch (o.wave) {
        case SINE: case NOISE: o.inc = u32(((4096 * f) / fs) * 1048576); break;
        case TRI: case SAW: case REC: case PWM: o.inc = u32(((1024 * f) / fs) * 4194304); o.tab = this.tableIndex(f); break;
        default: o.inc = u32(((1024 * f) / fs) * 131072);
      }
    }
    tableFor(w) { return w === SAW || w === PWM ? this.saw : w === TRI ? this.tri : this.rec; }
    wt(tab, row, ph) {
      const itg = ph >>> 22, frac = ph & 0x3fffff, base = row * 1024;
      const s0 = tab[base + itg];
      const s1 = itg < 1023 ? tab[base + itg + 1] : row < 10 ? tab[base + 1024] : tab[base];
      return s0 + trunc(((s1 - s0) * frac) / 4194304);
    }
    sineAt(ph) {
      const itg = ph >>> 20, frac = ph & 0xfffff, s0 = this.sine[itg];
      return s0 + trunc(((this.sine[itg + 1] - s0) * frac) / 1048576);
    }
    oscBlock(o, buf, gain, pwm) {
      const n = BLOCK;
      switch (o.wave) {
        case SINE:
          for (let i = 0; i < n; i++) { const v = this.sineAt(o.phase); o.phase = (o.phase + o.inc) >>> 0; buf[i] = trunc(v * gain); }
          break;
        case TRI: case SAW: case REC: {
          const tab = this.tableFor(o.wave);
          for (let i = 0; i < n; i++) { const v = this.wt(tab, o.tab, o.phase); o.phase = (o.phase + o.inc) >>> 0; buf[i] = trunc(v * gain); }
          break;
        }
        case NOISE: this.noiseBlock(o, buf, gain); break;
        case PWM: {
          const off = pwm * 2147483647;
          for (let i = 0; i < n; i++) {
            const p2 = u32(o.phase + off);
            const v = sat(this.wt(this.saw, o.tab, o.phase) - this.wt(this.saw, o.tab, p2));
            o.phase = (o.phase + o.inc) >>> 0; o.out = v; buf[i] = trunc(v * gain);
          }
          break;
        }
        default: buf.fill(0);
      }
    }
    noiseBlock(o, buf, gain) {
      for (let i = 0; i < BLOCK; i++) { const last = o.phase; o.phase = (o.phase + o.inc) >>> 0; if (last > o.phase) o.out = rnd16(); buf[i] = trunc(o.out * gain); }
    }
    // FM: the hardware converts the modulator with an unsigned saturating cast, so
    // only the positive half of the modulator moves the phase.
    oscFmBlock(o, mod, buf, gain, pwm) {
      const n = BLOCK;
      switch (o.wave) {
        case SINE:
          for (let i = 0; i < n; i++) {
            const off = (u32(mod[i] * o.fmMod) << 17) >>> 0;
            const v = this.sineAt((o.phase + off) >>> 0); o.phase = (o.phase + o.inc) >>> 0; buf[i] = trunc(v * gain);
          }
          break;
        case TRI: case SAW: case REC: {
          const tab = this.tableFor(o.wave);
          for (let i = 0; i < n; i++) {
            const off = (u32(mod[i] * o.fmMod) << 19) >>> 0;
            const v = this.wt(tab, o.tab, (o.phase + off) >>> 0); o.phase = (o.phase + o.inc) >>> 0; o.out = v; buf[i] = trunc(v * gain);
          }
          break;
        }
        case NOISE: this.oscBlock(o, buf, gain, pwm); break;
        case PWM: {
          const pw = pwm * 2147483647;
          for (let i = 0; i < n; i++) {
            const idx = (o.phase + ((u32(mod[i] * o.fmMod) << 19) >>> 0)) >>> 0;
            const p2 = u32(idx + pw);
            const v = sat(this.wt(this.saw, o.tab, idx) - this.wt(this.saw, o.tab, p2));
            o.phase = (o.phase + o.inc) >>> 0; o.out = v; buf[i] = trunc(v * gain);
          }
          break;
        }
        default: buf.fill(0);
      }
    }
    oscStartPhase(o, offset) {
      if (o.wave === SINE) o.phase = u32(1024 + (1072693248 - 1024) * offset);
      else if (o.wave > SINE && o.wave <= REC) o.phase = u32(1069547520 * offset);
      else o.phase = 0;
    }

    /* ------------------------------------------------------------ envelopes */
    egTime(d, k) { const val = d / 127; const r = (1 - ((1 + k) * val) / (1 + k * Math.abs(val))) * 2; return r > 1 ? 1 : r; }
    egSetSlope(e, d) { const a = (d / 127 - 0.5) * 1.999; e.slope = (2 * a) / (1 - a); e.invSlope = (2 * -a) / (1 + a); }
    egShape(v, s) { return ((1 + s) * v) / (1 + s * Math.abs(v)); }
    egTrigger(e) { if (!e.repeat) e.state = EG_A; else { e.state = EG_REPEAT; e.value = 1; } e.repeatCnt = e.repeat; }
    egCalc(e) {
      let val = e.value;
      switch (e.state) {
        case EG_STOPPED: return 0;
        case EG_REPEAT:
          if (val > 0) val -= e.attack;
          else { e.repeatCnt = (e.repeatCnt - 1) & 255; if (e.repeatCnt > 0) val = 1; else { e.state = EG_D; val = 1; } }
          e.value = val; return this.egShape(val, e.slope);
        case EG_A:
          val += e.attack; if (val >= 1) { val = 1; e.state = EG_D; }
          e.value = val; return this.egShape(val, e.invSlope);
        case EG_D:
          if (val > 0) { val -= e.decay; e.value = val; return this.egShape(val, e.slope); }
          e.value = 0; return 0;
      }
      return 0;
    }
    decayTime(d) { const K = (2 * 0.99) / (1 - 0.99); const val = d / 127; const r = (1 - ((1 + K) * val) / (1 + K * Math.abs(val))) * 2; return r > 1 ? 1 : r; }
    decaySlope(e, d) { let a = (d / 127 - 0.5) * 2; if (a > 0.999) a = 0.999; e.slope = (2 * a) / (1 - a); }
    decayCalc(e) { let v = e.value; if (v > 0) v -= e.decay; else v = 0; e.value = v; return this.egShape(v, e.slope); }
    snapCalc(v, time) { let r = 0; if (v.snap > 0) { r = v.snap * v.snap * 24; v.snap -= 0.2 * time; } return r; }

    /* ------------------------------------------------------------ transient */
    transBlock(t, buf) {
      if (t.wave <= 1 || t.phase >= 2311061504) { buf.fill(0); return; }
      const base = (t.wave - 2) * 2205, inc = t.pitch * 1048576, data = this.trans;
      for (let i = 0; i < BLOCK; i++) {
        if (t.phase < 2311061504) {
          const p = t.phase >>> 20;
          buf[i] = p < 2205 ? trunc(t.volume * (data[base + p] * 256)) : 0;
          t.phase = u32(t.phase + inc);
        } else buf[i] = 0;
      }
    }

    /* ------------------------------------------------------------ filter (ZDF SVF) */
    fastTan(x) { const x2 = x * x; return (-15 * x + x * x2) / (3 * (-5 + 2 * x2)); }
    svfDirect(f, val) { f.f = val * (0.5 * 0.9); f.g = this.fastTan(Math.PI * f.f); }
    svfReso(f, fb) { f.q = 1 - fb; if (f.q < 0.1) f.q = 0.02; }
    svfReset(f) { f.s1 = f.s2 = f.a = f.b = 0; }
    svfBlock(f, type, buf) {
      if (type === F_OFF || type < 1 || type > 8) return;
      const g = f.g, R = f.f >= 0.4499 ? 1 : f.q, ff = g * g, drive = f.drive;
      const sc = (x) => { const h = 0.5 * x, a = h * h; return x * (((a + 105) * a + 945) / ((15 * a + 420) * a + 945)); };
      if (type === F_LP2) {
        const fl = f.f * 2.21;
        const q = (1 - f.q) * 1.4 + (1 - f.q) / (1.0 - fl);
        for (let i = 0; i < BLOCK; i++) {
          const x = sc((buf[i] / 32767) * drive);
          f.a += fl * (x - f.a + q * (f.a - f.b)); if (f.a > 1) f.a = 1; else if (f.a < -1) f.a = -1;
          f.b += fl * (f.a - f.b); if (f.b > 1) f.b = 1; else if (f.b < -1) f.b = -1;
          buf[i] = sat(trunc(f.b * 32767));
        }
        return;
      }
      if (f.s1 !== f.s1) f.s1 = 0; if (f.s2 !== f.s2) f.s2 = 0;
      const g0 = 1 / (1 + g * 2 * R), f1 = ff * g0;
      for (let i = 0; i < BLOCK; i++) {
        const x = sc((buf[i] / 32767) * drive);
        const s1 = f.s1, s2 = f.s2;
        const y1 = (f1 * x + s2 + g * g0 * s1) / (f1 + 1);
        const xx = x - y1;
        const cs1 = sc(s1);
        const y0 = (cs1 + g * xx) * g0;
        f.s1 = cs1 + 2 * g * (xx - 2 * R * y0);
        f.s2 = s2 + 2 * g * y0;
        let y;
        switch (type) {
          case F_LP: { const v = y1 < -1.95 ? -1 : y1 > 1.95 ? 1 : (4.15 * y1) / (4.29 + y1 * y1); y = trunc(v * 32767); break; }
          case F_HP: y = trunc((x - 2 * R * y0 - y1) * 32767); break;
          case F_BP: y = trunc(y0 * 32767); break;
          case F_UBP: y = trunc(2 * R * y0 * 32767); break;
          case F_NOTCH: y = trunc((x - 2 * R * y0) * 32767); break;
          case F_PEAK: { const h = x - 2 * R * y0 - y1; y = trunc((y1 - h) * 32767); break; }
        }
        buf[i] = sat(y);
      }
    }
    distShape(flt) { const s = flt - 0.0078125; return (2 * s) / (1 - s); }
    distBlock(buf, k) { for (let i = 0; i < BLOCK; i++) { const x = buf[i] / 32767; buf[i] = trunc((((1 + k) * x) / (1 + k * Math.abs(x))) * 32767); } }

    /* ------------------------------------------------------------ LFO */
    lfoInc(freq, sync) {
      const lfoSr = this.fs / BLOCK;
      if (!sync) return (freq / lfoSr) * 4294967295;
      const scal = [0, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 32][sync];
      if (scal === undefined) return (freq / lfoSr) * 4294967295;
      const tf = this.bpm > 0 ? this.bpm / 60 / 4 : 0;
      return ((tf * scal) / lfoSr) * 4294967295;
    }
    lfoSetFreq(l, flt) { let f = 0.0078125 + flt * (1 - 0.0078125); f = f * f * f; l.freq = f * 200; l.inc = this.lfoInc(l.freq, l.sync); }
    lfoCalc(l) {
      const old = l.phase;
      l.phase = (l.phase + u32(l.inc * l.modNode)) >>> 0;
      const ovf = old > l.phase, ph = l.phase / 4294967295;
      switch (l.wave) {
        case 0: return (this.sine[l.phase >>> 20] / 32767 + 1) / 2;
        case 1: return 1 - Math.abs(ph * 2 - 1);
        case 2: return ph;
        case 3: return 1 - ph;
        case 4: return l.phase > 0x7fffffff ? 1 : 0;
        case 5: if (ovf) l.rnd = Math.random(); return l.rnd;
        case 6: return ph * ph * ph;
        case 7: { const x = 1 - ph; return x * x * x; }
      }
      return 0;
    }
    lfoRetrigger(voice) { for (const v of this.voices) if (v.lfo.retrigger === voice + 1) v.lfo.phase = v.lfo.offset >>> 0; }

    /* ------------------------------------------------------------ parameters */
    buildHandlers() {
      const P = this.P, H = (this.H = []), V = this.voices, E = this;
      const set = (name, fn) => { if (P[name] !== undefined) H[P[name]] = fn; };
      const menuVal = (m, itg, flt, n) => (m ? Math.min(n - 1, Math.floor(n * flt)) : itg);
      const wave = (x) => (x > 5 ? SINE : x);
      const coarse = (o) => (itg) => { o.midiFreq = (o.midiFreq & 0xff) | (itg << 8); E.recalcFreq(o); };
      const fine = (o) => (itg) => { o.midiFreq = (o.midiFreq & 0xff00) | itg; E.recalcFreq(o); };
      const KA = (2 * 0.99) / (1 - 0.99), KD = (2 * 0.999) / (1 - 0.999);
      for (let i = 0; i < 3; i++) {
        const v = V[i], n = i + 1;
        set('PAR_OSC_WAVE_DRUM' + n, (itg, flt, m) => { v.osc.wave = wave(menuVal(m, itg, flt, 6)); });
        set('PAR_MOD_WAVE_DRUM' + n, (itg, flt, m) => { v.modOsc.wave = wave(menuVal(m, itg, flt, 6)); });
        set('PAR_COARSE' + n, coarse(v.osc)); set('PAR_FINE' + n, fine(v.osc));
        set('PAR_MOD_EG' + n, (itg) => { v.pitchEg.decay = E.decayTime(itg); });
        set('PAR_MODAMNT' + n, (itg) => { const x = itg / 127; v.egPitchModAmount = x * x * 32; });
        set('PAR_PITCH_SLOPE' + n, (itg) => E.decaySlope(v.pitchEg, itg));
        set('PAR_FMAMNT' + n, (itg, flt) => { v.fmModAmount = flt; });
        set('PAR_FM_FREQ' + n, coarse(v.modOsc));
        set('PAR_DRIVE' + n, (itg, flt) => { v.dist = E.distShape(flt); });
        set('PAR_MIX_MOD_' + n, (itg) => { v.mixOscs = itg !== 0 ? 1 : 0; });
        set('PAR_VOL_SLOPE' + n, (itg) => E.egSetSlope(v.amp, itg));
        set('PAR_VELOA' + n, (itg) => { v.amp.attack = E.egTime(itg, KA); });
        set('PAR_VELOD' + n, (itg) => { v.amp.decay = E.egTime(itg, KD); });
      }
      const s = V[3];
      set('PAR_OSC_WAVE_SNARE', (itg, flt, m) => { s.osc.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_COARSE4', coarse(s.osc)); set('PAR_FINE4', fine(s.osc));
      set('PAR_NOISE_FREQ1', (itg, flt) => { s.noiseOsc.freq = flt * 22000; });
      set('PAR_MIX1', (itg, flt) => { s.mix = flt; });
      set('PAR_MOD_EG4', (itg) => { s.pitchEg.decay = E.decayTime(itg); });
      set('PAR_MODAMNT4', (itg) => { const x = itg / 127; s.egPitchModAmount = x * x * 32; });
      set('PAR_PITCH_SLOPE4', (itg) => E.decaySlope(s.pitchEg, itg));
      set('PAR_VELOA4', (itg) => { s.amp.attack = E.egTime(itg, KA); });
      set('PAR_VELOD4', (itg) => { s.amp.decay = E.egTime(itg, KD); });
      set('PAR_REPEAT4', (itg) => { s.amp.repeat = itg; });
      set('PAR_VOL_SLOPE4', (itg) => E.egSetSlope(s.amp, itg));
      set('PAR_SNARE_DISTORTION', (itg, flt) => { s.dist = E.distShape(flt); });

      const c = V[4];
      set('PAR_WAVE1_CYM', (itg, flt, m) => { c.osc.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_WAVE2_CYM', (itg, flt, m) => { c.modOsc.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_WAVE3_CYM', (itg, flt, m) => { c.modOsc2.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_COARSE5', coarse(c.osc)); set('PAR_FINE5', fine(c.osc));
      set('PAR_MOD_OSC_F1_CYM', coarse(c.modOsc)); set('PAR_MOD_OSC_F2_CYM', coarse(c.modOsc2));
      set('PAR_MOD_OSC_GAIN1_CYM', (itg, flt) => { c.fm1 = flt; });
      set('PAR_MOD_OSC_GAIN2_CYM', (itg, flt) => { c.fm2 = flt; });
      set('PAR_VELOA5', (itg) => { c.amp.attack = E.egTime(itg, KA); });
      set('PAR_VELOD5', (itg) => { c.amp.decay = E.egTime(itg, KD); });
      set('PAR_REPEAT5', (itg) => { c.amp.repeat = itg; });
      set('PAR_VOL_SLOPE5', (itg) => E.egSetSlope(c.amp, itg));
      set('PAR_CYMBAL_DISTORTION', (itg, flt) => { c.dist = E.distShape(flt); });

      const h = V[5];
      set('PAR_WAVE1_HH', (itg, flt, m) => { h.osc.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_WAVE2_HH', (itg, flt, m) => { h.modOsc.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_WAVE3_HH', (itg, flt, m) => { h.modOsc2.wave = wave(menuVal(m, itg, flt, 6)); });
      set('PAR_COARSE6', coarse(h.osc)); set('PAR_FINE6', fine(h.osc));
      set('PAR_MOD_OSC_F1', coarse(h.modOsc)); set('PAR_MOD_OSC_F2', coarse(h.modOsc2));
      set('PAR_MOD_OSC_GAIN1', (itg, flt) => { h.fm1 = flt; });
      set('PAR_MOD_OSC_GAIN2', (itg, flt) => { h.fm2 = flt; });
      set('PAR_VELOA6', (itg) => { h.amp.attack = E.egTime(itg, KA); });
      set('PAR_VELOD6_CLOSED', (itg) => { h.decayClosed = E.egTime(itg, KD); });
      set('PAR_VELOD6_OPEN', (itg) => { h.decayOpen = E.egTime(itg, KD); });
      set('PAR_VOL_SLOPE6', (itg) => E.egSetSlope(h.amp, itg));
      set('PAR_HAT_DISTORTION', (itg, flt) => { h.dist = E.distShape(flt); });

      for (let i = 0; i < 6; i++) {
        const v = V[i], n = i + 1;
        set('PAR_FILTER_FREQ_' + n, (itg, flt) => E.svfDirect(v.filter, valueShaper(flt, -0.9)));
        set('PAR_RESO_' + n, (itg, flt) => E.svfReso(v.filter, flt));
        set('PAR_FILTER_DRIVE_' + n, (itg, flt) => { v.filter.drive = 0.4 + flt * flt * 6; });
        set('PAR_FILTER_TYPE_' + n, (itg, flt, m) => {
          if (m) { let t = Math.floor(F_LP2 * flt) + 1; if (t >= F_OFF) t = F_OFF - 1; v.filterType = t; } else v.filterType = itg + 1;
        });
        set('PAR_VOL' + n, (itg, flt) => { v.vol = flt; });
        set('PAR_PAN' + n, (itg) => { v.pan = itg; });
        set('PAR_VOICE_DECIMATION' + n, (itg, flt) => { E.decim[i] = valueShaper(flt, -0.7); });
        set('PAR_FREQ_LFO' + n, (itg, flt) => E.lfoSetFreq(v.lfo, flt));
        set('PAR_AMOUNT_LFO' + n, (itg, flt) => { v.lfo.node.amount = flt; });
        set('PAR_WAVE_LFO' + n, (itg, flt, m) => { v.lfo.wave = menuVal(m, itg, flt, 8); });
        set('PAR_RETRIGGER_LFO' + n, (itg, flt, m) => { v.lfo.retrigger = m ? Math.floor(7 * flt) : itg; });
        set('PAR_SYNC_LFO' + n, (itg) => { v.lfo.sync = itg; v.lfo.inc = E.lfoInc(v.lfo.freq, itg); });
        set('PAR_OFFSET_LFO' + n, (itg, flt) => { v.lfo.offset = u32(flt * 4294967295); });
        set('PAR_TARGET_LFO' + n, (itg, flt, m) => { if (!m) E.setModDest(v.lfo.node, E.modTargetParams[itg] || 0); });
        set('PAR_VEL_DEST_' + n, (itg, flt, m) => { if (!m) E.setModDest(E.velMods[i], E.modTargetParams[itg] || 0); });
        set('PAR_VELO_MOD_AMT_' + n, (itg, flt) => { E.velMods[i].amount = flt; });
        set('PAR_VOLUME_MOD_ON_OFF' + n, (itg) => { v.volumeMod = itg !== 0 ? 1 : 0; });
        set('PAR_TRANS' + n + '_VOL', (itg, flt) => { v.trans.volume = flt; });
        set('PAR_TRANS' + n + '_WAVE', (itg, flt, m) => { const w = m ? Math.min(13, Math.floor(14 * flt)) : itg; v.trans.wave = w < 14 ? w : 0; });
        set('PAR_TRANS' + n + '_FREQ', (itg) => { v.trans.pitch = 1 + (itg / 33.9 - 0.75); });
        set('PAR_AUDIO_OUT' + n, (itg) => { E.routing[i] = itg; });
        set('PAR_PWM_' + n, (itg, flt) => { v.pwm = flt; });
      }
      set('PAR_VOICE_DECIMATION_ALL', (itg, flt) => { E.decim[6] = valueShaper(flt, -0.7); });
      const fx = this.fx;
      set('PAR_FX_TYPE', (itg) => { fx.type = itg; E.fxUpdate(); });
      set('PAR_FX_ROUTING', (itg) => { fx.routing = itg; });
      set('PAR_FX_DRY_WET', (itg) => { fx.dryWet = itg / 100; });
      set('PAR_FX_DIST_TYPE', (itg) => { fx.distType = itg; });
      for (let k = 0; k < 4; k++) set('PAR_FX_P' + (k + 1), (itg, flt) => { fx.p[k] = flt; E.fxUpdate(); });
      set('PAR_FX_RATIO', (itg) => { fx.comp.ratio = [1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125][itg] || 1; });
      set('PAR_FX_WAVE', (itg) => { fx.ringOsc.wave = itg > 5 ? REC : itg; E.setOscFreq(fx.ringOsc); });
      set('PAR_FX_DELAY_TYPE', (itg) => { fx.delay.type = itg; });
    }
    apply(p, itg, flt, isMod) { const h = this.H[p]; if (h) h(itg, flt, !!isMod); }
    applyKitValue(p) { const v = this.kit[p]; this.apply(p, v, v / 127, false); }
    applyMod(node, val) {
      if (!node.dest) return;
      let nv = this.kit[node.dest] / 127 + node.amount * (val * 2 - 1);
      nv = clamp01(nv);
      this.apply(node.dest, Math.floor(nv * 127), nv, true);
    }
    setModDest(node, dest) { if (node.dest && node.dest !== dest) this.applyKitValue(node.dest); node.dest = dest; }
    loadKit(arr) {
      for (let i = 0; i < this.END; i++) this.kit[i] = arr[i] || 0;
      // drop modulation destinations first so stale targets are restored
      for (const v of this.voices) this.setModDest(v.lfo.node, 0);
      for (const m of this.velMods) this.setModDest(m, 0);
      for (let i = 1; i < this.END; i++) this.applyKitValue(i);
      this.fxUpdate();
      for (let i = 0; i < 300; i++) this.origCc[i] = 0;
    }
    setParam(p, v) { this.kit[p] = v; this.applyKitValue(p); }

    /* ------------------------------------------------------------ FX bus */
    fxUpdate() {
      const fx = this.fx, p = fx.p;
      switch (fx.type) {
        case 1: fx.dist.drive = p[0]; fx.dist.p1 = p[1]; fx.dist.p2 = p[2]; fx.dist.p3 = p[3]; break;
        case 2: fx.ringOsc.freq = p[0] * 880; this.setOscFreq(fx.ringOsc); break;
        case 3: {
          const c = fx.comp, fs = this.fs;
          c.attack = Math.exp(-1000 / ((0.03 + p[0] * 100) * fs));
          c.release = Math.exp(-1000 / ((25 + p[1] * 175) * fs));
          c.tresh = -96 + p[2] * 96;
          c.makeup = 1 + p[3] * 2;
          break;
        }
        case 4: {
          const d = fx.delay;
          d.range = p[1]; this.delaySetTime(d, d.time);
          this.delaySetTime(d, p[0]);
          d.toneR = p[2] * p[2];
          d.fb = p[3];
          break;
        }
      }
    }
    delaySetTime(d, t) {
      if (d.interp <= 0) {
        d.time = t;
        const fs = this.fs, lerp = (a, b, x) => a * (1 - x) + b * x;
        const LOW_MIN = 0.0006 * fs, LOW_MAX = 0.02 * fs, HI_MIN = 0.02 * fs, HI_MAX = 0x7fff;
        const cv = t * d.range;
        const mn = lerp(LOW_MIN, HI_MIN, d.range);
        const mx = d.type === 0 ? lerp(LOW_MAX, HI_MAX, d.range) : lerp(LOW_MAX, HI_MAX * 0.48, d.range);
        const offset = lerp(mn, mx, cv);
        const oi = Math.floor(offset);
        d.fracNew = offset - oi;
        d.newRead = (d.write - 1 - oi) & (d.type === 0 ? 0x7fff : 0x3fff);
        d.interp = 1; d.step = 1 / (fs * 0.01);
      } else { d.pending = t; d.timePending = 1; }
    }
    fxProcess() {
      const fx = this.fx, n = BLOCK, L = this.fxL, R = this.fxR, dw = fx.dryWet;
      let oL, oR, ch = 2;
      switch (fx.routing) {
        default: case 0: oL = this.outL; oR = this.outR; break;
        case 1: oL = this.out2L; oR = this.out2R; break;
        case 2: oL = this.outL; ch = 1; break;
        case 3: oL = this.outR; ch = 1; break;
        case 4: oL = this.out2L; ch = 1; break;
        case 5: oL = this.out2R; ch = 1; break;
      }
      const mix = (dry, wet) => sat(dry + sat(trunc((wet - dry) * dw)));
      const emit = (i, a, b) => { if (ch === 2) { oL[i] = sat(oL[i] + a); oR[i] = sat(oR[i] + b); } else oL[i] = sat(oL[i] + a); };
      switch (fx.type) {
        case 1: {
          const d = fx.dist;
          const coff = 0.06537948995454451662 + d.p2 * 0.92410701734426630737;
          if (fx.distType === 0) {
            const om = 1 + 0.55 * d.p1 + 0.55 * d.p1;
            const tube = (x, c) => {
              const inp = trunc(x * (1 + d.drive * (ch === 2 ? 4 : 1)));
              const itg = (sat(inp) >> 9) + 64, fr = (inp & 0x1ff) / 512;
              const val = this.ecc[itg] + (this.ecc[itg + 1] - this.ecc[itg]) * fr;
              d.lp3[c] += coff * (val - d.lp3[c]);
              return sat(trunc(d.lp3[c] * om * d.p3 * 32768));
            };
            for (let i = 0; i < n; i++) emit(i, mix(L[i], tube(L[i], 0)), ch === 2 ? mix(R[i], tube(R[i], 1)) : 0);
          } else if (fx.distType === 1) {
            const fold = (x, c) => {
              let v = (x / 32768) * (1 + d.drive * 4) + d.p1;
              d.lp3[c] += coff * (v - d.lp3[c]);
              v = d.lp3[c];
              if (v > 1 || v < -1) { const m = (v - 1) % 4; v = Math.abs(Math.abs(m) - 2) - 1; }
              return sat(trunc(v * d.p3 * 32768));
            };
            for (let i = 0; i < n; i++) emit(i, mix(L[i], fold(L[i], 0)), ch === 2 ? mix(R[i], fold(R[i], 1)) : 0);
          } else {
            const gain = 1 + d.drive * 2304, SL = 6.79655641141821477118;
            const rat = (x, c) => {
              let s = x / 32768 + d.last[c] * d.p1 * 0.125;
              d.hp1[c] += 0.64116641920131193922 * (s - d.hp1[c]); s -= d.hp1[c];
              d.lp1[c] += (1 - 0.1025353241628911807) * (s - d.lp1[c]); s = d.lp1[c];
              d.hp3[c] += (1 - 0.99149556438154282898) * (s - d.hp3[c]); s -= d.hp3[c];
              d.lp2[c] += (1 - 0.93130041642945205043) * (s - d.lp2[c]); s = d.lp2[c];
              s *= gain;
              let diff = s - d.slew[c]; if (Math.abs(diff) > SL) diff = SL * Math.sign(diff);
              d.slew[c] += diff; if (d.slew[c] > 4.2) d.slew[c] = 4.2; else if (d.slew[c] < -4.2) d.slew[c] = -4.2;
              let xi = d.slew[c]; xi = xi < -1 ? -1 : xi > 1 ? 1 : xi;
              const idx = (xi + 1) * 128, it = Math.min(255, Math.floor(idx)), fr = idx - it;
              const dv = this.diode[it] + (this.diode[it + 1] - this.diode[it]) * fr;
              d.lp3[c] += coff * (dv - d.lp3[c]);
              d.last[c] = d.lp3[c] * d.p3;
              return sat(trunc(d.last[c] * 32768));
            };
            for (let i = 0; i < n; i++) emit(i, mix(L[i], rat(L[i], 0)), ch === 2 ? mix(R[i], rat(R[i], 1)) : 0);
          }
          break;
        }
        case 2: {
          const rb = this.ring;
          this.oscBlock(fx.ringOsc, rb, 1, 0.3);
          for (let i = 0; i < n; i++) emit(i, mix(L[i], Math.floor((L[i] * rb[i]) / 65536)), ch === 2 ? mix(R[i], Math.floor((R[i] * rb[i]) / 65536)) : 0);
          break;
        }
        case 3: {
          const c = fx.comp;
          for (let i = 0; i < n; i++) {
            const inp = ch === 2 ? 0.5 * (L[i] / 32768) + 0.5 * (R[i] / 32768) : L[i] / 32768;
            const peakdB = 20 * Math.log10(Math.abs(inp) + 1e-25);
            let over = peakdB - c.tresh; if (over < 0) over = 0;
            const coeff = over > c.env ? c.attack : c.release;
            c.env = over + coeff * (c.env - over);
            if (c.env !== c.env) c.env = 0;
            const gr = Math.pow(10, (c.env * (c.ratio - 1)) / 20);
            const l = sat(trunc(L[i] * gr * c.makeup)), r = sat(trunc(R[i] * gr * c.makeup));
            emit(i, mix(L[i], l), ch === 2 ? mix(R[i], r) : 0);
          }
          break;
        }
        case 4: {
          const d = fx.delay, buf = d.buf, pp = d.type !== 0, mask = pp ? 0x3fff : 0x7fff, half = 0x3fff;
          const rd = (which) => {
            if (which === 0) {
              const p2 = (d.oldRead + 1) & mask;
              d.t0 = (buf[d.oldRead] * (1 - d.fracOld) + buf[p2] * d.fracOld) * 32767;
              if (pp) d.u0 = (buf[half + d.oldRead] * (1 - d.fracOld) + buf[half + p2] * d.fracOld) * 32767;
              d.oldRead = (d.oldRead + 1) & mask;
            } else {
              const p2 = (d.newRead + 1) & mask;
              d.t1 = (buf[d.newRead] * (1 - d.fracNew) + buf[p2] * d.fracNew) * 32767;
              if (pp) d.u1 = (buf[half + d.newRead] * (1 - d.fracNew) + buf[half + p2] * d.fracNew) * 32767;
              d.newRead = (d.newRead + 1) & mask;
            }
          };
          for (let i = 0; i < n; i++) {
            let a, b;
            if (d.interp <= 0) {
              rd(0); a = d.t0; b = d.u0;
              if (d.timePending) { d.timePending = 0; this.delaySetTime(d, d.pending); }
            } else {
              rd(0); rd(1);
              a = d.t0 * d.interp + d.t1 * (1 - d.interp);
              b = d.u0 * d.interp + d.u1 * (1 - d.interp);
              d.interp -= d.step;
              if (d.interp <= 0) { d.oldRead = d.newRead; d.fracOld = d.fracNew; }
            }
            a = trunc(a); b = trunc(b);
            d.toneL += d.toneR * (a - d.toneL); a = trunc(d.toneL);
            if (pp) {
              d.toneR2 += d.toneR * (b - d.toneR2); b = trunc(d.toneR2);
              let v = sat(L[i] + trunc(a * d.fb)) / 32767; buf[half + d.write] = v > 1 ? 1 : v < -1 ? -1 : v;
              v = sat(R[i] + trunc(b * d.fb)) / 32767; buf[d.write] = v > 1 ? 1 : v < -1 ? -1 : v;
              d.write = (d.write + 1) & half;
              emit(i, mix(L[i], a), ch === 2 ? mix(R[i], b) : 0);
            } else {
              const v = sat(sat(L[i] + R[i]) + trunc(a * d.fb)) / 32767;
              buf[d.write] = v > 1 ? 1 : v < -1 ? -1 : v;
              d.write = (d.write + 1) & 0x7fff;
              emit(i, mix(L[i], a), ch === 2 ? mix(R[i], a) : 0);
            }
          }
          break;
        }
        default:
          for (let i = 0; i < n; i++) emit(i, L[i], R[i]);
      }
    }

    /* ------------------------------------------------------------ voices */
    trigger(track, vel, note) {
      if (track > 6) return;
      const vi = track < 6 ? track : 5;
      const v = this.voices[vi];
      this.lfoRetrigger(vi);
      this.velMods[vi].last = vel / 127;
      let offset = 1;
      if (v.trans.wave === 1) offset -= v.trans.volume;
      if (v.kind === 'drum') {
        this.oscStartPhase(v.osc, offset);
        this.oscStartPhase(v.modOsc, 1);
        this.setBaseNote(v.osc, note); this.setBaseNote(v.modOsc, note);
        v.pitchEg.value = 1;
        this.svfReset(v.filter);
      } else if (v.kind === 'snare') {
        this.oscStartPhase(v.osc, offset);
        v.pitchEg.value = 1;
        this.setBaseNote(v.osc, note);
      } else {
        this.oscStartPhase(v.osc, offset);
        v.modOsc.phase = 0; v.modOsc2.phase = 0;
        this.setBaseNote(v.osc, note); this.setBaseNote(v.modOsc, note); this.setBaseNote(v.modOsc2, note);
        if (v.kind === 'hat') v.amp.decay = track === 6 ? v.decayOpen : v.decayClosed;
      }
      this.egTrigger(v.amp);
      v.velo = vel / 127;
      v.panL = Math.sqrt((127 - v.pan) / 127); v.panR = Math.sqrt(v.pan / 127);
      v.trans.phase = 0;
      v.snap = 1;
      this.events.push({ t: 'trig', track });
    }
    calcAsync() {
      for (let i = 0; i < 6; i++) {
        const v = this.voices[i];
        if (v.kind === 'drum' || v.kind === 'snare') {
          const eg = this.decayCalc(v.pitchEg);
          v.osc.pitchMod = 1 + eg * v.egPitchModAmount;
          if (v.kind === 'drum') {
            if (v.trans.wave === 0) v.osc.pitchMod += this.snapCalc(v, v.trans.pitch) * v.trans.volume;
            v.osc.fmMod = v.fmModAmount * eg;
            if (v.amp.attack === 1 && (v.amp.state === EG_A || v.amp.state === EG_REPEAT)) { v.ampIn = this.egCalc(v.amp); v.lastGain = v.ampIn; }
            else { v.lastGain = v.ampIn; v.ampIn = this.egCalc(v.amp); }
            this.setOscFreq(v.osc); this.setOscFreq(v.modOsc);
          } else {
            v.ampVal = this.egCalc(v.amp);
            if (v.trans.wave === 0) v.osc.pitchMod += this.snapCalc(v, v.trans.pitch) * v.trans.volume;
            this.setOscFreq(v.osc); this.setOscFreq(v.noiseOsc);
          }
        } else {
          v.ampVal = this.egCalc(v.amp);
          if (v.trans.wave === 0) v.osc.pitchMod = 1 + this.snapCalc(v, v.trans.pitch) * v.trans.volume;
          this.setOscFreq(v.osc); this.setOscFreq(v.modOsc); this.setOscFreq(v.modOsc2);
        }
      }
    }
    renderDrum(v, buf) {
      const mod = this.b2, n = BLOCK;
      this.oscBlock(v.modOsc, mod, v.fmModAmount, v.pwm);
      if (v.mixOscs) { this.oscBlock(v.osc, buf, 1 - v.fmModAmount, v.pwm); for (let i = 0; i < n; i++) buf[i] = sat(buf[i] + mod[i]); }
      else this.oscFmBlock(v.osc, mod, buf, 1, v.pwm);
      this.transBlock(v.trans, mod);
      for (let i = 0; i < n; i++) buf[i] = sat(buf[i] + mod[i]);
      this.svfBlock(v.filter, v.filterType, buf);
      const g0 = v.lastGain, g1 = v.ampIn;
      for (let i = 0; i < n; i++) buf[i] = trunc(buf[i] * (g0 + (i / (n - 1)) * (g1 - g0)));
      if (v.volumeMod) for (let i = 0; i < n; i++) buf[i] = trunc(buf[i] * v.velo);
      const fv = this.fader[v.idx];
      for (let i = 0; i < n; i++) {
        v.distSm += 0.01 * (v.dist - v.distSm);
        const k = v.distSm, x = buf[i] / 32767;
        let y = trunc((((1 + k) * x) / (1 + k * Math.abs(x))) * 32767);
        v.volSm += 0.01 * (v.vol - v.volSm);
        v.faderSm += 0.01 * (fv - v.faderSm);
        buf[i] = trunc(y * v.volSm * v.faderSm);
      }
    }
    renderSnare(v, buf) {
      const osc = this.b2, tr = this.b3, n = BLOCK;
      this.noiseBlock(v.noiseOsc, buf, 0.9);
      this.svfBlock(v.filter, v.filterType, buf);
      this.oscBlock(v.osc, osc, 1 - v.mix, v.pwm);
      this.transBlock(v.trans, tr);
      const cv = v.vol * (v.volumeMod ? v.velo : 1) * v.ampVal, fv = this.fader[3];
      for (let i = 0; i < n; i++) {
        const tmp = buf[i] * v.mix + osc[i] + tr[i];
        v.faderSm += 0.1 * (fv - v.faderSm);
        buf[i] = sat(trunc(cv * tmp * v.faderSm));
      }
      this.distBlock(buf, v.dist);
    }
    renderMetal(v, buf) {
      const m1 = this.b2, m2 = this.b3, n = BLOCK;
      this.oscBlock(v.modOsc, m1, v.fm1, v.pwm);
      this.oscBlock(v.modOsc2, m2, v.fm2, v.pwm);
      for (let i = 0; i < n; i++) m1[i] = sat(m1[i] + m2[i]);
      this.oscFmBlock(v.osc, m1, buf, v.oscGain, v.pwm);
      this.svfBlock(v.filter, v.filterType, buf);
      this.transBlock(v.trans, m1);
      const cv = v.vol * (v.volumeMod ? v.velo : 1) * v.ampVal, fv = this.fader[v.idx];
      for (let i = 0; i < n; i++) {
        v.faderSm += 0.1 * (fv - v.faderSm);
        buf[i] = trunc(sat(buf[i] + m1[i]) * cv * v.faderSm);
      }
      this.distBlock(buf, v.dist);
    }
    decimate(i, buf) {
      const inc = this.decim[i] * this.decim[6];
      for (let k = 0; k < BLOCK; k++) {
        this.decimCnt[i] += inc;
        if (this.decimCnt[i] >= 1) { this.decimCnt[i] -= 1; this.decimHold[i] = buf[k]; }
        buf[k] = this.decimHold[i];
      }
    }
    route(i, buf, v) {
      const pl = v.panL, pr = v.panR;
      let a, b, mono = null;
      switch (this.routing[i]) {
        default: case 0: a = this.outL; b = this.outR; break;
        case 1: a = this.out2L; b = this.out2R; break;
        case 2: mono = this.outL; break;
        case 3: mono = this.outR; break;
        case 4: mono = this.out2L; break;
        case 5: mono = this.out2R; break;
        case 6: a = this.fxL; b = this.fxR; break;
      }
      for (let k = 0; k < BLOCK; k++) if (buf[k] !== buf[k]) buf[k] = 0;
      if (mono) { for (let k = 0; k < BLOCK; k++) mono[k] = sat(mono[k] + buf[k]); return; }
      for (let k = 0; k < BLOCK; k++) { a[k] = sat(a[k] + trunc(buf[k] * pl)); b[k] = sat(b[k] + trunc(buf[k] * pr)); }
    }
    renderBlock(L, R, off) {
      // modulation: restore targets, then velocity and LFO modulation (block rate)
      for (const m of this.velMods) if (m.dest) this.applyKitValue(m.dest);
      for (const v of this.voices) if (v.lfo.node.dest) this.applyKitValue(v.lfo.node.dest);
      for (const m of this.velMods) this.applyMod(m, m.last);
      for (const v of this.voices) this.applyMod(v.lfo.node, this.lfoCalc(v.lfo));
      for (const v of this.voices) v.filter.g = this.fastTan(Math.PI * v.filter.f);
      this.calcAsync();
      this.outL.fill(0); this.outR.fill(0); this.out2L.fill(0); this.out2R.fill(0); this.fxL.fill(0); this.fxR.fill(0);
      const buf = this.b;
      for (let i = 0; i < 6; i++) {
        const v = this.voices[i];
        if (v.kind === 'drum') this.renderDrum(v, buf);
        else if (v.kind === 'snare') this.renderSnare(v, buf);
        else this.renderMetal(v, buf);
        this.decimate(i, buf);
        this.route(i, buf, v);
      }
      this.fxProcess();
      const g = this.master / 32768;
      let pkL = 0, pkR = 0;
      for (let k = 0; k < BLOCK; k++) {
        const l = sat(this.outL[k] + this.out2L[k]) * g, r = sat(this.outR[k] + this.out2R[k]) * g;
        L[off + k] = l; R[off + k] = r;
        const al = Math.abs(l), ar = Math.abs(r);
        if (al > pkL) pkL = al; if (ar > pkR) pkR = ar;
      }
      if (pkL > this.meterL) this.meterL = pkL; if (pkR > this.meterR) this.meterR = pkR;
    }

    /* ------------------------------------------------------------ sequencer */
    tickLen() { return (this.fs * 60) / (this.bpm * 96); }
    play() {
      const s = this.seq;
      if (s.pending) this.applyQueued();
      s.running = true; s.stepIdx.fill(-1); s.tick = 0; s.t = 0; s.delay = 0; s.masterCnt = 0;
    }
    stop() {
      const s = this.seq; s.running = false;
      for (let t = 0; t < 7; t++) this.autoRestore(t);
      this.events.push({ t: 'step', idx: [-1, -1, -1, -1, -1, -1, -1] });
    }
    applyQueued() {
      const s = this.seq, q = s.pending; s.pending = null;
      if (!q) return;
      s.pattern = q.pat;
      if (q.shuffle !== undefined) s.shuffle = q.shuffle;
      if (q.kit) this.loadKit(q.kit);
      this.events.push({ t: 'patswitch', id: q.id });
    }
    trackLen(t) { const l = this.seq.pattern ? this.seq.pattern.len[t] : 16; return l > 0 && l <= 64 ? l : 16; }
    nextStep() {
      const s = this.seq;
      s.masterCnt++;
      if (!s.pattern) return;
      // master track = the longest one; when it wraps, a queued pattern takes over
      let longest = 0, lt = 0;
      for (let t = 0; t < 7; t++) { const l = this.trackLen(t); if (l > longest) { longest = l; lt = t; } }
      const mpos = s.stepIdx[lt] + 1;
      if (s.stepIdx[lt] >= 0 && (mpos >= longest || (mpos & 63) === 0) && s.pending) {
        this.applyQueued();
        s.stepIdx.fill(-1);
      }
      for (let t = 0; t < 7; t++) {
        let i = s.stepIdx[t] + 1;
        if (i >= this.trackLen(t) || (i & 63) === 0) i = 0;
        s.stepIdx[t] = i;
        s.rndPrev[t] = s.rndCur[t]; s.rndCur[t] = s.rndNext[t]; s.rndNext[t] = 1 + Math.floor(Math.random() * 100);
      }
      this.events.push({ t: 'step', idx: Array.from(s.stepIdx) });
    }
    stepData(t, i) { return this.seq.pattern.steps[t][i]; }
    shiftFlam(t, i, pos) {
      // returns 24-bit trigger mask for a step from the given position (prev/cur/next)
      const st = this.stepData(t, i);
      if (!st || !st[0]) return 0;
      const s = this.seq;
      const r = pos === 0 ? s.rndPrev[t] : pos === 1 ? s.rndCur[t] : s.rndNext[t];
      if (r > st[2]) return 0;
      const flam = [0x800000, 0x800800, 0x808080, 0x820820, 0x888888, 0x924924][st[4]] || 0x800000;
      let sh = ((st[5] <= 14 ? st[5] : 7) - 7) * 3;
      if (sh === 0) return pos === 1 ? flam : 0;
      if (sh > 0) return pos === 0 ? (flam << (24 - sh)) & 0xffffff : pos === 1 ? (flam >>> sh) & 0xffffff : 0;
      sh = -sh;
      return pos === 1 ? (flam << sh) & 0xffffff : pos === 2 ? (flam >>> (24 - sh)) & 0xffffff : 0;
    }
    processTick(idx) {
      const s = this.seq;
      if (!s.pattern) return;
      let chokeCur = 0, chokeNext = 0;
      for (let t = 0; t < 7; t++) {
        if (this.mute[t]) continue;
        const len = this.trackLen(t), cur = s.stepIdx[t];
        if (cur < 0) continue;
        const nxt = (cur + 1) % len, prv = cur !== 0 ? cur - 1 : len - 1;
        const bit = 1 << (23 - idx);
        const nA = (this.shiftFlam(t, nxt, 2) & bit) !== 0;
        const cA = (this.shiftFlam(t, cur, 1) & bit) !== 0;
        const pA = (this.shiftFlam(t, prv, 0) & bit) !== 0;
        let which = -1;
        if (nA) { chokeNext = 1; which = nxt; }
        else if (cA && !chokeNext) { chokeCur = 1; which = cur; }
        else if (pA && !chokeNext && !chokeCur) which = prv;
        if (which >= 0) { s.lastWasOn[t] = 1; this.seqTrigger(t, which); }
        else if (s.lastWasOn[t]) s.lastWasOn[t] = 0;
      }
    }
    // per-step parameter automation; destination numbering follows the firmware (CC-style)
    autoApply(dest, val) {
      if (dest === 255) return;
      const p = dest > 127 ? dest : dest - 1;
      if (p <= 0 || p >= this.END) return;
      this.apply(p, val, val / 127, false);
    }
    autoRestore(t) {
      const a = this.seq.autom[t];
      for (let k = 0; k < 2; k++) {
        if (a[k] !== 255) { const p = a[k] > 127 ? a[k] : a[k] - 1; if (p > 0 && p < this.END) this.applyKitValue(p); }
        a[k] = 255;
      }
    }
    seqTrigger(t, i) {
      const st = this.stepData(t, i);
      const a = this.seq.autom[t];
      // set destinations (restoring the previous ones), then values
      for (let k = 0; k < 2; k++) {
        const nd = st[6 + k * 2];
        if (a[k] !== 255) { const p = a[k] > 127 ? a[k] : a[k] - 1; if (p > 0 && p < this.END) this.applyKitValue(p); }
        a[k] = nd;
      }
      this.autoApply(st[6], st[7]);
      this.autoApply(st[8], st[9]);
      this.trigger(t, st[1], st[3]);
    }
    advance(n) {
      // 96 PPQ clock, 24 ticks per step, evaluated at block boundaries like the firmware's main loop
      const s = this.seq;
      if (!s.running) return;
      s.t += n;
      for (let guard = 0; guard < 96; guard++) {
        const tl = this.tickLen();
        if (s.tick >= 24) {
          if (s.t < 24 * tl) break;
          s.t -= 24 * tl; s.tick = 0;
          // swing: the step after an odd master step starts late, then its ticks catch up
          s.delay = s.shuffle > 0 && s.masterCnt % 2 === 1 ? Math.min(23, s.shuffle * 16) : 0;
        }
        const due = s.tick === 0 ? s.delay * tl : Math.max(s.tick * tl, s.delay * tl);
        if (s.t < due) break;
        if (s.tick === 0) this.nextStep();
        this.processTick(s.tick);
        s.tick++;
      }
    }
    setBpm(b) { this.bpm = Math.max(20, Math.min(300, b)); for (const v of this.voices) v.lfo.inc = this.lfoInc(v.lfo.freq, v.lfo.sync); }

    /* ------------------------------------------------------------ host */
    process(L, R, frames) {
      for (let off = 0; off < frames; off += BLOCK) {
        this.advance(BLOCK);
        this.renderBlock(L, R, off);
      }
    }
    handle(m) {
      switch (m.t) {
        case 'kit': this.loadKit(m.p); break;
        case 'param': this.setParam(m.i, m.v); break;
        case 'pattern': this.seq.pattern = m.pat; if (m.shuffle !== undefined) this.seq.shuffle = m.shuffle; break;
        case 'queue': this.seq.pending = { pat: m.pat, kit: m.kit, shuffle: m.shuffle, id: m.id }; if (!this.seq.running) this.applyQueued(); break;
        case 'play': this.play(); break;
        case 'stop': this.stop(); break;
        case 'bpm': this.setBpm(m.v); break;
        case 'shuffle': this.seq.shuffle = m.v; break;
        case 'trig': this.trigger(m.track, m.vel, m.note || 63); break;
        case 'fader': this.fader[m.v] = m.val; break;
        case 'master': this.master = m.val; break;
        case 'mute': this.mute[m.track] = m.on ? 1 : 0; break;
      }
    }
  }

  if (typeof registerProcessor === 'function') {
    class LubkaProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.engine = null;
        this.queue = [];
        this.meterFrames = 0;
        this.port.onmessage = (e) => {
          const m = e.data;
          if (m.t === 'init') { this.engine = new Engine(sampleRate, m); for (const q of this.queue) this.engine.handle(q); this.queue = []; this.port.postMessage({ t: 'ready', fs: sampleRate }); }
          else if (this.engine) this.engine.handle(m); else this.queue.push(m);
        };
      }
      process(inputs, outputs) {
        const out = outputs[0];
        if (!this.engine || !out || !out[0]) return true;
        const L = out[0], R = out[1] || out[0];
        this.engine.process(L, R, L.length);
        const ev = this.engine.events;
        if (ev.length) { this.port.postMessage({ t: 'events', ev: ev.slice() }); ev.length = 0; }
        this.meterFrames += L.length;
        if (this.meterFrames > sampleRate / 30) {
          this.meterFrames = 0;
          this.port.postMessage({ t: 'meter', l: this.engine.meterL, r: this.engine.meterR });
          this.engine.meterL *= 0; this.engine.meterR *= 0;
        }
        return true;
      }
    }
    registerProcessor('lubka-m1', LubkaProcessor);
  }
  if (typeof globalThis !== 'undefined') globalThis.LubkaEngine = Engine;
})();
