# The level editor

```
npm run editor      # opens http://localhost:5173/editor.html
```

It is a development tool. It is not built, not deployed, and the routes it saves through only exist
while the dev server is running. `npm run build` produces the game and nothing else.

**It has to be the Vite dev server.** Opened through anything else - VS Code's Live Server, a plain static
server, the file system - the level files are not where the editor looks for them and the save and delete
routes do not exist at all, so it would come up looking fine and quietly write nothing. It checks, and
says so on the page instead.

## What it edits

One ground layer and one object layer, which is all a Grow Op level has. There is no layer list and no
tile-piece picker on purpose: the editor never chooses which of the nine pieces a cell gets. Which
tileset a level is drawn with is one field in its index entry, not something painted per cell.

It stores **solid or empty per cell** and nothing more. Which of the nine soil pieces a solid cell is
drawn with — and written with — comes from `autotile()` in `tools/autotile-core.mjs`, the same function
`npm run autotile` uses. The editor and the command line therefore cannot disagree, and a level saved
from the editor is already canonical: `npm run autotile -- --check` has nothing to say about it.

Everything in the file the editor has no opinion about — the map header, the tileset block, layer and
object ids, anything Tiled wrote — is carried through untouched. Loading a level and saving it again
with no edits gives back a byte-identical file.

## Controls

| | |
| --- | --- |
| Left drag | paint solid |
| Right drag | erase |
| Shift + drag | filled rectangle |
| Middle drag, or Space + drag | pan |
| Wheel | zoom, 0.5x to 4x, around the pointer |
| Click a type in the palette | arm it, then click the canvas to place one |
| Delete this level | remove it and its entry, after typing the key |
| Drag an object | move it |
| Alt while placing or dragging | ignore the grid |
| Delete | remove the selected object |
| Ctrl+Z / Ctrl+Y | undo / redo, 100 steps, tiles and objects together |

Objects snap to the cell under the pointer, and where in the cell depends on the type: things that stand
on the ground (goal-jar, spider-mite, root-rot) sit on the floor of the cell, things that hang in the air
(water-drop, light-orb, nutrient, fungus-gnat) are centred in it. That reproduces how world1-1 was placed
by hand, and it is how GameScene reads them back.

The ruler along the top and down the left counts **tiles**. The readout in the corner gives both, because
object positions in the JSON are **pixels**: a tile is 32px.

## Saving

**Save** posts to `/api/level`, a dev-server-only route that writes `public/levels/<name>.json`. A name
may only contain `a-z`, `0-9` and dashes; anything else is refused, because the name becomes a file path.

**Download** gives you the same bytes as a file, for when the dev server is not the one serving the
editor, or the route is unavailable.

**Play** opens the game in a new tab at `?level=<name>`. In development that starts the named level
instead of `FIRST_LEVEL`, and a level that is not registered in `LEVELS` yet gets an entry made for it on
the spot, so something you have only just drawn is playable immediately. In a production build the whole
block is compiled out and the query does nothing.

**Load** fetches `public/levels/<name>.json`. If there is no such level it starts an empty 120x17 map
under that name, which is how you begin a new one.

## Generating a level

Describe a level in the **Generate** panel and a model draws one. What comes back is a draft on the
canvas, never a file: it is not saved, not registered, and not playable until you save it yourself.

```
ANTHROPIC_API_KEY=sk-ant-...        # in .env, which is gitignored. See .env.example
ANTHROPIC_MODEL=claude-opus-5       # no default: unset fails, naming this variable
```

Both are read by the dev server, in `vite.config.js`, and by nothing else. They are deliberately **not**
`VITE_` prefixed, because that prefix is exactly what would put them in the browser bundle. The key is
used to make one HTTPS call from the machine running the dev server; it is never sent to the page, never
logged, and `npm run build` contains no trace of it, no generate route, and no editor at all.

There is no fallback model on purpose. A guessed model is a bill for a reply in the wrong shape, so an
unset `ANTHROPIC_MODEL` is an error that names the variable. Restart the dev server after editing `.env`.

### What the model is told

The prompt is built from `constants.js` at the moment you press the button, so it is always describing
the game as it is now. It is given the run speed, the jump speed and gravity, and then the three numbers
that follow from them:

