#!/usr/bin/env python3
"""Extract engine tables, parameter metadata, menu layout, kits and patterns
for LubkaM1 from the GPL-3.0 firmware sources and the user's SD-card data.

usage: extract.py <firmware_repo> <data_root> <out_dir>
"""
import base64, json, os, re, struct, sys
from array import array

REPO, DATA, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
CORE = os.path.join(REPO, "Core")


DEFINES = {"USE_CODEC_EQ": 0, "USE_REVERB": 0}


def nocomment(s):
    # single left-to-right scan, so "//*x*/" is a line comment as in C
    def rep(m):
        t = m.group(0)
        return t if t.startswith('"') else ("\n" * t.count("\n"))
    return re.sub(r'"(?:\\.|[^"\\\n])*"|//[^\n]*|/\*.*?\*/', rep, s, flags=re.S)


def preprocess(s):
    """Tiny #if/#else/#endif evaluator (enough for the menu/param headers)."""
    out, frames = [], []  # frame = [parent_active, cond]

    def active():
        return all(p and c for p, c in frames) if frames else True

    for line in s.split("\n"):
        m = re.match(r"\s*#\s*(if|ifdef|ifndef|else|endif)\b\s*(.*)", line)
        if m:
            kw, expr = m.group(1), m.group(2).strip()
            if kw == "if":
                if re.fullmatch(r"\d+", expr):
                    v = int(expr)
                elif re.fullmatch(r"\w+", expr):
                    v = DEFINES.get(expr, 0)
                else:
                    v = 0
                frames.append([active(), bool(v)])
            elif kw == "ifdef":
                frames.append([active(), expr in DEFINES])
            elif kw == "ifndef":
                frames.append([active(), True])
            elif kw == "else":
                frames[-1][1] = not frames[-1][1]
            elif kw == "endif":
                frames.pop()
            continue
        if active():
            out.append(line)
    return "\n".join(out)


def rd(p):
    return preprocess(nocomment(open(os.path.join(CORE, p), encoding="latin-1").read()))


def parse_enum(src, name_regex):
    """Parse a C enum body into {NAME: value} preserving aliases."""
    m = re.search(name_regex + r"\s*\{(.*?)\}", src, flags=re.S)
    body = nocomment(m.group(1))
    out, order, cur = {}, [], -1
    for tok in [t.strip() for t in body.split(",")]:
        if not tok:
            continue
        if "=" in tok:
            k, v = [x.strip() for x in tok.split("=", 1)]
            v = v.replace("(", "").replace(")", "")
            if re.fullmatch(r"-?\d+", v):
                cur = int(v)
            elif re.fullmatch(r"0x[0-9a-fA-F]+", v):
                cur = int(v, 16)
            elif "+" in v:
                a, b = v.split("+")
                cur = out[a.strip()] + int(b)
            elif "*" in v:
                a, b = v.split("*")
                cur = int(a) * int(b)
            else:
                cur = out[v]
        else:
            k = tok
            cur += 1
        out[k] = cur
        order.append(k)
    return out, order


# ---------------------------------------------------------------- parameters
P, Porder = parse_enum(rd("Inc/Parameters.h"), r"enum\s+ParamEnums")
END = P["END_OF_SOUND_PARAMETERS"]
print("END_OF_SOUND_PARAMETERS", END, "PAR_BPM", P["PAR_BPM"])

# dtypes table (in index order)
menu_c = rd("Src/menu/menu.c")
dt_body = re.search(r"parameter_dtypes\[NUM_PARAMS\]\s*=\s*\{(.*?)\n\};", menu_c, flags=re.S).group(1)
dt_entries = [e.strip() for e in nocomment(dt_body).split(",") if e.strip()]
menu_h = rd("Inc/menu/menu.h")
DT, _ = parse_enum(menu_h, r"enum\s+Datatypes")
mt = rd("Inc/menu/MenuText.h")
MENU_IDS = {k: int(v) for k, v in re.findall(r"#define\s+(MENU_\w+)\s+(\d+)", mt)}
dtypes = []
for e in dt_entries:
    m = re.match(r"(DTYPE_\w+)\s*(?:\|\s*\((MENU_\w+)\s*<<\s*8\))?", e)
    if not m: print("BAD", repr(e)); continue
    dtypes.append({"t": m.group(1), "menu": m.group(2)})
