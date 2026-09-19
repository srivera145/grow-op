#!/usr/bin/env python3
"""
Grow Op sprite repacker.
Turns loose AI-generated pixel-art strips into grid-aligned Phaser spritesheets.

Three ways in. The first is the original, and is what built everything in public/assets:

  python3 repack.py <source-art-dir> <output-dir>
      The manifest run: every asset in the lists below, plus manifest.json and assets.js.

  python3 repack.py --strip <src.png> <key> <frames> <fw> <fh> <align> --out <dir> [--json]
      One strip, described on the command line rather than looked up, so an asset this file has
      never heard of can be repacked. align is bottom | center | strip | norm.

  python3 repack.py --tileset <src.png> <key> <tile> --out <dir> [--json]
      One tileset, packed onto a <tile>px grid.

  python3 repack.py --single <src.png> <key> <width> <height> --out <dir> [--json]
      One still image, resized: a parallax layer, or anything else that is not animated.

  python3 repack.py --seams <packed-tileset.png> <tile> [--json]
      Packs nothing. Reports which cell boundaries of an existing tileset are see-through, and the
      TILESETS `backing` that would hide them.

The two single-asset modes exist for the editor's Art panel, which generates a strip for an asset
that by definition has no line in the lists below. They call the same build_strip and build_tileset
the manifest run calls, so generated art is packed by exactly the code that packed the hand-made
art, and --json adds an audit of the source image (see audit_strip) for the panel to show.
"""
import os, sys, json
import numpy as np
from PIL import Image

ARGV = sys.argv[1:]
SINGLE = bool(ARGV) and ARGV[0].startswith("--")

# The manifest run's two positional arguments. A single-asset run has no source directory - it is
# given one file - and takes its output directory from --out, which overwrites OUT before it builds.
SRC = "assets" if SINGLE else (ARGV[0] if len(ARGV) > 0 else "assets")
OUT = "out" if SINGLE else (ARGV[1] if len(ARGV) > 1 else "out")

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
    ("big-walk.png",    "little-bud-big-walk",    5, "norm"),
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


# ---------------------------------------------------------------- auditing one generated image

# Under this much transparency the "transparent background" instruction was not followed, and what
# came back is art painted onto a filled rectangle. Repacking that cuts the rectangle into frames.
MIN_TRANSPARENT_PERCENT = 20.0

# Average per-channel difference between a background's left and right edge columns, above which
# the repeat is something you can see rather than something you have to look for.
SEAM_VISIBLE = 24.0


def runs_of(occupied, merge_gap, min_length=0):
    """
    Runs of True in a boolean row, joined across gaps of up to merge_gap.

    This is the scan col_blobs and build_tileset each open with, kept separately here because the
    audit needs the answer they then throw away. col_blobs goes on to drop the narrowest blobs, or
    to give up and divide the strip evenly, so that it always returns the number of frames it was
    asked for - right for packing, and useless for auditing, where the entire question is whether
    the art has the number of frames it was meant to have. Neither of those functions is touched.
    """
    out, start = [], None
    for i, v in enumerate(occupied):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append([start, i - 1]); start = None
    if start is not None:
        out.append([start, len(occupied) - 1])

    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [r for r in merged if r[1] - r[0] >= min_length]


def measure(src_path):
    """The facts about an image that hold whatever it is meant to be: size, alpha, how much is empty."""
    raw = Image.open(src_path)
    # A palette image can carry transparency without being RGBA, so the mode alone is not the answer.
    has_alpha = raw.mode in ("RGBA", "LA", "PA") or "transparency" in raw.info
    im = raw.convert("RGBA")
    alpha = np.array(im.getchannel("A"))
    return im, {
        "source": os.path.basename(src_path),
        "width": int(im.size[0]),
        "height": int(im.size[1]),
        "hasAlpha": bool(has_alpha),
        "transparentPercent": round(float((alpha <= ALPHA_CUT).mean() * 100), 1),
    }


def background_flags(facts):
    """The two ways a generation comes back as a picture of a sprite rather than as a sprite."""
    flags = []
    if not facts["hasAlpha"]:
        flags.append("{} has no alpha channel, so there is no background to cut away: every frame "
                     "would be packed as a filled rectangle".format(facts["source"]))
    if facts["transparentPercent"] < MIN_TRANSPARENT_PERCENT:
        flags.append("only {}% of the image is transparent, under the {:.0f}% a cut-out sprite needs. "
                     "This is art on a solid background rather than art on nothing"
                     .format(facts["transparentPercent"], MIN_TRANSPARENT_PERCENT))
    return flags