```
peak jump height = jump speed^2 / (2 * gravity)   3.67 tiles
airtime          = 2 * jump speed / gravity       1.02 s
horizontal reach = run speed * airtime            7.03 tiles
```

and told to build to **3 tiles of climb and 5 tiles of gap** — under what the physics allow, so a jump is
something a person can make while also watching an enemy. Retune `JUMP_VELOCITY` and every one of those
numbers moves on the next request. There is not a second copy of the physics anywhere in the prompt.

### What comes back

One character per tile, one line per row, in a fenced block. Everything written around the block is
ignored, so a model that explains itself first has done nothing wrong.

| | | | |
| --- | --- | --- | --- |
| `#` solid | `P` player-start | `W` water-drop | `M` spider-mite |
| `.` empty | `J` goal-jar | `L` light-orb | `G` fungus-gnat |
| | | `N` nutrient | `R` root-rot |

That legend is checked against the game's own object list when the module loads, so an object added to
the game and not to the legend is an error at startup rather than a type no generated level can contain.
A letter outside the legend is refused and named; it is never dropped.

The reply is then held to the size that was asked for, with one deliberate piece of give. Counting to 120
seventeen times over is the thing a model is least reliable at, and a 120x17 generation used to be thrown
away in full because row 14 came back 119 characters — a paid call and several minutes of thinking, gone
over one character. So:

| What came back | What happens |
| --- | --- |
| a row short by up to 10% of the width | **padded on the right with empty space**, and reported |
| a row short by more than that | refused, naming the row and both lengths |
| a row longer than the width | refused, naming the row and the excess — never trimmed |
| fewer rows, and the first row is all empty | **empty rows added at the top**, and reported |
| fewer rows, and the first row has anything in it | refused, naming both heights |
| fewer rows by more than 10% of the height | refused, naming both heights |
| more rows than asked for | refused, naming both heights |

**Padding cannot make an impossible level look possible.** A pad only ever adds empty space: it cannot
add ground, so it cannot bridge a pit the model left, and it cannot add an object, so it cannot put back
a jar the model forgot. What it *can* do is leave a hole where a floor was meant to run to the edge — so
it fails in the safe direction, and the reachability solver catches it exactly as it catches a badly
drawn one. Nothing below is loosened for a padded level.

### A missing row is not a missing character

They look like the same mistake and they are not, so they are not treated the same way.

The rest of a short row is still there. Row 14 arriving at 119 of 120 means the 119 characters are the
ones that were drawn and the pad can only be the empty cells at the end — the level is unchanged. A
layout arriving at 16 rows of 17 says nothing of the kind: **a whole line of the level is gone and
nothing in what came back says which line it was.** Put a row back at the top of a layout that dropped
one from its middle and every row below it moves down one tile. That level has the right number of
everything, passes the editor's checks, passes the solver, and is the wrong level by 32 pixels
everywhere — which is worse than a refusal, because nothing will ever tell you.

So the top is padded in the one case where it can be shown to be the right place: **the layout opens
with an entirely empty row.** That is a model that was still drawing sky when it stopped, and sky is
what gets added back. Anything else is refused and says why. The same 10% that bounds a short row bounds
a short layout on top of that, because eight rows missing is a different level however it begins.

**One case this does not catch,** and it is worth knowing: a layout that opens with sky *and* lost a row
from the middle is still padded at the top, and still shifts. Nothing in the returned text distinguishes
it from a layout that stopped short. Closing it properly would mean asking the model to number its rows,
so a gap is visible in what arrives rather than inferred from what does not.

**And no pad is silent.** Every one is listed in the draft notes with the row and how much:

```
+ Row 14 came in 119 characters, 1 short of 120, and was padded on the right with 1 empty cell.
+ The layout was 16 rows, 1 short of 17, and its first row was empty - so it stopped short of the sky,
  and 1 empty row was added at the top: row 0 is air the model did not draw.
```

Those lines also go back with **Regenerate**, so a model that is consistently short is told so while
there is still a session left to correct it in. A level that was quietly repaired is a level that is
subtly not the one on the screen, which is the one outcome worse than a refusal.

