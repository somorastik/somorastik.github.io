#!/usr/bin/env python3
"""Seeded mutations of .SND kits and .PAT patterns for LubkaM1.

Reads a decoded bank file (data/banks.json from extract.py, kept out of git) and writes
data/banks-mutated.json with mutated copies. The same seed always gives the same result.

usage: mutate.py <data_dir> [--seed N]

Kits: continuous parameters drift around their original values (timbre, tuning, envelopes,
filters, LFO and FX settings); a few discrete choices (waveforms, filter type, click sample,
LFO shape) occasionally flip. Levels, panning, output routing and modulation targets stay put,
so a mutated kit keeps its mix and character.

Patterns: a share of steps move, appear or drop out (more likely off the main beats),
velocities and probabilities wander, and the odd flam or micro-shift is added. Track lengths,
automation and the linked kit slot are kept.
"""
import base64, json, os, random, sys

D = sys.argv[1]
SEED = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261103
meta = json.load(open(os.path.join(D, "meta.json")))
P, END, PARAMS, MENUS = meta["P"], meta["END"], meta["params"], meta["menus"]
NAME = {}
for k, v in P.items():
    NAME.setdefault(v, k)
for i, p in enumerate(PARAMS):
    if p:
        NAME[i] = p["n"]
src = {b["label"]: b for b in json.load(open(os.path.join(D, "banks.json")))}

# never touched: mix, routing, modulation wiring, global and FX structure
KEEP_PREFIX = ("PAR_VOL", "PAR_PAN", "PAR_AUDIO_OUT", "PAR_VOICE_LFO", "PAR_TARGET_LFO", "PAR_VEL_DEST",
               "PAR_FX_TYPE", "PAR_FX_ROUTING", "PAR_FX_DIST_TYPE", "PAR_FX_DELAY_TYPE", "PAR_FX_REVERB_TYPE",
               "PAR_FX_RATIO", "PAR_MIX_MOD", "PAR_VOLUME_MOD", "PAR_SYNC_LFO", "PAR_RETRIGGER_LFO", "PAR_MORPH",
               "PAR_UNUSED", "PAR_NONE", "PAR_NRPN", "PAR_BANK_CHANGE", "PAR_MOD_WHEEL", "PAR_REPEAT")
KEEP_EXACT = {"PAR_VOLUME_MOD_ON_OFF1"}
# per-parameter drift (standard deviation in 0..127 units)
SIGMA = [
    ("PAR_COARSE", 2.0), ("PAR_FINE", 6), ("PAR_FM_FREQ", 3), ("PAR_MOD_OSC_F", 3),
    ("PAR_VOICE_DECIMATION", 3), ("PAR_FX_DRY_WET", 4), ("PAR_FX_P", 8),
    ("PAR_FILTER_FREQ", 9), ("PAR_RESO", 8), ("PAR_FILTER_DRIVE", 8), ("PAR_DRIVE", 6),
    ("PAR_SNARE_DISTORTION", 6), ("PAR_CYMBAL_DISTORTION", 6), ("PAR_HAT_DISTORTION", 6),
    ("PAR_VELO", 8), ("PAR_VOL_SLOPE", 9), ("PAR_MOD_EG", 9), ("PAR_MODAMNT", 7), ("PAR_PITCH_SLOPE", 9),
    ("PAR_FMAMNT", 9), ("PAR_MOD_OSC_GAIN", 9), ("PAR_NOISE_FREQ", 7), ("PAR_MIX1", 8),
    ("PAR_TRANS", 9), ("PAR_FREQ_LFO", 8), ("PAR_AMOUNT_LFO", 6), ("PAR_OFFSET_LFO", 10),
    ("PAR_VELO_MOD_AMT", 6), ("PAR_PWM", 10),
]
FLIP = {"MENU_WAVEFORM": 0.12, "MENU_FILTER": 0.07, "MENU_TRANS": 0.15, "MENU_LFO_WAVES": 0.15}
MENU_RANGE = {"MENU_WAVEFORM": 6, "MENU_FILTER": 7, "MENU_TRANS": 14, "MENU_LFO_WAVES": 8}


def sigma_for(name):
    for pre, s in SIGMA:
        if name.startswith(pre):
            return s
    return None


