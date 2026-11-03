// Offline render of LubkaM1 engine for verification.
// usage: node render_test.js <dataDir> <outDir>
const fs = require('fs');
const path = require('path');
const [dataDir, outDir] = process.argv.slice(2);
require(path.join(__dirname, '..', 'src', 'engine.js'));
const Engine = globalThis.LubkaEngine;

const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json')));
const tj = JSON.parse(fs.readFileSync(path.join(dataDir, 'tables.json')));
const banks = JSON.parse(fs.readFileSync(path.join(dataDir, 'banks.json')));
const i16 = (b) => { const buf = Buffer.from(b, 'base64'); return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2); };
const i8 = (b) => { const buf = Buffer.from(b, 'base64'); return new Int8Array(buf.buffer, buf.byteOffset, buf.length); };
const tables = { sine: i16(tj.sine), saw: i16(tj.saw), tri: i16(tj.tri), rec: i16(tj.rec), trans: i8(tj.trans), notes: tj.notes, ecc83: tj.ecc83, diode: tj.diode };
const init = { tables, P: meta.P, END: meta.END, modTargetParams: meta.modTargets.map((m) => m[1]) };
const kitBytes = (k) => Array.from(Buffer.from(k.p, 'base64'));
function patToEngine(p) {
  const steps = [], len = [];
  for (let t = 0; t < 7; t++) {
    const arr = [];
    for (let i = 0; i < 64; i++) arr.push([0, 100, 100, 63, 0, 7, 255, 0, 255, 0]);
    for (const s of p.tracks[t].s) arr[s[0]] = [1, s[1], s[2], s[3], s[4] & 15, s[4] >> 4, s[5], s[6], s[7], s[8]];
    steps.push(arr); len.push(p.tracks[t].len || 16);
  }
  return { steps, len };
}
function wav(file, L, R, fsr) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(fsr, 24);
  b.writeUInt32LE(fsr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4); b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4); }
  fs.writeFileSync(file, b);
}
function stats(L, R) {
  let pk = 0, ss = 0, nan = 0, clip = 0;
  for (let i = 0; i < L.length; i++) { for (const x of [L[i], R[i]]) { if (x !== x) nan++; const a = Math.abs(x); if (a > pk) pk = a; ss += x * x; if (a > 0.799) clip++; } }
  return { peak: +pk.toFixed(3), rms: +Math.sqrt(ss / (2 * L.length)).toFixed(4), nan, nearFull: clip };
}
const FS = 44100;
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
let totalFrames = 0;

// 1) single hits per voice for a few kits
const hitKits = [['Factory kits', 'Badonka'], ['Factory kits', '8-bit'], ['Club pack', 'Stove'], ['Expansion pack', 'Lambo']];
for (const [bl, kn] of hitKits) {
  const bank = banks.find((b) => b.label === bl), kit = bank.kits.find((k) => k.name === kn);
  const e = new Engine(FS, init); e.loadKit(kitBytes(kit));
  const secs = 0.5, N = Math.round(FS * secs) * 7;
  const L = new Float32Array(N + 128), R = new Float32Array(N + 128);
  const per = [];
  for (let t = 0; t < 7; t++) {
    e.trigger(t, 127, 63);
    const off = Math.round(FS * secs) * t;
    for (let o = 0; o < Math.round(FS * secs); o += 128) e.process(L.subarray(off + o), R.subarray(off + o), 128);
    per.push(stats(L.subarray(off, off + Math.round(FS * secs)), R.subarray(off, off + Math.round(FS * secs))).peak);
  }
  totalFrames += N;
  wav(path.join(outDir, `hits_${kn}.wav`), L, R, FS);
  console.log('hits', kn, 'peak per track', per.join(' '), stats(L, R));
}

// 2) demo patterns with their kits
const demos = [['Club pack', 0], ['Expansion pack', 1], ['Factory demo 4', 0], ['Factory demo 5', 0], ['Factory demo 1', 3]];
for (const [bl, pi] of demos) {
  const bank = banks.find((b) => b.label === bl), pat = bank.pats[pi];
  const kit = bank.kits.find((k) => k.slot === pat.kit) || bank.kits[0];
  const e = new Engine(FS, init); e.loadKit(kitBytes(kit)); e.setBpm(124);
  e.handle({ t: 'pattern', pat: patToEngine(pat), shuffle: pat.shuffle / 127 });
  e.play();
  const N = FS * 8, L = new Float32Array(N), R = new Float32Array(N);
  let trig = 0;
  for (let o = 0; o < N; o += 128) { e.process(L.subarray(o), R.subarray(o), 128); trig += e.events.filter((x) => x.t === 'trig').length; e.events.length = 0; }
  totalFrames += N;
  const name = `${bl.replace(/\s+/g, '_')}_p${pi + 1}_${kit.name}`;
  wav(path.join(outDir, name + '.wav'), L, R, FS);
  console.log('pattern', name, 'fx', kit && Buffer.from(kit.p, 'base64')[meta.P.PAR_FX_TYPE], 'triggers', trig, stats(L, R));
}
const dt = (Date.now() - t0) / 1000;
console.log('render speed x realtime:', (totalFrames / FS / dt).toFixed(1));
