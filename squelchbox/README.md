# Squelchbox

An acid groovebox in the browser: a 16-step sequencer with kick, hats, bass and a squelchy acid synth, plus overdrive, delay and reverb. A yellow-and-black smiley melts while the loop plays.

**Play it:** https://somorastik.github.io/squelchbox/

## What's in it

- **Kick, Hats, Bass, Acid**, each with presets, mute (M) and solo (S). Several tracks can be soloed; Alt-click or long-press S to solo just one.
- **Acid**: one monophonic saw/square voice through a resonant 24 dB low-pass with envelope, Grit, and per-step accent, slide and octave.
- **Patterns**: four banks (A–D) with Chain, copy / paste / clear, key and scale (the random generators stay in scale), swing, tempo 60–200. Tap a note while stopped to hear it.
- **FX**, each with its own on/off switch:
  - **Overdrive** on the whole mix, level-matched.
  - **Delay**: tempo-synced ping-pong.
  - **Reverb**: 0.4–4 s.
  - **Sends** from each track into the delay and reverb.
  - **Mutate**: Drift, which rewrites the acid line a little each bar.
- **Export WAV**: a seamless 4-bar loop (or the A→D chain), including the delay and reverb tails.
- **A watchdog** keeps playback running. If the audio stalls, is suspended or goes silent, it resumes or rebuilds the audio engine.
- **Saving**: everything is saved in your browser. The song format is shared with the Squelchbox Firefox add-on and the Android app.

**Controls**
- <kbd>Space</kbd> plays and stops, and <kbd>1</kbd>–<kbd>4</kbd> pick a bank.
- Drag knobs up or down; hold Shift for fine steps, and double-click to reset.
- On phones the steps show as two rows of 8, and a floating play button appears once the header scrolls away.

## Files

This branch holds the app itself; the site's `main` branch copies it into `squelchbox/` whenever this branch changes. Plain HTML, CSS and JavaScript with no build step and no dependencies.

| File | Contents |
|---|---|
| `index.html` | page |
| `app.css` | styles |
| `app.js` | UI, step clock, watchdog, storage, WAV export |
| `engine.js` | Web Audio synthesis and effects |
| `data.js` | parameters, presets, demo patterns, generators |
| `timer-worker.js` | step clock that keeps running in background tabs |
| `icons/` | melting-smiley logo (still and animated) |

Original design and code. It isn't based on any commercial instrument's code, artwork or sounds.