print("dtypes", len(dtypes))

# value name arrays from MenuText.h (first element is count)
def str_array(name):
    m = re.search(r"const char " + name + r"\[\]\[\d+\]\s*=\s*\{(.*?)\};", mt, flags=re.S)
    items = re.findall(r'"([^"]*)"', nocomment(m.group(1)))
    return items

menus = {
    "MENU_FILTER": str_array("filterTypes"),
    "MENU_WAVEFORM": str_array("waveformNames"),
    "MENU_AUDIO_OUT": str_array("outputNames"),
    "MENU_AUDIO_OUT_FX": str_array("outputNamesFx"),
    "MENU_SYNC_RATES": str_array("syncRateNames"),
    "MENU_LFO_WAVES": str_array("lfoWaveNames"),
    "MENU_RETRIGGER": str_array("retriggerNames"),
    "MENU_TRANS": str_array("transientNames"),
    "MENU_MIX_FM": str_array("mixFmNames"),
    "MENU_FX": str_array("fxNames"),
    "MENU_DIST": str_array("distNames"),
    "MENU_RATIO": str_array("ratioNames"),
    "MENU_DELAY": str_array("delayNames"),
    "MENU_STEP_FLAM": str_array("stepFlamNames"),
    "MENU_STEP_SHIFT": str_array("stepShiftNames"),
}

shortNames = re.findall(r'"([^"]*)"', nocomment(re.search(r"const char shortNames\[\]\[4\]\s*=\s*\{(.*?)\};", mt, re.S).group(1)))
catNames = re.findall(r'"([^"]*)"', nocomment(re.search(r"const char catNames\[\]\[16\]\s*=\s*\{(.*?)\};", mt, re.S).group(1)))
longNames = re.findall(r'"([^"]*)"', nocomment(re.search(r"const char longNames\[\]\[16\]\s*=\s*\{(.*?)\};", mt, re.S).group(1)))
SH, _ = parse_enum(menu_h, r"enum\s+shortNamesEnum")
CA, _ = parse_enum(menu_h, r"enum\s+catNamesEnum")
LO, _ = parse_enum(menu_h, r"enum\s+longNamesEnum")
TX, _ = parse_enum(menu_h, r"enum\s+NamesEnum")
vn_body = re.search(r"const Name valueNames\[NUM_NAMES\]\s*=\s*\{(.*?)\n\};", menu_c, re.S).group(1)
valueNames = []
for a, b, c in re.findall(r"\{\s*(SHORT_\w+)\s*,\s*(CAT_\w+)\s*,\s*(LONG_\w+)\s*\}", nocomment(vn_body)):
    valueNames.append([shortNames[SH[a]], catNames[CA[b]], longNames[LO[c]]])
print("valueNames", len(valueNames), "short", len(shortNames))

def text_name(t):
    i = TX[t]
    return valueNames[i] if i < len(valueNames) else ["???", "", t]

# menu pages
mp = nocomment(rd("Inc/menu/menuPages.h"))
mp = mp[mp.index("menuPages[NUM_PAGES][NUM_SUB_PAGES]"):]
subpages = re.findall(r"\{\s*((?:TEXT_\w+\s*,\s*){7}TEXT_\w+)\s*,\s*((?:PAR_\w+\s*,\s*){7}PAR_\w+)\s*,?\s*\}", mp)
pages = []
for tops, bots in subpages:
    t = [x.strip() for x in tops.split(",")]
    b = [x.strip() for x in bots.split(",")]
    pages.append([[text_name(tt), P.get(bb, 0), tt, bb] for tt, bb in zip(t, b)])
print("subpages", len(pages))

# modTargets
cc = nocomment(rd("Src/menu/Cc2Text.c"))
mtb = re.search(r"const ModTarg modTargets\[\]\s*=\s*\{(.*?)\n\};", cc, re.S).group(1)
modTargets = [[text_name(a), P[b], b] for a, b in re.findall(r"\{\s*(TEXT_\w+)\s*,\s*(PAR_\w+)\s*\}", mtb)]
print("modTargets", len(modTargets))

