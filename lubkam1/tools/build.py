#!/usr/bin/env python3
"""Inline data, engine and app into one page.

usage: build.py <root> <out_dir> [--public] [--repo URL]
  default   embeds data/banks.json (your own kits and patterns; keep it private)
  --public  embeds data/banks-public.json (original starter kits) and data/banks-mutated.json
            and writes a standalone index.html for static hosting such as GitHub Pages
"""
import json, os, shutil, sys

args = sys.argv[1:]
ROOT, OUT = args[0], args[1]
public = "--public" in args
repo = args[args.index("--repo") + 1] if "--repo" in args else ""
src = lambda *p: os.path.join(ROOT, *p)
meta = json.load(open(src("data", "meta.json")))
ui_meta = {k: meta[k] for k in ("P", "END", "params", "menus", "pages", "modTargets")}
tables = json.load(open(src("data", "tables.json")))
banks = json.load(open(src("data", "banks-public.json" if public else "banks.json")))
if public and os.path.exists(src("data", "banks-mutated.json")):
    banks += json.load(open(src("data", "banks-mutated.json")))
for b in banks:
    for p in b["pats"]:
        p.pop("name", None)
compact = lambda o: json.dumps(o, separators=(",", ":")).replace("</", "<\\/")
engine = open(src("src", "engine.js")).read()
app = open(src("src", "app.js")).read()
page = open(src("src", "page.html")).read()
source = ""
if repo:
    source = f'Source code and licence: <a href="{repo}">{repo.replace("https://", "")}</a>.'
engine_tag = ('<script src="engine.js"></script>' if public
              else '<script id="engine-src">' + engine + '</script>')
page = (page.replace("/*__META__*/", compact(ui_meta))
            .replace("/*__TABLES__*/", compact(tables))
            .replace("/*__BANKS__*/", compact(banks))
            .replace("<!--__ENGINE_TAG__-->", engine_tag)
            .replace("/*__APP__*/", app)
            .replace("<!--__SOURCE__-->", source))
os.makedirs(OUT, exist_ok=True)
if public:
    cut = page.index('<div class="wrap">')
    head, body = page[:cut], page[cut:]
    icon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23262c28'/%3E"
            "%3Crect x='6' y='18' width='5' height='8' rx='1' fill='%23ff8a1f'/%3E%3Crect x='13.5' y='10' width='5' height='16' rx='1' fill='%237af3d0'/%3E"
            "%3Crect x='21' y='14' width='5' height='12' rx='1' fill='%23ff8a1f'/%3E%3C/svg%3E")
    doc = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
           "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
           "<meta name=\"description\" content=\"LubkaM1: a six-voice digital drum synthesizer that runs in the browser, built as an academic study from GPL-3 drum-synth firmware.\">\n"
           f"<link rel=\"icon\" href=\"{icon}\">\n"
           "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n"
           + head + "\n</head>\n<body>\n" + body + "\n</body>\n</html>\n")
    open(os.path.join(OUT, "index.html"), "w").write(doc)
    open(os.path.join(OUT, ".nojekyll"), "w").write("")
    name = "index.html"
else:
    open(os.path.join(OUT, "lubkam1.html"), "w").write(page)
    name = "lubkam1.html"
shutil.copy(src("src", "engine.js"), os.path.join(OUT, "engine.js"))
print(name, len(open(os.path.join(OUT, name)).read().encode()), "bytes")
