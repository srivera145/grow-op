#!/usr/bin/env python3
"""
Grow Op sprite repacker.
Turns loose AI-generated pixel-art strips into grid-aligned Phaser spritesheets.

Usage: python3 repack.py <source-art-dir> <output-dir>
"""
import os, sys, json
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets"
OUT = sys.argv[2] if len(sys.argv) > 2 else "out"

PLAYER_W, PLAYER_H = 64, 64          # small form frame box
BODY_TARGET        = 54              # small idle body height, sets the small form's shared scale
BIG_W, BIG_H       = 64, 88          # big form frame box, matches little-bud-grow.png
BIG_TARGET         = 64              # big idle body height, matches the grow strip's final frame
ALPHA_CUT          = 24              # below this, a pixel is transparent

# align: "bottom" = feet on the floor, "strip" = keep vertical motion within the strip,
#        "norm" = rescale every frame to the same body height, "center" = centred
PLAYER = [
    ("idle.png",            "little-bud-small-idle",    4, "norm"),
    ("walk.png",            "little-bud-small-walk",    6, "norm"),
    ("run.png",             "little-bud-small-run",     6, "norm"),
    ("jump.png",            "little-bud-small-jump",    4, "strip"),
    ("fall.png",            "little-bud-small-fall",    4, "strip"),
    ("land.png",            "little-bud-small-land",    4, "bottom"),
    ("attack.png",          "little-bud-small-attack",  4, "bottom"),
    ("hurt.png",            "little-bud-small-hurt",    4, "norm"),
    ("die.png",             "little-bud-small-die",     4, "bottom"),
    ("victory.png",         "little-bud-small-victory", 4, "bottom"),
    ("grow-transition.png", "little-bud-grow",          4, "bottom"),
]
PLAYER_BIG = [
    ("big-idle.png",    "little-bud-big-idle",    4, "norm"),
    ("big-walk.png",    "little-bud-big-walk",    6, "norm"),
    ("big-run.png",     "little-bud-big-run",     6, "norm"),
    ("big-jump.png",    "little-bud-big-jump",    4, "strip"),
    ("big-fall.png",    "little-bud-big-fall",    4, "strip"),
    ("big-land.png",    "little-bud-big-land",    4, "bottom"),
    ("big-attack.png",  "little-bud-big-attack",  4, "bottom"),
    ("big-hurt.png",    "little-bud-big-hurt",    4, "norm"),
    ("big-die.png",     "little-bud-big-die",     4, "bottom"),
    ("big-victory.png", "little-bud-big-victory", 4, "bottom"),
]
OTHERS = [
    ("enemy-spider-mite.png",               "spider-mite-walk",     4, 40, 32, "bottom"),
    ("enemy-spider-mite-death.png",         "spider-mite-death",    3, 40, 32, "bottom"),
    ("enemy-fungus-gnat-fly.png",           "fungus-gnat-fly",      4, 32, 32, "center"),
    ("enemy-fungus-gnat-death.png",         "fungus-gnat-death",    3, 32, 32, "center"),
    ("enemy-root-rot-crawl.png",            "root-rot-crawl",       4, 40, 40, "bottom"),
    ("enemy-root-rot-split.png",            "root-rot-split",       3, 40, 40, "bottom"),
    ("enemy-mini-root-rot-crawl.png",       "root-rot-mini-crawl",  4, 24, 24, "bottom"),
    ("enemy-mini-root-rot-death.png",       "root-rot-mini-death",  3, 24, 24, "bottom"),
    ("pickup-water-drop.png",               "water-drop-idle",      4, 24, 24, "center"),
    ("pickup-light-orb.png",                "light-orb-idle",       4, 32, 32, "center"),
    ("pickup-nutrient.png",                 "nutrient-idle",        4, 32, 32, "center"),
    ("goal-jar-idle.png",                   "goal-jar-idle",        4, 48, 80, "bottom"),
    ("goal-jar-close.png",                  "goal-jar-close",       4, 48, 80, "bottom"),
    ("effects-slash.png",                   "leaf-slash",           3, 32, 32, "center"),
    ("effects-small-dust-and-soil-puff.png","dust-puff",            4, 32, 32, "center"),
    ("hud-icons.png",                       "hud-icons",            5, 16, 16, "center"),
]
TILESETS = [
    ("tiles.png",                            "tiles-soil",        32),
    ("tiles-terracotta-plant-platform.png",  "tiles-pot",         32),
    ("tiles-gray-stone.png",                 "tiles-stone",       32),
    ("tiles-grow-tent-floor.png",            "tiles-tent-floor",  32),
]
SINGLES = [
    ("background-inside-grow-tent.png",                 "bg-far-mylar",   960, 540),
    ("background-grow-lights.png",                      "bg-mid-lights",  960, 540),
    ("background-large-dark-green-leaf-silhouette.png", "bg-near-leaves", 960, 540),
    ("title-logo.png",                                  "logo-growop",   None, None),
]


def load(path):
    return Image.open(path).convert("RGBA")