params = []
for name in Porder:
    idx = P[name]
    if idx >= len(dtypes):
        continue
    while len(params) <= idx:
        params.append(None)
    if params[idx] is None:
        params[idx] = {"n": name, **dtypes[idx]}

# ---------------------------------------------------------------- DSP tables
def c_array(src, name, typ=int):
    m = re.search(name + r"\s*(?:\[[^\]]*\])+\s*=\s*\{(.*?)\};", src, re.S)
    body = nocomment(m.group(1))
    nums = re.findall(r"-?0x[0-9A-Fa-f]+|-?\d+\.?\d*(?:[eE][-+]?\d+)?f?", body)
    out = []
    for n in nums:
        n = n.rstrip("f")
        if typ is int:
            out.append(int(n, 16) if "x" in n.lower() else int(float(n)))
        else:
            out.append(float(n))
    return out

wt = rd("Src/Soundengine/DSPAudio/wavetable.c")
sine = c_array(wt, "sine_table")
saw = c_array(wt, "sawTable")
rec = c_array(wt, "recTable")
tri = c_array(wt, "triTable")
print("tables", len(sine), len(saw), len(rec), len(tri))
tt = rd("Src/Soundengine/DSPAudio/transientTables.c")
_tb = nocomment(re.search(r"transientData\s*(?:\[[^\]]*\])+\s*=\s*\{(.*)\};", tt, re.S).group(1))
trans = []
for row in re.findall(r"\{([^{}]*)\}", _tb):
    vals = [int(v, 16) for v in re.findall(r"0x[0-9A-Fa-f]+", row)]
    vals = [(x - 256 if x > 127 else x) for x in vals]
    trans += (vals + [0] * 2205)[:2205]
print("transient", len(trans), len(trans) / 2205)
mnf = c_array(rd("Inc/Soundengine/MIDI/MidiNoteNumbers.h"), "MidiNoteFrequencies", float)
dist = rd("Src/Soundengine/DSPAudio/FX/Distortion.c")
ecc = c_array(dist, "ecc83Table", float)
diode = c_array(dist, "table_1n914", float)
print("notes", len(mnf), "ecc", len(ecc), "diode", len(diode))

def b64i16(a):
    return base64.b64encode(array("h", a).tobytes()).decode()

def b64i8(a):
    return base64.b64encode(array("b", a).tobytes()).decode()

tables = {
    "sine": b64i16(sine), "saw": b64i16(saw), "rec": b64i16(rec), "tri": b64i16(tri),
    "trans": b64i8(trans), "notes": mnf, "ecc83": ecc, "diode": diode,
}

# ---------------------------------------------------------------- user data
def clean(n):
    n = n.split(b"\x00")[0].decode("latin-1").strip()
    return n

def read_kit(path):
    b = open(path, "rb").read()
    name = clean(b[:8])
    data = list(b[8:8 + END])
    data += [0] * (END - len(data))
    return name, data

def read_pat(path):
    b = open(path, "rb").read()
    name = clean(b[:8])
    pos = 8
    ver = 1
    if b[pos:pos + 4] == b"PatV":
        ver = int(b[pos + 4:pos + 6]); pos += 6
    tracks = []
    for t in range(7):
        steps = []
        for s in range(64):
            vol, prob, note, p1n, p1v, p2n, p2v = b[pos:pos + 7]; pos += 7
            steps.append([vol, prob, note, p1n, p1v, p2n, p2v])
        timing = list(b[pos:pos + 64]) if ver > 2 else [0x70] * 64
        if ver > 2: pos += 64
        tracks.append({"steps": steps, "timing": timing})
    for t in range(7):
        bits = 0
        for bar in range(4):
            w, = struct.unpack_from("<H", b, pos); pos += 2
            bits |= w << (16 * bar)
        tracks[t]["main"] = bits
    shuffle = b[pos]; pos += 1
    for t in range(7):
        tracks[t]["len"] = b[pos]; pos += 1
    kit = b[pos] if ver > 1 and pos < len(b) else 0
    return {"name": name, "ver": ver, "shuffle": shuffle, "kit": kit, "tracks": tracks}