def audit_strip(src_path, expected, frame_width, frame_height):
    """
    What is in a strip, measured against what was asked for.

    Everything here is read off the source image. The repacked sheet is the right shape by
    construction - build_strip pads whatever it finds into the cells it was given - so measuring the
    output would only ever confirm the arithmetic, while the mistakes worth catching are all upstream
    of it: a background that is not transparent, and a strip with the wrong number of frames in it.
    """
    im, facts = measure(src_path)
    width = facts["width"]

    implied = len(runs_of((np.array(im.getchannel("A")) > ALPHA_CUT).any(axis=0), merge_gap=12))
    divides = expected > 0 and width % expected == 0

    # The split the repack will actually use, so the per-frame sizes describe what gets packed.
    boxes = [content_box(im, b[0], b[1]) for b in col_blobs(im, expected)]
    frames = [{"index": i, "width": 0 if b is None else int(b[2] - b[0] + 1),
               "height": 0 if b is None else int(b[3] - b[1] + 1)} for i, b in enumerate(boxes)]

    flags = background_flags(facts)
    if not divides:
        flags.append("{}px does not divide into {} frames ({:.2f}px each), so the frames are not "
                     "evenly spaced".format(width, expected, width / expected if expected else 0))
    if implied != expected:
        flags.append("{} separate shape{} found in the strip, not the {} frames asked for"
                     .format(implied, "" if implied == 1 else "s", expected))

    # Not a refusal: a frame too big for its cell is scaled down to fit rather than being clipped.
    notes = ["frame {} is {}x{}, larger than the {}x{} cell, so it is scaled down to fit"
             .format(f["index"] + 1, f["width"], f["height"], frame_width, frame_height)
             for f in frames if f["width"] > frame_width or f["height"] > frame_height]

    return dict(facts, kind="strip", expectedFrames=expected, impliedFrames=implied,
                dividesEvenly=divides, frameWidth=width // expected if expected else 0,
                cell={"width": frame_width, "height": frame_height},
                frames=frames, flags=flags, notes=notes)


# ---------------------------------------------------------------- seams, and the backing that hides them

# A cell boundary line in a PACKED tileset more than this transparent is a gap: when the game draws two
# of these tiles side by side, the level's background shows through the join as a hairline.
SEAM_CLEAR = 0.5

# Deriving a backing. GameScene.addGroundBacking takes three numbers and this is where they come from:
#
#   inset     how far to keep the fill clear of a side facing open air. Taken as the DEEPEST any pixel
#             along that side is see-through, because the fill must not appear anywhere behind the
#             tile's own silhouette - one visible pixel of it is a dark halo along the ground.
#   seamInset how far to keep the thin join strips clear of the same side. Taken as the depth MOST of
#             that side is see-through, because the gap itself runs right out to the corner and a strip
#             held back as far as `inset` would leave the last few pixels of every join showing.
#
# That difference is the whole reason there are two numbers rather than one. Measured against tiles-soil,
# whose pair was tuned by eye long before this existed, it derives 16 and 3 where a person chose 14 and 4.
SEAM_TYPICAL_PERCENT = 75

# The backing colour is the tile's own border, so a covered join reads as the tile continuing rather
# than as a painted line. Taken as the mean of the darkest tenth of the opaque pixels on the cell
# outlines: the single darkest pixel is one stray anti-aliased corner and comes out far too dark.
OUTLINE_DARKEST_PERCENT = 10
LUMINANCE = np.array([0.2126, 0.7152, 0.0722])


def cell_views(box):
    """One cell seen from each of its four sides, as rows running inward from that side."""
    return {"top": box, "bottom": box[::-1], "left": box.T, "right": box.T[::-1]}


def boundary_seams(clear, tile):
    """
    Every interior cell boundary line in a packed sheet that is mostly transparent.

    Both pixel lines either side of a boundary are looked at, and reported separately, because they
    belong to different tiles: art that stops one pixel short on its right edge is a different defect
    from art that starts one pixel late on its left, and a person fixing it needs to know which.
    """
    rows, cols = clear.shape[0] // tile, clear.shape[1] // tile
    found = []
    for k in range(1, cols):
        for x in (k * tile - 1, k * tile):
            share = float(clear[:, x].mean())
            if share > SEAM_CLEAR:
                found.append({"axis": "column", "at": int(x), "transparentPercent": round(share * 100, 1)})
    for k in range(1, rows):
        for y in (k * tile - 1, k * tile):
            share = float(clear[y, :].mean())
            if share > SEAM_CLEAR:
                found.append({"axis": "row", "at": int(y), "transparentPercent": round(share * 100, 1)})
    return found