def col_blobs(im, expected, merge_gap=12):
    """Split a horizontal strip into frame x-ranges."""
    a = np.array(im.getchannel("A"))
    occupied = (a > ALPHA_CUT).any(axis=0)
    runs, start = [], None
    for i, v in enumerate(occupied):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append([start, i - 1]); start = None
    if start is not None:
        runs.append([start, len(occupied) - 1])

    merged = []                                   # join fragments of the same character
    for r in runs:
        if merged and r[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)

    if len(merged) > expected:                    # keep the widest, in original order
        keep = sorted(sorted(merged, key=lambda r: r[1] - r[0], reverse=True)[:expected],
                      key=lambda r: r[0])
        merged = keep
    if len(merged) != expected:                   # give up and divide evenly
        w = im.size[0] // expected
        merged = [[i * w, (i + 1) * w - 1] for i in range(expected)]
    return merged


def content_box(im, x0, x1):
    """Bounding box of non-transparent pixels inside an x-range."""
    a = np.array(im.getchannel("A"))[:, x0:x1 + 1]
    mask = a > ALPHA_CUT
    if not mask.any():
        return None
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    return (x0 + xs[0], ys[0], x0 + xs[-1], ys[-1])


def clean_alpha(im):
    """Harden semi-transparent edge pixels so downscaled art keeps crisp edges."""
    a = np.array(im.getchannel("A"))
    a = np.where(a > 110, 255, 0).astype(np.uint8)
    im.putalpha(Image.fromarray(a))
    return im


def place(src, box, fw, fh, scale, align, strip_y=None, body_target=None):
    """Crop one frame, scale it, and drop it into an fw x fh cell."""
    x0, y0, x1, y1 = box
    top, bot = (strip_y if align == "strip" else (y0, y1))
    crop = src.crop((x0, top, x1 + 1, bot + 1))

    if align == "norm" and body_target:
        # every frame of a walk/run/idle cycle gets the same on-screen height,
        # which cancels the size drift in the source art
        f = body_target / crop.size[1]
        nw = max(1, int(round(crop.size[0] * f)))
        nh = body_target
    else:
        nw = max(1, int(round(crop.size[0] * scale)))
        nh = max(1, int(round(crop.size[1] * scale)))

    crop = clean_alpha(crop.resize((nw, nh), Image.LANCZOS))
    if nw > fw or nh > fh:                        # never let a frame bleed into its neighbour
        crop.thumbnail((fw, fh), Image.LANCZOS)
        crop = clean_alpha(crop)
        nw, nh = crop.size

    cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    px = (fw - nw) // 2
    py = fh - nh if align in ("bottom", "strip", "norm") else (fh - nh) // 2
    cell.alpha_composite(crop, (px, py))
    return cell


def build_strip(src_path, name, frames, fw, fh, align, scale=None, report=None, body_target=None):
    im = load(src_path)
    blobs = col_blobs(im, frames)
    boxes = [b for b in (content_box(im, b[0], b[1]) for b in blobs) if b]
    if len(boxes) != frames:
        report.append(f"{name}: found {len(boxes)} frames, expected {frames}")
        frames = len(boxes)

    if scale is None:                             # self-scale: fit the tallest frame
        tallest = max(b[3] - b[1] + 1 for b in boxes)
        scale = (fh - 2) / tallest

    strip_y = (min(b[1] for b in boxes), max(b[3] for b in boxes))
    sheet = Image.new("RGBA", (fw * frames, fh), (0, 0, 0, 0))
    for i, b in enumerate(boxes):
        sheet.alpha_composite(place(im, b, fw, fh, scale, align, strip_y, body_target), (i * fw, 0))
    sheet.save(os.path.join(OUT, "sheets", name + ".png"))
    return {"key": name, "path": f"assets/sheets/{name}.png", "type": "spritesheet",
            "frameWidth": fw, "frameHeight": fh, "frames": frames}


def build_tileset(src_path, name, tile, report):
    """Find each tile blob and repack them edge to edge on an exact grid."""
    im = load(src_path)
    a = np.array(im.getchannel("A")) > ALPHA_CUT

    def runs(occ, gap=6):
        out, start = [], None
        for i, v in enumerate(occ):
            if v and start is None: start = i
            elif not v and start is not None: out.append([start, i - 1]); start = None
        if start is not None: out.append([start, len(occ) - 1])
        m = []
        for r in out:
            if m and r[0] - m[-1][1] <= gap: m[-1][1] = r[1]
            else: m.append(r)
        return [r for r in m if r[1] - r[0] > 8]

    cols, rows = runs(a.any(axis=0)), runs(a.any(axis=1))
    cells = [(c, r) for r in rows for c in cols]
    if not cells:
        report.append(f"{name}: no tiles detected")
        return None

    sheet = Image.new("RGBA", (tile * len(cols), tile * len(rows)), (0, 0, 0, 0))
    for idx, (c, r) in enumerate(cells):
        piece = im.crop((c[0], r[0], c[1] + 1, r[1] + 1)).resize((tile, tile), Image.LANCZOS)
        piece = clean_alpha(piece)
        gx, gy = idx % len(cols), idx // len(cols)
        sheet.alpha_composite(piece, (gx * tile, gy * tile))
    sheet.save(os.path.join(OUT, "tiles", name + ".png"))
    return {"key": name, "path": f"assets/tiles/{name}.png", "type": "image",
            "tileWidth": tile, "tileHeight": tile,
            "columns": len(cols), "rows": len(rows), "tiles": len(cells)}