A row that is *over* long is a different thing and is always refused: the characters that would be cut
off the end are real content, and there is no way to know from here which of them was surplus. Too many
rows is refused for the same reason. The refusal names every wrong row at once, not just the first.

### What gets checked before it loads

In this order, cheapest first:

1. **It parses.** The right size — after any padding above — and nothing outside the legend.
2. **The editor's own checks,** the same ones in the Checks panel: one player-start, at least one
   goal-jar, nothing inside a wall, nothing under the map, and a player-start standing on ground.
3. **It can be played.** The solver walks it (below). Every object has to be reachable, and so does the jar.

A padded level goes through 2 and 3 exactly as an unpadded one does. Padding fixes transcription, not
design, so none of these give an inch for it.

**A level that fails any of those is not loaded.** It is shown as a thumbnail with the stranded objects
ringed in red and listed underneath, and the only things offered are Regenerate and Discard. Regenerate
sends the layout back with exactly what was wrong with it — and with anything that had to be padded — and
asks for another. Nothing retries on its own: one request per press, the button is disabled while one is
in flight, and each press is a paid API call to the model in `.env`. A 120x17 level takes a model a few
minutes to think through. The reply is kept either way, so the second look at it is free (below).

**Use this level** puts the draft on the canvas as unsaved work and renames the level box to `draft` (or
`draft-2`, and so on) so the next Save cannot land on top of the level you had open. If what is on the
canvas has unsaved changes, it asks first. Save is still the only thing that writes a file.

### Re-parsing a saved reply is free

Every reply is written to **`.level-raw/`** — gitignored, named from the description and the minute —
before anything is done with it, along with the request that produced it. It is written *before* the reply
is judged, which is the point: the generation worth keeping is the one that is about to fail.

So a generation that was refused is never a generation that has to be bought again. Pick it in **Saved
replies** and press **Re-parse the selected one**. That route has no API key and makes no call — it reads
the file off the disk and hands back what is already in it — and the reply then goes through the identical
path a fresh one takes: parse, the editor's own checks, the solver. Nothing is treated more kindly for
having been paid for once already.

```
.level-raw/a-flooded-basement-grow-202609191834.json
  { at, description, size, previous, model, usage, seconds, stop, reply }
```

Padding is the fix for the failure that was actually happening; this is the fix for the next one. When
whatever refused a reply is changed — a parser rule, a check, the solver — the replies it refused are
still on disk and can be run through the new code for nothing.

## Generating art

Describe an asset in the **Art** panel and a model draws one. What comes back is repacked by
`tools/repack.py`, measured, and shown to you at 4x with every frame boxed. Nothing reaches
`public/assets` until you accept it.

```
OPENAI_API_KEY=sk-proj-...          # in .env, which is gitignored. See .env.example
OPENAI_IMAGE_MODEL=gpt-image-1      # no default: unset fails, naming this variable
```

Read by the dev server and by nothing else, deliberately **not** `VITE_` prefixed, exactly like the two
level-generating variables above. `npm run build` contains no key, no art route and no panel.

> Note the spelling: `OPENAI_IMAGE_MODEL`. An earlier `.env` here had `OPENAI_IMAGE_MODAL`, which is
> nothing at all, and a variable that is nothing looks exactly like a variable that is unset. If the
> route finds the misspelling and not the real name it says so by name rather than making you guess.

### The kinds, and what accepting one does

| Kind | Lands in | Accepting registers | Usable straight away? |
| --- | --- | --- | --- |
| Parallax background | `public/assets/bg/` | `PARALLAX` in `constants.js`, with your scroll factor | yes |
| Tileset | `public/assets/tiles/` | `TILESETS` in `constants.js`, and the tileset dropdown | yes |
| Enemy | `public/assets/sheets/` | nothing | **no** — see below |
| Pickup | `public/assets/sheets/` | nothing | **no** |
| Effect | `public/assets/sheets/` | nothing | **no** |

The first two are data all the way down, so accepting really does finish them: a registered tileset is
in the dropdown after the reload, and a registered background is on screen the next time a level starts.

