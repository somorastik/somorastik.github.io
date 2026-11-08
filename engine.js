'use strict';
/* Squelchbox — Web Audio synthesis engine. Works with AudioContext and OfflineAudioContext. */

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

const _curveCache = new Map();
function driveCurve(amount) {
  const key = Math.round(amount * 200);
  if (_curveCache.has(key)) return _curveCache.get(key);
  const n = 2048, c = new Float32Array(n);
  const k = 1 + (key / 200) * 40;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  _curveCache.set(key, c);
  return c;
}

class Engine {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    const c = ctx;

    // shared white noise (3 s) for hats and kick click
    const len = Math.floor(c.sampleRate * 3);
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // master
    this.out = c.createGain();
    this.out.gain.value = 0.62;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;
    this.out.connect(this.comp);
    this.comp.connect(c.destination);
    if (opts.analyser) {
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 2048;
      this.comp.connect(this.analyser);
    }

    /* ---- FX graph ----
       tracks -> bus -> overdrive (dry/wet) -> out
       tracks -> per-track sends -> delay / reverb -> returns -> out   (sends are post-fader, so mute silences them) */
    this.bus = c.createGain();

    // overdrive: parallel dry / saturated path on the summed tracks
    this.odDry = c.createGain();
    this.odShaper = c.createWaveShaper();
    this.odShaper.oversample = '4x';
    this.odTone = c.createBiquadFilter();
    this.odTone.type = 'lowpass';
    this.odTone.Q.value = 0.5;
    this.odLow = c.createBiquadFilter();       // keeps the low end tight instead of farting out
    this.odLow.type = 'highpass';
    this.odLow.frequency.value = 35;
    this.odWet = c.createGain();
    this.odWet.gain.value = 0;
    this.bus.connect(this.odDry).connect(this.out);
    this.bus.connect(this.odLow).connect(this.odShaper).connect(this.odTone).connect(this.odWet).connect(this.out);

    // delay: two lines in a loop, panned apart, so echoes alternate L/R by `spread`
    this.dlIn = c.createGain();
    const dlHp = c.createBiquadFilter();
    dlHp.type = 'highpass';
    dlHp.frequency.value = 120;
    this.dlA = c.createDelay(3);
    this.dlB = c.createDelay(3);
    this.dlToneA = c.createBiquadFilter();
    this.dlToneB = c.createBiquadFilter();
    this.dlToneA.type = this.dlToneB.type = 'lowpass';
    this.dlFbA = c.createGain();
    this.dlFbB = c.createGain();
    this.dlPanA = c.createStereoPanner();
    this.dlPanB = c.createStereoPanner();
    this.dlRet = c.createGain();
    this.dlIn.connect(dlHp).connect(this.dlA);
    this.dlA.connect(this.dlToneA);
    this.dlToneA.connect(this.dlPanA).connect(this.dlRet);
    this.dlToneA.connect(this.dlFbA).connect(this.dlB);
    this.dlB.connect(this.dlToneB);
    this.dlToneB.connect(this.dlPanB).connect(this.dlRet);
    this.dlToneB.connect(this.dlFbB).connect(this.dlA);
    this.dlRet.connect(this.out);

    // reverb: high-passed send -> pre-delay -> convolver (generated impulse) -> damping -> return
    this.rvIn = c.createGain();
    const rvHp = c.createBiquadFilter();
    rvHp.type = 'highpass';
    rvHp.frequency.value = 180;
    this.rvPre = c.createDelay(0.5);
    this.rvDamp = c.createBiquadFilter();
    this.rvDamp.type = 'lowpass';
    this.rvRet = c.createGain();
    this.rvIn.connect(rvHp).connect(this.rvPre);
    this.rvDamp.connect(this.rvRet).connect(this.out);
    this.rv = null;          // current { conv, gain }; a new convolver is cross-faded in when Size changes
    this.irLen = 0;
    this.irTimer = null;

    this._last = new Map();  // last value sent to each AudioParam / shaper, so unchanged ones are skipped