def clear_depths(view, tile):
    """
    For each position along one side of a cell, how far in the last see-through pixel sits.

    Positions whose own line is mostly transparent are dropped: that is the perpendicular boundary's
    gap, and measuring the art's silhouette through it would report the gap twice. The search stops at
    half the cell, past which a reading belongs to the opposite side.
    """
    keep = view.mean(axis=0) <= SEAM_CLEAR
    band = view[:tile // 2, keep]
    if band.size == 0:
        return []
    return [int(np.max(np.where(band[:, i])[0]) + 1) if band[:, i].any() else 0
            for i in range(band.shape[1])]


def outline_colour(rgb, clear, tile):
    """The dark border the art draws around each cell, which is what a covered join should look like."""
    rows, cols = clear.shape[0] // tile, clear.shape[1] // tile
    ring = np.zeros(clear.shape, bool)
    for r in range(rows):
        for c in range(cols):
            y, x = r * tile, c * tile
            ring[y, x:x + tile] = ring[y + tile - 1, x:x + tile] = True
            ring[y:y + tile, x] = ring[y:y + tile, x + tile - 1] = True

    pixels = rgb[ring & ~clear]
    if len(pixels) == 0:
        return None
    lum = pixels @ LUMINANCE
    darkest = pixels[lum <= np.percentile(lum, OUTLINE_DARKEST_PERCENT)]
    mean = (darkest if len(darkest) else pixels).mean(axis=0).round().astype(int)
    return int(mean[0]) << 16 | int(mean[1]) << 8 | int(mean[2])


def derive_backing(im, tile):
    """
    The TILESETS `backing` entry for a tileset whose art stops short of its cells.

    Everything is measured off the packed sheet. Nothing here is copied from tiles-soil, whose numbers
    were chosen by eye for one particular set of art and mean nothing for anybody else's.
    """
    a = np.array(im)
    rgb, clear = a[:, :, :3].astype(int), a[:, :, 3] <= ALPHA_CUT
    rows, cols = clear.shape[0] // tile, clear.shape[1] // tile

    deepest, typical = [], []
    for r in range(rows):
        for c in range(cols):
            box = clear[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile]
            for view in cell_views(box).values():
                depths = clear_depths(view, tile)
                if depths:
                    deepest.append(max(depths))
                    typical.append(int(np.percentile(depths, SEAM_TYPICAL_PERCENT)))

    colour = outline_colour(rgb, clear, tile)
    if colour is None:
        return None

    inset = max(deepest) if deepest else 0
    # A strip may reach further out than the fill, never less far: the gap runs to the corner.
    return {"color": colour, "inset": int(inset),
            "seamInset": int(min(max(typical) if typical else 0, inset))}


def hex_colour(value):
    return "0x{:06x}".format(value)


def audit_packed_tileset(sheet_path, tile):
    """
    The seam audit, run on a packed tileset rather than on a generation.

    Separate from audit_tileset because it answers a question about a finished sheet - "does this one
    need a backing, and which one?" - which is worth asking of the tilesets already in public/assets
    and not only of art that has just been drawn.
    """
    im = load(sheet_path)
    clear = np.array(im.getchannel("A")) <= ALPHA_CUT
    if im.size[0] % tile or im.size[1] % tile:
        raise SystemExit("{} is {}x{}, which is not a whole number of {}px tiles"
                         .format(os.path.basename(sheet_path), im.size[0], im.size[1], tile))

    seams = boundary_seams(clear, tile)
    return {"sheet": os.path.basename(sheet_path),
            "width": int(im.size[0]), "height": int(im.size[1]),
            "columns": im.size[0] // tile, "rows": im.size[1] // tile,
            "seams": seams,
            "backing": derive_backing(im, tile) if seams else None}


def seam_note(seams, backing):
    """One line saying which boundaries are see-through and what will be done about it."""
    columns = [str(s["at"]) for s in seams if s["axis"] == "column"]
    rows = [str(s["at"]) for s in seams if s["axis"] == "row"]
    where = ", ".join(filter(None, ["columns " + ", ".join(columns) if columns else "",
                                    "rows " + ", ".join(rows) if rows else ""]))
    fix = ("a backing of {} at inset {}, seamInset {} is derived on accepting, which fills them"
           .format(hex_colour(backing["color"]), backing["inset"], backing["seamInset"])
           if backing else "no backing could be derived, because the sheet has no opaque outline")
    return ("{} cell boundar{} see-through ({}), so tiles drawn side by side show a hairline gap: {}"
            .format(len(seams), "y is" if len(seams) == 1 else "ies are", where, fix))


def audit_tileset(src_path, tile, entry, packed_path=None):
    """
    What is in a tileset. `entry` is what build_tileset already worked out, so the columns and rows
    reported are the ones it packed rather than a second opinion about the same image.

    The 3x3 flag is the one that matters. autotile() picks a piece by edge, top-left through
    bottom-right, so a tileset that is not nine pieces in that order cannot be laid into a level's
    ground layer: it would load, register, and then draw the wrong tile everywhere.

    Seams are the other finding, and they are deliberately NOT a flag. A tileset whose art stops a
    pixel short of its cells is perfectly good art with a hairline gap at every join, and the game
    already knows how to hide that - a `backing` in its TILESETS entry, which accepting derives from
    this audit. Refusing the asset over something the accept step fixes on its own would be refusing
    tiles-soil, which ships with exactly this defect and has looked right since the day it was drawn.
    So it is reported, loudly, with the boundaries named and the backing that will be used.
    """
    im, facts = measure(src_path)
    a = np.array(im.getchannel("A")) > ALPHA_CUT
    cols = runs_of(a.any(axis=0), merge_gap=6, min_length=9)
    rows = runs_of(a.any(axis=1), merge_gap=6, min_length=9)
    cells = [{"index": r * len(cols) + c, "width": int(cw[1] - cw[0] + 1),
              "height": int(rh[1] - rh[0] + 1)}
             for r, rh in enumerate(rows) for c, cw in enumerate(cols)]

    columns, row_count = (entry["columns"], entry["rows"]) if entry else (len(cols), len(rows))
    flags = background_flags(facts)
    if (columns, row_count) != (3, 3):
        flags.append("{}x{} tiles were found, not the 3x3 edge set the autotiler lays into a ground "
                     "layer (top-left, top, top-right / left, centre, right / bottom-left, bottom, "
                     "bottom-right)".format(columns, row_count))

    # Measured on the packed sheet, not the source: the gaps are made by where build_tileset cut the
    # cells and put them on an exact grid, so the source cannot answer this and only the output can.
    seams, backing, notes = [], None, []
    if packed_path:
        packed = audit_packed_tileset(packed_path, tile)
        seams, backing = packed["seams"], packed["backing"]
        if seams:
            notes.append(seam_note(seams, backing))

    return dict(facts, kind="tileset", expectedFrames=9, impliedFrames=columns * row_count,
                dividesEvenly=None, columns=columns, rows=row_count,
                cell={"width": tile, "height": tile}, frames=cells, flags=flags, notes=notes,
                seams=seams, backing=backing)


def audit_single(src_path, width, height):
    """
    What is in a still image: a parallax layer or a title image.

    The transparency rule the strips and tilesets live by is deliberately not applied here, and it is
    worth saying why rather than leaving it as an omission. A parallax layer is the back of the room.
    It is meant to be opaque, every background already in the game is, and flagging one for having a
    filled background would be flagging it for being correct.

    What does matter for a layer is the seam. ParallaxBackground draws it as a tileSprite and slides it
    sideways forever, so the right-hand column meets the left-hand column once per screen width; if
    those two columns do not match, the join travels across the screen for the whole level.
    """
    im, facts = measure(src_path)
    a = np.array(im.convert("RGB"), dtype=np.int16)
    seam = round(float(np.abs(a[:, 0, :] - a[:, -1, :]).mean()), 1)

    notes = []
    if width and (facts["width"] < width or facts["height"] < height):
        notes.append("the source is {}x{}, smaller than the {}x{} it will be drawn at, so it is being "
                     "scaled up and will look soft".format(facts["width"], facts["height"], width, height))
    if seam > SEAM_VISIBLE:
        notes.append("the left and right edges differ by {} of 255 on average, so the join will be "
                     "visible each time the layer repeats".format(seam))

    return dict(facts, kind="single", expectedFrames=1, impliedFrames=1, dividesEvenly=None,
                seamDifference=seam, cell={"width": width or facts["width"], "height": height or facts["height"]},
                frames=[{"index": 0, "width": facts["width"], "height": facts["height"]}],
                flags=[], notes=notes)


# ---------------------------------------------------------------- one asset, by parameters

ALIGNMENTS = ("bottom", "center", "strip", "norm")


def take(rest, name):
    """Pulls `--name value` out of the argument list, leaving the positional arguments behind."""
    if name not in rest:
        return None, rest
    at = rest.index(name)
    if at + 1 >= len(rest):
        raise SystemExit("{} needs a value".format(name))
    return rest[at + 1], rest[:at] + rest[at + 2:]


def run_single(argv):
    """
    --strip and --tileset: repack one image, described on the command line.

    Nothing is written anywhere near public/assets. The caller names an output directory and gets a
    packed sheet and an audit back; deciding whether that sheet is good enough to become an asset is
    somebody else's job, which is the point of handing back the audit rather than a verdict.
    """
    global OUT
    mode, rest = argv[0], list(argv[1:])
    as_json = "--json" in rest
    rest = [a for a in rest if a != "--json"]
    out, rest = take(rest, "--out")
    if out:
        OUT = out

    for d in ("sheets", "tiles", "bg", "ui"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    report = []

    if mode == "--strip":
        if len(rest) != 6:
            raise SystemExit("usage: --strip <src.png> <key> <frames> <fw> <fh> <align> --out <dir>")
        src, key = rest[0], rest[1]
        frames, fw, fh, align = int(rest[2]), int(rest[3]), int(rest[4]), rest[5]
        if align not in ALIGNMENTS:
            raise SystemExit('align must be one of {}, not "{}"'.format(", ".join(ALIGNMENTS), align))
        if frames < 1:
            raise SystemExit("a strip needs at least one frame")
        audit = audit_strip(src, frames, fw, fh)
        # Packed even when the audit flags it. A flagged sheet is exactly the thing somebody has to
        # look at before deciding, and refusing to produce it would leave them nothing to look at.
        entry = build_strip(src, key, frames, fw, fh, align, None, report)
        written = os.path.join(OUT, "sheets", key + ".png")
    elif mode == "--tileset":
        if len(rest) != 3:
            raise SystemExit("usage: --tileset <src.png> <key> <tile> --out <dir>")
        src, key, tile = rest[0], rest[1], int(rest[2])
        if tile < 1:
            raise SystemExit("a tile has to be at least one pixel")
        entry = build_tileset(src, key, tile, report)
        written = os.path.join(OUT, "tiles", key + ".png") if entry else None
        audit = audit_tileset(src, tile, entry, written)
    elif mode == "--seams":
        # No packing, no output: just look at a tileset that already exists and say whether the game
        # needs a backing to hide its joins, and which one. Run it over public/assets/tiles/*.png.
        if len(rest) != 2:
            raise SystemExit("usage: --seams <packed-tileset.png> <tile>")
        sheet, tile = rest[0], int(rest[1])
        if tile < 1:
            raise SystemExit("a tile has to be at least one pixel")
        packed = audit_packed_tileset(sheet, tile)
        if as_json:
            print(json.dumps(packed))
        else:
            print("{}: {}x{}, {}x{} cells of {}px".format(packed["sheet"], packed["width"], packed["height"],
                                                          packed["columns"], packed["rows"], tile))
            if not packed["seams"]:
                print("  no see-through cell boundaries: this tileset needs no backing")
            else:
                for seam in packed["seams"]:
                    print("  SEAM   {} {} is {}% transparent"
                          .format(seam["axis"], seam["at"], seam["transparentPercent"]))
                backing = packed["backing"]
                print("  backing: {{ color: {}, inset: {}, seamInset: {} }}"
                      .format(hex_colour(backing["color"]), backing["inset"], backing["seamInset"])
                      if backing else "  no backing could be derived: the sheet has no opaque outline")
        return 0
    elif mode == "--single":
        if len(rest) != 4:
            raise SystemExit("usage: --single <src.png> <key> <width> <height> --out <dir>")
        src, key, w, h = rest[0], rest[1], int(rest[2]), int(rest[3])
        audit = audit_single(src, w, h)
        entry = build_single(src, key, w, h)
        # build_single files a bg- key under bg/ and everything else under ui/, which is the rule the
        # manifest run has always used; the key decides, not a flag.
        written = os.path.join(OUT, "bg" if key.startswith("bg-") else "ui", key + ".png")
    else:
        raise SystemExit('unknown mode "{}". Try --strip, --tileset, --single or --seams, or no flags '
                         "at all for the manifest run.".format(mode))

    result = {"ok": entry is not None, "mode": mode.lstrip("-"), "key": key, "source": src,
              "written": written, "entry": entry, "audit": audit, "report": report}

    if as_json:
        print(json.dumps(result))
    else:
        print("{}: {}x{} source, {}% transparent -> {}".format(
            key, audit["width"], audit["height"], audit["transparentPercent"], written))
        for line in report + audit["notes"]:
            print("  note   " + line)
        for line in audit["flags"]:
            print("  FLAG   " + line)
    return 0 if entry else 1


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
    return 0


if __name__ == "__main__":
    # A leading flag means one asset, described on the command line. Anything else is the manifest
    # run, which is untouched by all of the above and still the only thing that writes manifest.json.
    sys.exit(run_single(ARGV) if SINGLE else main())