The last three are not, and the panel says so instead of pretending otherwise. **Art is the part of a new
enemy a panel can finish.** What it cannot write is the animation entry that makes the sheet load at all,
the class that makes the thing move, and — the one that goes wrong quietly — the line in
`objectValues()` in `src/state/levelScore.js`. An enemy or pickup missing from that table is worth zero,
which lowers the maximum score of **every level containing one**, which hands out grades nobody earned.
`npm run check-levels` fails on it and so does the game's own console, but the cheapest place to find out
is when the art lands, so accepting names the file.

Accepting an enemy prints the whole list: `animations.js`, the enemy class, `levelScore.js`,
`format.js` for the editor's palette, and `parse.mjs` for the level generator's legend.

### What the model is told

Two halves, and they are not equal. Your description is the **subject**. The **house style** is
`tools/generate/art-prompt.mjs`, it is the same block every time, it goes last, and it says in so many
words that it overrides anything in the description that contradicts it. A description reading "smooth
3D render on a white background" is a description of a spider mite that gets drawn in this style anyway.

That is not tidiness. Every rule in the style block is load-bearing downstream: transparent background,
hard pixel edges, no anti-aliasing, a 1px dark outline, the project's palette, evenly spaced frames with
transparent columns between them, feet on the bottom row. `repack.py` **finds frames by looking for the
transparent columns between them** and scales each frame off its own alpha bounds. Art on a white
background does not come out as a wonky sprite; it comes out as four crops of a white rectangle.

The palette in that file was sampled from the PNGs already in `public/assets` — the most common opaque
colours across every sheet and tileset — rather than chosen.

### What comes back, and the audit

Every generation is measured before you can do anything with it. All of it is read off the real PNG:

| | |
| --- | --- |
| image | the dimensions that actually came back |
| alpha channel | whether there is one at all |
| transparent | what percentage of the image is nothing |
| width / frames | whether the width divides evenly by the frame count |
| frames found | how many separate shapes are in the strip, against how many were asked for |
| grid | for a tileset, the columns and rows that were found |
| edge seam | for a background, how far its left and right edges are from matching |
| cell joins | for a tileset, which cell boundaries of the packed sheet are see-through |
| cell | the frame box the art is being packed into |
| content | the bounding box of each frame, so a frame far bigger than its cell is visible |

**Four things are flags, and a flagged asset cannot be accepted.** Not greyed out with an override: the
Accept button is not offered, and the route refuses it too, from its own record of the audit rather than
from anything the page sends. They are: no alpha channel; under 20% transparent; a width that does not
divide by the frame count; and a frame count that is not the one asked for. A tileset that is not 3x3
is also a flag, because the autotiler lays nine pieces by edge and anything else draws the wrong tile
everywhere.

Everything else is shown but does not block — a frame bigger than its cell is scaled down to fit,
which is usually fine; a background whose edges do not match will show its join when it repeats; and a
tileset with see-through cell boundaries gets a backing derived for it on accepting, which is the next
section.

### Seams, and the backing that hides them

A tileset is packed onto an exact grid, and a tile whose art stops a pixel short of its cell leaves a
gap. The game draws tiles edge to edge, so that gap is a hairline of the *parallax background* showing
through the ground at every join — a grid of thin bright lines over the whole floor.

This is not a rare defect. `tiles-soil`, drawn by hand long before any of this existed, has it: rows 31
and 63 of its packed sheet are over 95% transparent. It has always looked right in game because its
`TILESETS` entry carries a **`backing`**, which `GameScene.addGroundBacking` paints behind the ground.

So the audit measures it. For every interior cell boundary in the *packed* sheet — both pixel lines,
separately, because they belong to different tiles — it reports the share of that line which is
transparent. More than half and it is a seam, named by axis and pixel position:

```
cell joins    SEE-THROUGH at columns 32, 63; rows 31, 32, 64
```

**A seam is not a flag and does not block acceptance.** It cannot be, or the audit would be refusing
`tiles-soil`. It is a finding, shown in its own colour, saying which boundaries are see-through and what
will be done about it — and **accepting derives the backing and registers it**, rather than writing an
entry that leaves the first level using it looking broken.

The three numbers are measured off the sheet. None of them is copied from `tiles-soil`, whose pair was
chosen by eye for one particular set of art and means nothing for anybody else's:

