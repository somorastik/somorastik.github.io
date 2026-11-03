// Render-check mutated kits against their originals and tame voices that went silent or much louder.
// usage: node check_mutations.js <data_dir>
// Reads data/banks.json (originals, not in git) and data/banks-mutated.json; rewrites the latter.
// For a flagged voice, its parameter drift is halved (up to three times); discrete choices such as
// waveform or filter type go back to the original first. If it still fails, that voice is restored.
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'src', 'engine.js'));
const E = globalThis.LubkaEngine;
const D = process.argv[2];
const meta = JSON.parse(fs.readFileSync(path.join(D, 'meta.json')));
const tj = JSON.parse(fs.readFileSync(path.join(D, 'tables.json')));
const i16 = (b) => { const x = Buffer.from(b, 'base64'); return new Int16Array(x.buffer, x.byteOffset, x.length / 2); };
const i8 = (b) => { const x = Buffer.from(b, 'base64'); return new Int8Array(x.buffer, x.byteOffset, x.length); };
const init = { tables: { sine: i16(tj.sine), saw: i16(tj.saw), tri: i16(tj.tri), rec: i16(tj.rec), trans: i8(tj.trans), notes: tj.notes, ecc83: tj.ecc83, diode: tj.diode }, P: meta.P, END: meta.END, modTargetParams: meta.modTargets.map((m) => m[1]) };
const orig = {}; for (const b of JSON.parse(fs.readFileSync(path.join(D, 'banks.json')))) orig[b.label] = b;
const file = path.join(D, 'banks-mutated.json');
const mut = JSON.parse(fs.readFileSync(file));

// parameter -> voice, from the menu page groups (7 track groups of 8 pages; both hat tracks are voice 5)
const voiceParams = [[], [], [], [], [], []];
meta.pages.slice(0, 56).forEach((pg, i) => { const v = Math.min(5, Math.floor(i / 8)); for (const e of pg) if (e[1] > 0 && e[1] < meta.END && !voiceParams[v].includes(e[1])) voiceParams[v].push(e[1]); });
const isMenu = (p) => meta.params[p] && meta.params[p].t === 'DTYPE_MENU';
const TRACKS = [[0], [1], [2], [3], [4], [5, 6]];

function peak(p, track) {
  let m = 0;
  for (let rep = 0; rep < 2; rep++) { // noise and LFOs are random, so take the louder of two runs
    const e = new E(44100, init); e.loadKit(p); e.trigger(track, 127, 60);
    const N = 26460, L = new Float32Array(N), R = new Float32Array(N);
    for (let o = 0; o < N; o += 128) e.process(L.subarray(o), R.subarray(o), 128);
    for (let i = 0; i < N; i++) { const a = Math.abs(L[i]) + Math.abs(R[i]); if (a > m) m = a; }
  }
  return m;
}
const ok = (mv, ov) => !(ov > 0.02 && mv < ov * 0.3) && !(mv > ov * 2.5 && mv > 0.3);

let fixed = 0, restored = 0, checked = 0;
const fk = orig['Factory kits'].kits;
for (const b of mut) {
  const ob = orig[b.label.replace(' · mutated', '')];
  for (const k of b.kits) {
    const src = (ob && ob.kits.find((x) => x.name + ' mx' === k.name)) || fk.find((x) => x.name + ' mx' === k.name);
    const o = [...Buffer.from(src.p, 'base64')];
    let m = [...Buffer.from(k.p, 'base64')];
    checked++;
    for (let v = 0; v < 6; v++) {
      const good = () => TRACKS[v].every((t) => ok(peak(m, t), peak(o, t)));
      if (good()) continue;
      let pass = false;
      for (let tries = 0; tries < 3 && !pass; tries++) {
        for (const p of voiceParams[v]) m[p] = isMenu(p) ? o[p] : Math.round(o[p] + (m[p] - o[p]) / 2);
        pass = good();
      }
      if (pass) fixed++; else { for (const p of voiceParams[v]) m[p] = o[p]; restored++; }
      console.log(`${b.label} | ${k.name} | voice ${v}: ${pass ? 'drift reduced' : 'restored to original'}`);
    }
    k.p = Buffer.from(m).toString('base64');
  }
}
fs.writeFileSync(file, JSON.stringify(mut));
console.log(`kits checked ${checked}, voices toned down ${fixed}, voices restored ${restored}`);