    // channel strips + sends
    this.ch = {};
    this.dlSend = {};
    this.rvSend = {};
    for (const t of TRACKS) {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.bus);
      this.ch[t] = g;
      this.dlSend[t] = c.createGain();
      this.rvSend[t] = c.createGain();
      g.connect(this.dlSend[t]).connect(this.dlIn);
      g.connect(this.rvSend[t]).connect(this.rvIn);
    }

    this.kickShaper = c.createWaveShaper();
    this.kickShaper.oversample = '2x';
    this.kickShaper.connect(this.ch.kick);

    this.bassShaper = c.createWaveShaper();
    this.bassShaper.oversample = '2x';
    this.bassShaper.connect(this.ch.bass);

    // acid voice: one persistent oscillator -> 2 lowpass stages -> VCA -> grit
    this.acidOsc = c.createOscillator();
    this.acidOsc.type = 'sawtooth';
    this.acidOsc.frequency.value = 110;
    this.acidF1 = c.createBiquadFilter();
    this.acidF2 = c.createBiquadFilter();
    this.acidF1.type = this.acidF2.type = 'lowpass';
    this.acidF2.Q.value = 0;
    this.acidVca = c.createGain();
    this.acidVca.gain.value = 0;
    this.acidShaper = c.createWaveShaper();
    this.acidShaper.oversample = '4x';
    this.acidOsc.connect(this.acidF1);
    this.acidF1.connect(this.acidF2);
    this.acidF2.connect(this.acidVca);
    this.acidVca.connect(this.acidShaper);
    this.acidShaper.connect(this.ch.acid);
    this.acidOsc.start(0);
    this.acidTie = false;

    this.openHat = null;
  }

  /* Send a value to an AudioParam — only if it changed, and with the param's automation list cleared first,
     so dragging a knob never piles up thousands of scheduled events (heavy for Firefox's audio thread). */
  _set(param, v, immediate) {
    if (!isFinite(v)) return;
    if (this._last.get(param) === v) return;
    this._last.set(param, v);
    const now = this.ctx.currentTime;
    if (immediate) { param.setValueAtTime(v, now); return; }
    param.cancelScheduledValues(now);
    param.setTargetAtTime(v, now, 0.015);
  }

  _curve(shaper, amount) {
    const key = Math.round(amount * 200);
    if (this._last.get(shaper) === key) return;
    this._last.set(shaper, key);
    shaper.curve = driveCurve(amount);
  }

  /* Push the current state's continuous parameters into the graph. */
  apply(state, immediate = false) {
    this.state = state;
    this.p = state.params;
    const P = state.params;
    for (const t of TRACKS) {
      const lvl = trackAudible(state, t) ? P[t].level * P[t].level * 1.3 : 0;
      this._set(this.ch[t].gain, lvl, immediate);
    }
    this._curve(this.kickShaper, P.kick.drive * 0.6);
    this._curve(this.bassShaper, P.bass.drive * 0.7);
    this._curve(this.acidShaper, P.acid.grit);
    if (this.acidOsc.type !== P.acid.wave) this.acidOsc.type = P.acid.wave;
    this._set(this.acidF1.Q, P.acid.reso * 24, immediate);

    // overdrive
    const od = P.drive, odOn = state.fxOn.drive;
    this._curve(this.odShaper, od.amount * 0.75);
    this._set(this.odTone.frequency, 700 * Math.pow(2, od.tone * 4.7), immediate);
    const wet = odOn ? od.mix : 0;
    this._set(this.odWet.gain, wet / (1 + od.amount * 1.3), immediate);   // rough loudness match
    this._set(this.odDry.gain, 1 - wet, immediate);

    // delay — switching off closes the input so the echoes ring out
    const dl = P.delay;
    const dt = Math.min(2.9, (60 / state.bpm) * DELAY_TIMES[dl.time]);
    this._set(this.dlA.delayTime, dt, immediate);
    this._set(this.dlB.delayTime, dt, immediate);
    this._set(this.dlFbA.gain, dl.feedback * 0.85, immediate);
    this._set(this.dlFbB.gain, dl.feedback * 0.85, immediate);
    const dlf = Math.min(18000, 400 * Math.pow(2, dl.tone * 5.5));
    this._set(this.dlToneA.frequency, dlf, immediate);
    this._set(this.dlToneB.frequency, dlf, immediate);
    this._set(this.dlPanA.pan, -dl.spread, immediate);
    this._set(this.dlPanB.pan, dl.spread, immediate);
    this._set(this.dlRet.gain, dl.level, immediate);
    this._set(this.dlIn.gain, state.fxOn.delay ? 1 : 0, immediate);

    // reverb
    const rv = P.reverb;
    this._set(this.rvPre.delayTime, rv.predelay * 0.2, immediate);
    this._set(this.rvDamp.frequency, 18000 * Math.pow(2, -rv.damp * 5), immediate);
    this._set(this.rvRet.gain, rv.level * 1.1, immediate);
    this._set(this.rvIn.gain, state.fxOn.reverb ? 1 : 0, immediate);
    const len = 0.4 + rv.size * 3.6;
    if (Math.abs(len - this.irLen) > 0.02 || !this.rv) {
      clearTimeout(this.irTimer);
      if (immediate || !this.rv) this._buildIR(len, false);
      else this.irTimer = setTimeout(() => this._buildIR(len, true), 350);   // only once the knob settles
    }

    for (const t of TRACKS) {
      this._set(this.dlSend[t].gain, dl[t], immediate);
      this._set(this.rvSend[t].gain, rv[t], immediate);
    }
  }

  /* Stereo impulse: decorrelated noise with an exponential decay that also darkens over time. */
  _buildIR(seconds, fade) {
    const c = this.ctx, sr = c.sampleRate;
    const n = Math.floor(seconds * sr);
    const buf = c.createBuffer(2, n, sr);
    const fadeIn = Math.floor(0.004 * sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.exp(-6.9 * t) * (i < fadeIn ? i / fadeIn : 1);   // -60 dB at the end
        const a = 0.9 - 0.75 * t;                                          // one-pole lowpass closing over the tail
        lp += a * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * env;
      }
    }
    // Never re-assign a live convolver's buffer: make a new one and cross-fade, then drop the old one.
    const conv = c.createConvolver();
    conv.buffer = buf;
    const g = c.createGain();
    this.rvPre.connect(conv);
    conv.connect(g).connect(this.rvDamp);
    const old = this.rv;
    const now = c.currentTime;
    if (fade && old) {
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + 0.3);
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 0.3);
      setTimeout(() => { try { this.rvPre.disconnect(old.conv); old.conv.disconnect(); old.gain.disconnect(); } catch (e) { /* already gone */ } }, 600);
    } else {
      g.gain.value = 1;
      if (old) { try { this.rvPre.disconnect(old.conv); old.conv.disconnect(); old.gain.disconnect(); } catch (e) { /* ignore */ } }
    }
    this.rv = { conv, gain: g };
    this.irLen = seconds;
  }

  /* Schedule everything for one step of a bank at `time`. */
  playStep(bank, i, time, stepDur) {
    const k = bank.kick[i];
    if (k) this.kick(time, k === 2 ? 1 : 0.72);
    const h = bank.hats[i];
    if (h) this.hat(time, h);
    const b = bank.bass[i];
    if (b.on) this.bass(time, b);
    this.acid(bank, i, time, stepDur);
  }

  kick(time, vel) {
    const c = this.ctx, P = this.p.kick;
    const o = c.createOscillator(), g = c.createGain();
    const base = 40 + P.tune * 35;
    const start = base * (2.5 + P.punch * 6);
    o.frequency.setValueAtTime(start, time);
    o.frequency.exponentialRampToValueAtTime(base, time + 0.025 + (1 - P.punch) * 0.035);
    const dec = 0.12 + P.decay * 0.8;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vel, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dec);
    o.connect(g).connect(this.kickShaper);
    o.start(time);
    o.stop(time + dec + 0.05);

    if (P.punch > 0.05) {
      const n = c.createBufferSource();
      n.buffer = this.noiseBuf;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const ng = c.createGain();
      ng.gain.setValueAtTime(P.punch * 0.45 * vel, time);
      ng.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
      n.connect(hp).connect(ng).connect(this.kickShaper);
      n.start(time, Math.random() * 2);
      n.stop(time + 0.02);
    }
  }

  hat(time, type) {
    const c = this.ctx, P = this.p.hats;
    // any new hat chokes a ringing open hat
    if (this.openHat) {
      this.openHat.gain.setTargetAtTime(0, time, 0.004);
      this.openHat = null;
    }
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000 + P.tone * 6000;
    const pk = c.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 8000 + P.tone * 4000;
    pk.gain.value = 6;
    pk.Q.value = 1;
    const env = c.createGain();
    const choke = c.createGain();
    const open = type === 2;
    const dec = open ? 0.08 + P.open * 0.6 : 0.015 + P.decay * 0.1;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(open ? 0.5 : 0.6, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, time + dec);
    src.connect(hp).connect(pk).connect(env).connect(choke).connect(this.ch.hats);
    src.start(time, Math.random() * 2);
    src.stop(time + dec + 0.05);
    if (open) this.openHat = choke;
  }

  bass(time, b) {
    const c = this.ctx, P = this.p.bass;
    const f = midiHz(24 + this.state.key + b.note + 12 * b.oct);
    const o = c.createOscillator();
    o.type = P.wave;
    o.frequency.setValueAtTime(f, time);
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f, time);
    const subG = c.createGain();
    subG.gain.value = P.wave === 'sine' ? 0 : 0.6;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    const cut = 60 * Math.pow(2, P.cutoff * 7);
    lp.frequency.setValueAtTime(Math.min(cut * 3, 16000), time);
    lp.frequency.setTargetAtTime(cut, time, 0.04);
    const g = c.createGain();
    const dec = 0.06 + P.decay * 0.6;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.75, time + 0.005);
    g.gain.setTargetAtTime(0, time + 0.01, dec / 3);
    o.connect(lp);
    sub.connect(subG).connect(lp);
    lp.connect(g).connect(this.bassShaper);
    const end = time + dec * 2 + 0.1;
    o.start(time); sub.start(time);
    o.stop(end); sub.stop(end);
  }

  acid(bank, i, time, dur) {
    const s = bank.acid[i];
    const next = bank.acid[(i + 1) % STEPS];
    const P = this.p.acid;
    const vca = this.acidVca.gain;

    if (!s.on) {
      if (this.acidTie) vca.setTargetAtTime(0, time, 0.012);
      this.acidTie = false;
      return;
    }

    const tie = this.acidTie;
    const f = midiHz(36 + this.state.key + s.note + 12 * s.oct);
    const acc = s.acc ? P.accent : 0;

    if (tie) {
      // slide: glide pitch, keep the gate and the filter envelope running
      this.acidOsc.frequency.setTargetAtTime(f, time, 0.022);
      vca.setTargetAtTime(0.32 * (1 + acc * 1.1), time, 0.01);
    } else {
      this.acidOsc.frequency.setValueAtTime(f, time);
      const nyq = this.ctx.sampleRate / 2 - 500;
      const base = 40 * Math.pow(2, P.cutoff * 8.3);
      const peak = Math.min(base * Math.pow(2, P.envmod * 5 + acc * 1.5), 18000, nyq);
      const tau = (0.02 + P.decay * 0.45) * (s.acc ? 0.6 : 1);
      for (const fl of [this.acidF1, this.acidF2]) {
        fl.frequency.cancelScheduledValues(time);
        fl.frequency.setValueAtTime(peak, time);
        fl.frequency.setTargetAtTime(Math.min(base, nyq), time + 0.002, tau);
      }
      vca.cancelScheduledValues(time);
      vca.setTargetAtTime(0.32 * (1 + acc * 1.1), time, 0.002);
    }

    const hold = s.slide && next.on;
    if (!hold) vca.setTargetAtTime(0, time + dur * 0.55, 0.012);
    this.acidTie = hold;
  }

  /* Silence any sustained voices (used on stop). */
  panic() {
    const t = this.ctx.currentTime;
    this.acidVca.gain.cancelScheduledValues(t);
    this.acidVca.gain.setTargetAtTime(0, t, 0.01);
    this.acidTie = false;
    if (this.openHat) { this.openHat.gain.setTargetAtTime(0, t, 0.01); this.openHat = null; }
  }
}