| | |
| --- | --- |
| `color` | the mean of the darkest tenth of the opaque pixels on the cell outlines — the tile's own border, so a covered join reads as the tile continuing rather than as a painted line. The single darkest pixel is one stray anti-aliased corner and comes out far too dark. |
| `inset` | how far to hold the fill back from a side facing open air: the **deepest** any pixel along that side is see-through. The fill must not appear anywhere behind the tile's own silhouette, because one visible pixel of it is a dark halo along the ground. |
| `seamInset` | how far to hold the thin join strips back from the same side: the depth **most** of that side is see-through. The gap itself runs right out to the corner, so a strip held back as far as `inset` would leave the last few pixels of every join showing. |

That last distinction is the whole reason there are two numbers. The derivation can be checked against
the one example nobody has to take on trust — it reads 16 and 3 off `tiles-soil`, where a person tuning
by eye chose 14 and 4.

You can run it over a tileset that already exists, which is how `tiles-hydro-grate` got the backing in
its entry:

```
$ python3 tools/repack.py --seams public/assets/tiles/tiles-hydro-grate.png 32
tiles-hydro-grate.png: 96x96, 3x3 cells of 32px
  SEAM   column 32 is 85.4% transparent
  SEAM   column 63 is 85.4% transparent
  SEAM   row 31 is 84.4% transparent
  SEAM   row 32 is 85.4% transparent
  SEAM   row 64 is 87.5% transparent
  backing: { color: 0x000000, inset: 2, seamInset: 1 }
```

Of the tilesets in `public/assets/tiles`, `tiles-soil`, `tiles-hydro-grate` and `tiles-pot` have seams;
`tiles-stone` and `tiles-tent-floor` are solid to their cell edges and need no backing. Only the first
two are registered with one, because the other three are three-tile sets no level uses.

### Getting it wrong is free the second time

Every image the API returns is written to **`.art-raw/`** — gitignored, named with the key and the
minute — before anything is done to it. The frame count is the thing that goes wrong, and without the
raw strip the only way to fix a wrong one is to pay for the picture again.

So: pick the raw generation in **Raw generations**, change Frames or the cell size, and press **Repack**.
No API call, no money. Repack as many times as you like until the audit is clean.

```
.art-raw/thrips-walk-202609191834.png          the generation, untouched
.art-raw/repacked/thrips-walk-.../sheets/...   each repack of it, with the audit beside it
```

### Cost, and what does not happen

One press of **Generate this asset** is one paid image generation, to the model in `.env`. The button is
disabled while one is in flight and the route refuses a second at the same time. **Nothing retries on its
own.** A key that already exists is refused before the request is made, naming the file in the way, so a
name that was already taken never costs anything. Existing art is never overwritten — re-exporting is
something you do on purpose with the manifest run, not something a panel does while you try out names.

### Accepting reloads the editor

Registering a tileset or a background edits `constants.js`, which this page imports, so Vite reloads the
editor — and that reload is *how* a new tileset reaches the dropdown. The report telling you what landed
survives it and is shown again on the way back in.

### The repacker

`tools/repack.py` is the repacker, and there is only one of it. The dev server shells out to it rather
than reimplementing anything in JavaScript, the same way the editor imports `autotile-core.mjs` instead
of keeping a second autotiler. Two implementations of "where does a frame start" would disagree
eventually, and the day they disagree is the day generated art stops matching the art beside it.

It needs Python with `numpy` and `Pillow`. `python3` is tried first, then `python`, then `py`, and each
is tried by whether it can import those two — so a missing dependency is a sentence up front rather than
a stack trace later.

```
pip install numpy pillow
```

The manifest run is untouched by any of this:

```
python3 tools/repack.py <source-art-dir> <output-dir>     # the whole known asset list, as always
python3 tools/repack.py --strip   <src.png> <key> <frames> <fw> <fh> <align> --out <dir> [--json]
python3 tools/repack.py --tileset <src.png> <key> <tile> --out <dir> [--json]
python3 tools/repack.py --single  <src.png> <key> <width> <height> --out <dir> [--json]
python3 tools/repack.py --seams   <packed-tileset.png> <tile> [--json]
```

