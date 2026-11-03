#!/usr/bin/env python3
"""Original LubkaM1 starter kits and demo patterns (no third-party sound data).
Kits start from the firmware's init kit (GPL-3.0) and set parameters by name.
usage: starter.py <data_dir>   -> writes <data_dir>/banks-public.json
"""
import base64, json, os, sys

D = sys.argv[1]
meta = json.load(open(os.path.join(D, "meta.json")))
P, END = meta["P"], meta["END"]
init = json.load(open(os.path.join(D, "initkit.json")))
init = (init + [0] * END)[:END]

# names for menu values
WAVE = dict(sin=0, tri=1, saw=2, rec=3, noi=4, pwm=5)
FILT = dict(lp=0, hp=1, bp=2, ubp=3, notch=4, peak=5, lp2=6)
TRANS = dict(snp=0, ofs=1, clk=2, ck2=3, tik=4, kik=5, rim=6, drp=7, hat=8, clp=9, kk2=10, snr=11, tom=12, sp2=13)
OUT = dict(st1=0, st2=1, fx=6)

def kit(**kv):
    p = list(init)
    for k, v in kv.items():
        p[P["PAR_" + k]] = v
    return p

common = dict(FX_TYPE=0, FX_DRY_WET=0, FX_ROUTING=0)

lubka1 = kit(**common,
    # Drum 1: sine kick with a pitch sweep and a click
    OSC_WAVE_DRUM1=WAVE["sin"], COARSE1=28, FINE1=63, MOD_EG1=86, MODAMNT1=62, PITCH_SLOPE1=40,
    VELOA1=0, VELOD1=42, VOL_SLOPE1=34, TRANS1_WAVE=TRANS["clk"], TRANS1_VOL=30, TRANS1_FREQ=60,
    FILTER_TYPE_1=FILT["lp"], FILTER_FREQ_1=92, RESO_1=10, FILTER_DRIVE_1=20, DRIVE1=66, VOL1=118,
    # Drum 2: low tom
    OSC_WAVE_DRUM2=WAVE["sin"], COARSE2=43, MOD_EG2=80, MODAMNT2=34, PITCH_SLOPE2=50, VELOD2=30, VOL_SLOPE2=40,
    TRANS2_WAVE=TRANS["tom"], TRANS2_VOL=40, TRANS2_FREQ=50, FILTER_FREQ_2=120, DRIVE2=66, VOL2=100, PAN2=50,
    # Drum 3: wooden rim, FM
    OSC_WAVE_DRUM3=WAVE["tri"], MOD_WAVE_DRUM3=WAVE["sin"], COARSE3=72, FM_FREQ3=91, FMAMNT3=70, MIX_MOD_3=0,
    MOD_EG3=60, MODAMNT3=18, VELOD3=12, VOL_SLOPE3=30, TRANS3_WAVE=TRANS["rim"], TRANS3_VOL=70, TRANS3_FREQ=40,
    FILTER_TYPE_3=FILT["bp"], FILTER_FREQ_3=96, RESO_3=40, VOL3=96, PAN3=82,
    # Snare: tuned body + band-limited noise
    OSC_WAVE_SNARE=WAVE["tri"], COARSE4=52, FINE4=63, NOISE_FREQ1=118, MIX1=74, MOD_EG4=82, MODAMNT4=36,
    PITCH_SLOPE4=40, VELOD4=28, VOL_SLOPE4=36, REPEAT4=0, TRANS4_WAVE=TRANS["snr"], TRANS4_VOL=52, TRANS4_FREQ=46,
    FILTER_TYPE_4=FILT["hp"], FILTER_FREQ_4=74, RESO_4=22, SNARE_DISTORTION=70, VOL4=112,
    # Cymbal: square FM cluster, high-passed
    WAVE1_CYM=WAVE["rec"], WAVE2_CYM=WAVE["rec"], WAVE3_CYM=WAVE["rec"], COARSE5=79, MOD_OSC_F1_CYM=94,
    MOD_OSC_F2_CYM=101, MOD_OSC_GAIN1_CYM=76, MOD_OSC_GAIN2_CYM=58, FILTER_TYPE_5=FILT["hp"], FILTER_FREQ_5=96,
    RESO_5=12, VELOD5=62, VOL_SLOPE5=40, TRANS5_WAVE=TRANS["hat"], TRANS5_VOL=30, VOL5=78, PAN5=88,
    # Hats: square + noise FM, closed/open decays
    WAVE1_HH=WAVE["rec"], WAVE2_HH=WAVE["rec"], WAVE3_HH=WAVE["noi"], COARSE6=86, MOD_OSC_F1=99, MOD_OSC_F2=110,
    MOD_OSC_GAIN1=96, MOD_OSC_GAIN2=84, FILTER_TYPE_6=FILT["hp"], FILTER_FREQ_6=104, RESO_6=16,
    VELOA6=0, VELOD6_CLOSED=17, VELOD6_OPEN=52, VOL_SLOPE6=34, TRANS6_WAVE=TRANS["hat"], TRANS6_VOL=36, VOL6=90, PAN6=72,
)