def mutate_kit(p, rng):
    out = list(p)
    for i in range(1, END):
        name = NAME.get(i, "")
        if not name or name.startswith(KEEP_PREFIX) or name in KEEP_EXACT:
            continue
        d = PARAMS[i] if i < len(PARAMS) else None
        if d and d["t"] == "DTYPE_MENU":
            m = d["menu"]
            if m in FLIP and rng.random() < FLIP[m]:
                n = MENU_RANGE[m]
                # filter type: avoid "off" (7) so a voice never goes silent
                choices = [v for v in range(n) if v != out[i]]
                out[i] = rng.choice(choices)
            continue
        if d and d["t"] not in ("DTYPE_0B127", "DTYPE_PM63", "DTYPE_0B100"):
            continue
        s = sigma_for(name)
        if s is None or rng.random() > 0.6:
            continue
        hi = 100 if d and d["t"] == "DTYPE_0B100" else 127
        v = out[i]
        # decimation: a full-rate voice stays mostly full rate
        if name.startswith("PAR_VOICE_DECIMATION") and v >= 120:
            continue
        nv = int(round(v + rng.gauss(0, s)))
        out[i] = max(0, min(hi, nv))
    return out


def mutate_pattern(pat, rng):
    out = {"shuffle": pat["shuffle"], "kit": pat["kit"], "tracks": []}
    if rng.random() < 0.3:
        out["shuffle"] = max(0, min(127, pat["shuffle"] + rng.choice([-12, 12, 20])))
    for t, tr in enumerate(pat["tracks"]):
        L = tr["len"] if 0 < tr["len"] <= 64 else 16
        steps = {s[0]: list(s) for s in tr["s"] if s[0] < L}
        if steps:
            vel0 = sorted(s[1] for s in steps.values())[len(steps) // 2]
            for i in range(L):
                on_beat = i % 4 == 0
                if i in steps:
                    # drop or nudge an existing hit (main beats are kept on the kick track)
                    if not (on_beat and t == 0) and rng.random() < (0.06 if on_beat else 0.14):
                        s = steps.pop(i)
                        if rng.random() < 0.5:
                            j = (i + rng.choice([-1, 1])) % L
                            if j not in steps:
                                s[0] = j
                                steps[j] = s
                        continue
                    s = steps[i]
                    s[1] = max(20, min(127, s[1] + int(rng.gauss(0, 14))))
                    if rng.random() < 0.05:
                        s[2] = rng.choice([50, 65, 80])
                    if rng.random() < 0.04 and t in (1, 2, 3, 5):
                        s[4] = (s[4] & 0xF0) | rng.choice([1, 2, 3])
                elif rng.random() < (0.03 if on_beat else 0.07):
                    vel = max(30, min(127, int(vel0 * rng.uniform(0.45, 0.85))))
                    prob = 100 if rng.random() < 0.7 else rng.choice([50, 70])
                    shift = 7 if rng.random() < 0.8 else rng.choice([6, 8, 9])
                    steps[i] = [i, vel, prob, 60, (shift << 4), 255, 0, 255, 0]
        out["tracks"].append({"len": tr["len"], "s": [steps[k] for k in sorted(steps)]})
    return out


def short(name, tag):
    base = name.strip()
    return f"{base} {tag}"


rng = random.Random(SEED)
banks = []

# 1) a spread of 16 kits from the factory library
fk = src["Factory kits"]["kits"]
pick = [fk[round(i * (len(fk) - 1) / 15)] for i in range(16)]
banks.append({
    "label": "Factory kits · mutated",
    "credit": "Mutated from the factory kit library",
    "kits": [{"slot": i, "name": short(k["name"], "mx"),
              "p": base64.b64encode(bytes(mutate_kit(list(base64.b64decode(k["p"])), rng))).decode()} for i, k in enumerate(pick)],
    "pats": [],
})

# 2) factory demo projects and both third-party packs, kits and patterns, slots kept
for label, credit in [("Factory demo 4", "Mutated from a factory demo project"),
                      ("Factory demo 5", "Mutated from a factory demo project"),
                      ("Club pack", "Mutated from a third-party kit pack"),
                      ("Expansion pack", "Mutated from a third-party kit pack")]:
    b = src[label]
    banks.append({
        "label": label + " · mutated",
        "credit": credit,
        "kits": [{"slot": k["slot"], "name": short(k["name"], "mx"),
                  "p": base64.b64encode(bytes(mutate_kit(list(base64.b64decode(k["p"])), rng))).decode()} for k in b["kits"]],
        "pats": [dict(slot=p["slot"], **mutate_pattern(p, rng)) for p in b["pats"]],
    })

json.dump(banks, open(os.path.join(D, "banks-mutated.json"), "w"), separators=(",", ":"))
for b in banks:
    print(f'{b["label"]}: {len(b["kits"])} kits, {len(b["pats"])} patterns')
print("seed", SEED)