`--seams` packs nothing: it reads a tileset that already exists and reports its see-through cell
boundaries and the backing that would hide them. The other three single-asset modes are what the Art
panel uses, and they exist because an asset nobody has
made yet has no line in the manifest by definition. They call the same `build_strip`, `build_tileset`
and `build_single`, over the same `col_blobs`, `content_box`, `clean_alpha` and `place`, so for the same
inputs they produce byte-identical output to the manifest run. `align` is `bottom` (feet on the floor),
`center`, `strip` (keep vertical motion within the strip) or `norm` (rescale every frame to one height).

## The level list

`public/levels/index.json` is the list of levels, in order, and it is data - adding a level never means
editing source. `src/config/levels.js` turns it into the `LEVELS` and `FIRST_LEVEL` the game has always
used, and the game fetches it before it starts.

```json
[
  {"key":"world1-1","name":"World 1-1","label":"1-1","tileset":"tiles-soil"}
]
```

Only `key` is required. `name` falls back to the key, `label` to the key's trailing segment, `tileset` to
`tiles-soil`. Tileset is a dropdown built from `TILESETS` in `constants.js`, not free text: a typo in a
box would only show up later as a level that will not build. The Art panel appends to that list when a
generated tileset is accepted, so the dropdown grows without anyone editing source. A level's file is
always `levels/<key>.json`, worked out rather than stored, so a key and its file cannot drift apart.

A level's map file carries exactly one tileset block. That block is the *grid* — nine tiles, three
columns, starting at gid 1 — and the tileset in the index is which *image* gets painted onto it. Both
`GameScene` and `npm run autotile` take that single block and check it **by its shape**, never by its
name: three columns and nine or more tiles is a block the autotiler can write into, whatever it happens
to be called. The editor writes `tiles-soil`, and a map exported from Tiled under any other name loads,
renders and autotiles the same.

That agreement is deliberate and was not always true. `autotile.mjs` used to look the block up by the
literal name `tiles-soil` and throw otherwise, while `GameScene` took the first block whatever its name
— so a Tiled-authored map would have rendered perfectly in game and then failed `npm run autotile`. A
map with **more than one** tileset block is refused by name, by both, because the autotiler writes gids
from a single `firstgid` across the whole layer and a second block's range would be quietly overwritten.

The order is the order of the game. The first entry is where a new game starts, and each level's Next is
the one after it, with the last wrapping back to the first. An entry can carry its own `next` to break
out of that.

**Saving a level registers it.** If its key is not in the list yet, an entry is appended using the Name,
Label and Tileset boxes in the panel. An entry that already exists is never touched - not its position,
not its fields.

**Level order** is the panel for changing existing entries: reorder with the arrows, edit a name, label
or next, then press *Save level order*. That rewrites the whole file, which is why it is its own button
and not something that happens when you save a level.

The route refuses a key that is not `a-z`, `0-9` and dashes, and refuses to write a list naming a level
whose file is not there.

**Delete this level** removes the entry and `public/levels/<key>.json`, in that order - so if the file
delete fails, the worst case is an orphan map nobody reads rather than an entry pointing at nothing. It
asks you to type the level key first, because it throws away authored work and there is no undo.

Two deletes are refused:

- the last remaining level, since a game with no levels cannot start;
- a level another entry's **explicit** `next` points at. The refusal names that entry, so you can change
  it in Level order and try again. An entry whose next is implicit needs nothing: it means "the one after
  me", which the shortened list re-derives.

## When a level file is missing

An index entry with no map behind it is handled differently depending on who is looking.

**In development it stops the game**, naming the file, because it is a mistake somebody is making right
now and the fastest thing is to say so.

**In a production build it is skipped.** The game boots with the levels it does have and writes one
`console.warn` naming what it dropped. A deploy that went out with one file missing should cost that one
level, not the whole game. If *nothing* usable is left it still stops, because there is genuinely nothing
to play.

A dropped level does not break the chain: implicit `next` values re-derive over the survivors, and an
explicit `next` pointing at a dropped level moves on to whatever survived after it.

## The checks panel

Live, and it never blocks a save — a level part-way through being built is expected to be broken.

- exactly one `player-start`
- at least one `goal-jar`
- no object with its centre inside a solid tile
- no object below the bottom of the map
- `player-start` standing on solid ground