# Lubka 2: FM percussion through the ping-pong delay, LFO on the snare filter
lubka2 = list(lubka1)
for k, v in dict(
    COARSE1=31, MIX_MOD_1=0, MOD_WAVE_DRUM1=WAVE["sin"], FM_FREQ1=55, FMAMNT1=30, VELOD1=36, DRIVE1=60,
    OSC_WAVE_DRUM2=WAVE["sin"], MOD_WAVE_DRUM2=WAVE["sin"], COARSE2=60, FM_FREQ2=79, FMAMNT2=88, MIX_MOD_2=0,
    MOD_EG2=70, MODAMNT2=20, VELOD2=22, AUDIO_OUT2=OUT["fx"],
    COARSE3=80, FM_FREQ3=103, FMAMNT3=96, VELOD3=16, AUDIO_OUT3=OUT["fx"],
    FILTER_TYPE_4=FILT["bp"], FILTER_FREQ_4=88, RESO_4=50, MIX1=86, VELOD4=24,
    FREQ_LFO4=58, AMOUNT_LFO4=22, WAVE_LFO4=1, RETRIGGER_LFO4=4,
    VELOD6_OPEN=44, AUDIO_OUT6=OUT["fx"],
    FX_TYPE=4, FX_DRY_WET=32, FX_ROUTING=0, FX_DELAY_TYPE=1, FX_P1=96, FX_P2=118, FX_P3=70, FX_P4=60,
).items():
    lubka2[P["PAR_" + k]] = v
# LFO 4 target = snare filter frequency (index into the firmware's mod-target table)
mt = [m[2] for m in meta["modTargets"]]
lubka2[P["PAR_VOICE_LFO4"]] = 4
lubka2[P["PAR_TARGET_LFO4"]] = mt.index("PAR_FILTER_FREQ_4")

# Lubka 3: lo-fi, sample-rate reduced, through the tube distortion
lubka3 = list(lubka1)
for k, v in dict(
    OSC_WAVE_DRUM1=WAVE["tri"], COARSE1=26, VELOD1=48, VOICE_DECIMATION1=80, AUDIO_OUT1=OUT["st1"], DRIVE1=80,
    VOICE_DECIMATION3=60, OSC_WAVE_DRUM3=WAVE["pwm"], PWM_3=40,
    VOICE_DECIMATION4=82, AUDIO_OUT4=OUT["fx"], REPEAT4=3, VELOA4=8, TRANS4_WAVE=TRANS["clp"],
    VOICE_DECIMATION6=90, WAVE1_HH=WAVE["pwm"], PWM_6=70,
    FX_TYPE=1, FX_DIST_TYPE=0, FX_DRY_WET=45, FX_P1=70, FX_P2=60, FX_P3=127, FX_P4=0,
).items():
    lubka3[P["PAR_" + k]] = v

kits = [("Lubka 1", lubka1), ("Lubka 2", lubka2), ("Lubka 3", lubka3)]

# ------------------------------------------------------------ patterns
T = 0x70  # timing byte: no flam, no shift

def pat(kit_slot, rows, length=16, shuffle=0, extra=None):
    """rows: 7 strings; 'x' = 127, 'o' = 90, '.' = 60 (ghost), '-' = off. Repeated to the track length."""
    tracks = []
    for t in range(7):
        r = rows[t].replace(" ", "")
        steps = []
        for i in range(length):
            c = r[i % len(r)]
            if c in "xo.":
                vel = {"x": 127, "o": 90, ".": 60}[c]
                steps.append([i, vel, 100, 60, T, 255, 0, 255, 0])
        tracks.append({"len": length, "s": steps})
    for (t, i, field, val) in extra or []:
        for s in tracks[t]["s"]:
            if s[0] == i:
                s[field] = val
    return {"shuffle": shuffle, "kit": kit_slot, "tracks": tracks}

FLAM = lambda f: (7 << 4) | f
pats = [
    # 1: four on the floor
    pat(0, ["x---x---x---x---", "----------o-----", "--o-----.--o----", "----x-------x---",
            "----------------", "x-o-x-o-x-o-x-o-", "--x---x---x---x-"]),
    # 2: broken beat with ghost notes, a flammed snare and a probability hat
    pat(0, ["x-----x---x-----", "-------------o--", "---.------.---.-", "----x--.----x-.-",
            "x---------------", "x.x.x.x.x.x.x.x.", "----------x-----"],
        shuffle=40, extra=[(3, 12, 4, FLAM(2)), (5, 7, 2, 50), (5, 15, 2, 50)]),
    # 3: FM kit through the delay, polymetric tracks
    pat(1, ["x--x--x---x--x--", "--o---o--o---o--", "x----x----x----x", "----x-------x---",
            "----------------", "-x-x-x-x-x-x-x-x", "----------------"], length=16),
    # 4: lo-fi, 32 steps with a clap fill
    pat(2, ["x-------x-x-----x-------x--x--x-", "--------------------------------", "--x---x---x---x---x---x---x---o-",
            "----x-------x-------x-------xxxx", "--------------------------------", "x-xxx-xxx-xxx-xxx-xxx-xxx-xxx-xx",
            "------------------------x-------"], length=32, shuffle=20),
]
# polymeter on pattern 3: drum 3 loops every 5 steps, hats every 12
pats[2]["tracks"][2]["len"] = 5
pats[2]["tracks"][2]["s"] = [[0, 110, 100, 60, T, 255, 0, 255, 0], [3, 80, 100, 60, T, 255, 0, 255, 0]]
pats[2]["tracks"][5]["len"] = 12
# step automation on pattern 1: drum 2 pitch steps (coarse) on its single hit
pats[0]["tracks"][1]["s"][0][5] = P["PAR_COARSE2"] + 1
pats[0]["tracks"][1]["s"][0][6] = 50

bank = {
    "label": "LubkaM1 starter",
    "kits": [{"slot": i, "name": n, "p": base64.b64encode(bytes(k)).decode()} for i, (n, k) in enumerate(kits)],
    "pats": [dict(slot=i, **p) for i, p in enumerate(pats)],
}
json.dump([bank], open(os.path.join(D, "banks-public.json"), "w"))
print("kits", [n for n, _ in kits], "patterns", len(pats))