def pat_is_empty(p):
    return all(t["main"] == 0 for t in p["tracks"])

def compact_pat(p):
    out = {"shuffle": p["shuffle"], "kit": p["kit"], "tracks": []}
    for t in p["tracks"]:
        st = []
        for i, s in enumerate(t["steps"]):
            on = (t["main"] >> i) & 1
            if on:
                st.append([i, s[0] & 0x7F, s[1], s[2], t["timing"][i], s[3], s[4], s[5], s[6]])
        out["tracks"].append({"len": t["len"], "s": st})
    return out

def _old_compact_pat(p):
    # keep only data that matters to playback/edit: per step vol|prob|note|flam/shift and automation
    out = {"name": p["name"], "shuffle": p["shuffle"], "kit": p["kit"], "tracks": []}
    for t in p["tracks"]:
        steps = []
        for i, s in enumerate(t["steps"]):
            on = (t["main"] >> i) & 1
            steps.append([on, s[0] & 0x7F, s[1], s[2], t["timing"][i], s[3], s[4], s[5], s[6]])
        out["tracks"].append({"len": t["len"], "steps": steps})
    return out

banks = []

def scan_folder(label, folder):
    files = sorted(os.listdir(folder))
    kits, pats = {}, {}
    for f in files:
        if f.startswith("._"):
            continue
        m = re.match(r"(\d\d)-.*\.(SND|PAT)$", f, re.I)
        if not m:
            continue
        slot, ext = int(m.group(1)), m.group(2).upper()
        p = os.path.join(folder, f)
        if ext == "SND":
            name, data = read_kit(p)
            if slot in kits and kits[slot]["name"] not in ("INITK", "IN__K", "Empty"):
                continue
            kits[slot] = {"slot": slot, "name": name or f[3:-4], "p": base64.b64encode(bytes(data)).decode()}
        else:
            pat = read_pat(p)
            if not pat_is_empty(pat):
                pats[slot] = {"slot": slot, **compact_pat(pat)}
    # drop init kits
    def junk(n):
        return (n.lower().startswith("in") and n.lower().endswith("kit")) or n in ("", "Empty") or any(ord(c) < 32 or ord(c) > 126 for c in n) or len(n) < 3 and not n.isalnum()
    kits = {k: v for k, v in kits.items() if not junk(v["name"])}
    if kits or pats:
        banks.append({"label": label, "kits": [kits[k] for k in sorted(kits)], "pats": [pats[k] for k in sorted(pats)]})
        print(f"{label}: {len(kits)} kits, {len(pats)} patterns")

roots = sorted(os.listdir(DATA))
for r in roots:
    for dirpath, dirnames, filenames in sorted(os.walk(os.path.join(DATA, r))):
        if "__MACOSX" in dirpath:
            continue
        if any(f.upper().endswith(".SND") for f in filenames):
            rel = os.path.relpath(dirpath, DATA)
            if "kits only" in rel:
                continue  # same kits as the DLC project folder
            scan_folder(rel, dirpath)

def nice(label):
    if "UNTZ" in label: return "Club pack"
    if "DLC" in label: return "Expansion pack"
    m = re.search(r"PROJ0(\d)", label)
    if m: return "Factory kits" if m.group(1) == "0" else "Factory demo " + m.group(1)
    return label
for bk in banks:
    bk["label"] = nice(bk["label"])
order = ["Factory kits", "Factory demo 1", "Factory demo 2", "Factory demo 3", "Factory demo 4", "Factory demo 5", "Club pack", "Expansion pack"]
banks.sort(key=lambda b: order.index(b["label"]) if b["label"] in order else 99)
os.makedirs(OUT, exist_ok=True)
meta = {"END": END, "P": P, "params": params, "menus": menus, "pages": pages,
        "modTargets": modTargets, "valueNames": valueNames}
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"))
json.dump(tables, open(os.path.join(OUT, "tables.json"), "w"))
json.dump(banks, open(os.path.join(OUT, "banks.json"), "w"))
print("done")