It judges positions the way GameScene does: an object's position is the middle of its rectangle, and
where it meets the ground is the bottom of that rectangle, or the bottom of the cell a point sits in.

Reachability is not in this list. It costs a fraction of a second rather than nothing, and half a level
is unreachable while you are still drawing the other half, so it would be crying wolf all day. It runs
where a level is claimed to be finished instead: on anything generated, and on demand over every level
with `npm run check-levels -- --reach`.

`world1-1.json` passes these. It did not before: `fungus-gnat` id 48 sat inside the solid tile at column
93, row 10, and was moved up into clear air.

## Can it be played?

`src/editor/reachability.mjs` answers one question: starting from `player-start`, can the player get to
everything in this level? It is a breadth-first flood over the tiles that can be stood on, with real jump
arcs flown out of each one — integrated in small steps and resolved one axis at a time, the way Arcade
moves a body — and it reports which objects a body actually overlaps along the way.

It runs on every generated level, and over every level on disk with:

```
npm run check-levels -- --reach
```

```
world1-1  (World 1-1)  maximum 2910
  reachable       34/34 pickups, 12/12 enemies, goal-jar yes   (from 3,15; 123 stances, 0.2s)
```

A stranded object fails the run, because a maximum score nobody can reach is the same bug as a maximum
score that is wrong — and the grade it hides in is Exotic, which needs 90% of the level.

**It is deliberately pessimistic.** The two mistakes it could make do not cost the same: a false
"unreachable" costs somebody an edit they did not need to make, while a false "reachable" ships a level
with a jar nobody can touch. So it uses the small body, which is the form the player always has and the
one that reaches least far up; it flies a fixed spread of take-offs rather than assuming perfect air
control; it treats enemies as standing still where they were placed, when patrolling can only bring them
closer; and it ignores the leaf slash, which reaches further than the body does.

What it does not know about: bouncing off an enemy's head, which is a real route, so a level that needs
one reads as unreachable here. Nothing in the game has moving platforms, so nothing else is missing.

On the physics as they stand it clears gaps up to 6 tiles and climbs of up to 3, which is why the model
is asked for 5 and 3.

## Map size

The W and H boxes resize the map. Growing adds empty cells and keeps everything. Shrinking asks first,
naming how many solid tiles and objects would be left outside, and a resize is one undo step like any
other change.

## Where things are

| File | |
| --- | --- |
| `editor.html` | the page, its layout and its styles |
| `src/editor/main.js` | canvas, render loop, input, saving, the dev test seam |
| `src/editor/Grid.js` | the solid/empty grid, and the undo stack for the whole editor |
| `src/editor/Objects.js` | placing, picking up, moving and removing the named points |
| `src/editor/Palette.js` | the left panel: tools, types, size, checks |
| `src/editor/format.js` | reading and writing Tiled JSON, and where each object type sits in a cell |
| `src/editor/validate.js` | the checks above |
| `src/editor/reachability.mjs` | the solver: can a player get to all of it? |
| `src/editor/Generate.js` | the Generate panel: description, request, verdict, accept or discard |
| `src/editor/Art.js` | the Art panel: kind, description, generate, audit, preview, accept or discard |
| `tools/generate/prompt.mjs` | what the model is told for a level, built from the live constants |
| `tools/generate/art-prompt.mjs` | what an image model is told, and what each asset kind means downstream |
| `tools/repack.py` | the repacker: the manifest run, and one asset at a time for the Art panel |
| `tools/generate/parse.mjs` | the ASCII layout to a grid and a list of objects |
| `.env.example` | the four variables generating needs, and where they are read |
| `.art-raw/` | gitignored: every raw generation, kept so a repack never costs a second one |
| `.level-raw/` | gitignored: every level reply and the request behind it, kept so a re-parse is free |
| `tools/autotile-core.mjs` | `autotile()` and `serialize()`, shared with the command line |
| `vite.config.js` | the dev-only save, generate and art routes, and the build that deliberately excludes the editor |
| `public/levels/index.json` | the level list, in order |
| `src/config/levels.js` | turns that list into `LEVELS` and `FIRST_LEVEL`, and fails loudly if it cannot |
