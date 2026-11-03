# LubkaM1

LubkaM1 is a six-voice digital drum synthesizer that runs in the browser. I built it as an academic study of how a hardware drum synth works, from oscillators and envelopes to the step sequencer.

**Play it:** https://somorastik.github.io/lubkam1/

The sound engine is a JavaScript port of open-source drum-synth firmware. LubkaM1 can open kit (`.SND`) and pattern (`.PAT`) files from your computer. It ships with three original starter kits and four demo patterns, plus 71 mutated kits and 57 mutated patterns derived from factory content and two third-party kit packs.

## What it does

- **Voices:** three two-oscillator drums with FM or mix mode, a pitch envelope, a click transient, a zero-delay-feedback filter and drive. A snare made of a tuned oscillator plus filtered noise. A three-oscillator FM cymbal, and hats with closed and open decays.
- **Modulation:** six LFOs and six velocity modulators, each with an assignable target. A sample-rate reducer per voice.
- **FX bus:** tube, wavefolder or diode-clipper distortion, ring modulator, compressor, and mono or ping-pong delay.
- **Sequencer:** 7 tracks × 64 steps, with velocity, probability, flam (×2 to ×8), micro-shift, two parameter automations per step, per-track lengths, swing, and queued pattern changes.
- **Kit morph:** blends the current kit toward a second kit.

Envelopes, LFOs and modulation update once per 64-sample block, as in the firmware. The audio path uses a signed 16-bit scale with saturating adds. The engine runs in an AudioWorklet at 44.1 kHz; if the worklet can't load, the page falls back to running the engine on the main thread.

## Repository layout

| Path | Contents |
|---|---|
| `index.html`, `engine.js` | The built page, served at somorastik.github.io/lubkam1/ |
| `src/engine.js` | Sound engine and sequencer (AudioWorklet processor) |
| `src/app.js`, `src/page.html` | Front panel UI and page template |
| `data/meta.json`, `data/tables.json` | Parameter table, menu layout and DSP tables extracted from the firmware source |
| `data/banks-public.json` | The original starter kits and demo patterns |
| `data/banks-mutated.json` | Mutated kits and patterns (see below) |
| `tools/extract.py` | Extracts `meta.json` and `tables.json` from the firmware source, and decodes kits and patterns from an SD-card folder |
| `tools/starter.py` | Defines the starter kits and patterns |
| `tools/mutate.py` | Makes seeded mutations of kits and patterns |
| `tools/check_mutations.js` | Renders mutated kits against their originals and tames voices that went silent or much louder |
| `tools/build.py` | Inlines the data, engine and UI into one page |

## Building

```sh
python3 tools/starter.py data
python3 tools/build.py . . --public --repo https://github.com/somorastik/somorastik.github.io/tree/lubkam1
```

To rebuild `data/meta.json` and `data/tables.json` from the firmware:

```sh
python3 tools/extract.py <firmware-source-folder> <folder-with-your-SD-card-files> data
```

`extract.py` also writes `data/banks.json` from your own SD-card files. A build without `--public` embeds that file. It is listed in `.gitignore`, so your own kits are never committed.

## Mutated banks

The five “mutated” projects are variations of existing kits and patterns:

| Project | Derived from |
|---|---|
| Factory kits · mutated | 16 kits spread across the factory kit library |
| Factory demo 4 · mutated, Factory demo 5 · mutated | Two factory demo projects, kits and patterns |
| Club pack · mutated | A third-party kit pack, kits and patterns |
| Expansion pack · mutated | A second third-party kit pack, kits and patterns |

Kits keep their levels, panning, routing and modulation wiring. Tuning, envelopes, filters, FM, click, LFO and FX settings drift around the original values, and waveforms, filter types, click samples and LFO shapes occasionally change. Every mutated voice is rendered against its original; a voice that went near-silent or much louder has its drift halved, or is restored. Patterns gain, lose or move a share of steps (the kick's main beats stay), and velocities, probabilities, flams and swing vary. Kit names carry an “mx” suffix.

The original kits and patterns are not in this repository. The mutations are published with permission from the rights holders.

To regenerate them from your own SD-card files (same seed, same result):

```sh
python3 tools/extract.py <firmware-source-folder> <folder-with-your-SD-card-files> data
python3 tools/mutate.py data --seed 20261103
node tools/check_mutations.js data
```

## Licence

LubkaM1 is free software, licensed under the GNU General Public License version 3 only (GPL-3.0-only); see [LICENSE](LICENSE). It comes with no warranty.

The sound engine, sequencer and extracted tables are a modified port of GPL-3.0-only drum-synth firmware. Its copyright notice is kept in `src/engine.js`, and its notice with additional licence terms is in [NOTICE-upstream.md](NOTICE-upstream.md), as the licence requires.

LubkaM1 is an independent academic project. The starter kits begin from the firmware's GPL-licensed init kit, and their demo patterns are original. The mutated banks are published with the rights holders' permission; the GPL covers the code, not that sound content.