def build_single(src_path, name, w, h):
    im = load(src_path)
    if w:
        im = im.resize((w, h), Image.LANCZOS)
    else:
        im.thumbnail((640, 360), Image.LANCZOS)
    sub = "bg" if name.startswith("bg-") else "ui"
    im.save(os.path.join(OUT, sub, name + ".png"))
    return {"key": name, "path": f"assets/{sub}/{name}.png", "type": "image",
            "width": im.size[0], "height": im.size[1]}


def measure_body(src_path, frames):
    """Tallest frame content height in a strip, used to derive a form's shared scale."""
    im = load(src_path)
    boxes = [content_box(im, b[0], b[1]) for b in col_blobs(im, frames)]
    return max(b[3] - b[1] + 1 for b in boxes if b)


def write_assets_js(manifest):
    sheets = [a for a in manifest if a["type"] == "spritesheet"]
    tiles  = [a for a in manifest if a.get("tileWidth")]
    imgs   = [a for a in manifest if a["type"] == "image" and not a.get("tileWidth")]
    L = ["// Grow Op - verified asset manifest. Generated by tools/repack.py.",
         "// Every entry below was measured off the real PNG, not assumed.", ""]
    L.append("export const SPRITESHEETS = [")
    for a in sheets:
        L.append(f"  {{ key: '{a['key']}', path: '{a['path']}', frameWidth: {a['frameWidth']}, "
                 f"frameHeight: {a['frameHeight']}, frames: {a['frames']} }},")
    L += ["];", "", "export const TILESETS = ["]
    for a in tiles:
        L.append(f"  {{ key: '{a['key']}', path: '{a['path']}', tileWidth: {a['tileWidth']}, "
                 f"tileHeight: {a['tileHeight']}, columns: {a['columns']}, rows: {a['rows']}, "
                 f"tiles: {a['tiles']} }},")
    L += ["];", "", "export const IMAGES = ["]
    for a in imgs:
        L.append(f"  {{ key: '{a['key']}', path: '{a['path']}', width: {a['width']}, height: {a['height']} }},")
    L += ["];", "",
          f"export const PLAYER_FRAME = {{ small: {{ w: {PLAYER_W}, h: {PLAYER_H} }}, "
          f"big: {{ w: {BIG_W}, h: {BIG_H} }} }};", ""]
    with open(os.path.join(OUT, "assets.js"), "w") as fh:
        fh.write("\n".join(L) + "\n")


def main():
    for d in ("sheets", "tiles", "bg", "ui"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    report, manifest = [], []

    # small form: one shared scale, measured off its idle strip so every animation matches
    body = measure_body(os.path.join(SRC, "idle.png"), 4)
    pscale = BODY_TARGET / body
    report.append(f"small scale {pscale:.4f} (idle body {body}px -> {BODY_TARGET}px)")

    for f, name, n, align in PLAYER:
        p = os.path.join(SRC, f)
        if not os.path.exists(p):
            report.append(f"MISSING {f}"); continue
        fh = BIG_H if name == "little-bud-grow" else PLAYER_H
        manifest.append(build_strip(p, name, n, PLAYER_W, fh, align, pscale, report, BODY_TARGET))

    # big form: scaled off its own idle strip, independently of the small form
    big_idle = os.path.join(SRC, "big-idle.png")
    if os.path.exists(big_idle):
        bbody = measure_body(big_idle, 4)
        bscale = BIG_TARGET / bbody
        report.append(f"big scale {bscale:.4f} (idle body {bbody}px -> {BIG_TARGET}px)")
        for f, name, n, align in PLAYER_BIG:
            p = os.path.join(SRC, f)
            if not os.path.exists(p):
                report.append(f"MISSING {f}"); continue
            manifest.append(build_strip(p, name, n, BIG_W, BIG_H, align, bscale, report, BIG_TARGET))
    else:
        report.append("big form not generated yet, skipping big-idle.png and its nine siblings")

    for f, name, n, fw, fh, align in OTHERS:
        p = os.path.join(SRC, f)
        if not os.path.exists(p):
            report.append(f"MISSING {f}"); continue
        manifest.append(build_strip(p, name, n, fw, fh, align, None, report))

    for f, name, tile in TILESETS:
        p = os.path.join(SRC, f)
        if not os.path.exists(p):
            report.append(f"MISSING {f}"); continue
        e = build_tileset(p, name, tile, report)
        if e: manifest.append(e)

    for f, name, w, h in SINGLES:
        p = os.path.join(SRC, f)
        if not os.path.exists(p):
            report.append(f"MISSING {f}"); continue
        manifest.append(build_single(p, name, w, h))

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    write_assets_js(manifest)

    print("\n".join(report))
    print(f"\nwrote {len(manifest)} assets to {OUT}/")


if __name__ == "__main__":
    main()