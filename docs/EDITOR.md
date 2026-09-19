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

One ground layer and one object layer, which is all a Grow Op level has. There is no tileset picker and
no layer list on purpose: the soil set is the only tileset, and the editor never picks a tile piece.

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

The reply is then held to the size that was asked for — a row of the wrong width, or the wrong number of
rows, is a layout the model lost count in, and the parts of it that are right cannot be told from the
parts that are not. The refusal names every row that is wrong at once, and those rows are what gets sent
back with **Regenerate**.

### What gets checked before it loads

In this order, cheapest first:

1. **It parses.** The right size, and nothing outside the legend.
2. **The editor's own checks,** the same ones in the Checks panel: one player-start, at least one
   goal-jar, nothing inside a wall, nothing under the map, and a player-start standing on ground.
3. **It can be played.** The solver walks it (below). Every object has to be reachable, and so does the jar.

**A level that fails any of those is not loaded.** It is shown as a thumbnail with the stranded objects
ringed in red and listed underneath, and the only things offered are Regenerate and Discard. Regenerate
sends the layout back with exactly what was wrong with it, and asks for another. Nothing retries on its
own: one request per press, the button is disabled while one is in flight, and each press is a paid API
call to the model in `.env`. A 120x17 level takes a model a few minutes to think through.

**Use this level** puts the draft on the canvas as unsaved work and renames the level box to `draft` (or
`draft-2`, and so on) so the next Save cannot land on top of the level you had open. If what is on the
canvas has unsaved changes, it asks first. Save is still the only thing that writes a file.

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
`tiles-soil`. Tileset is a dropdown built from `TILESETS` in `constants.js`, not free text: the tilesets
are a fixed set the game knows how to load, and a typo only shows up later as a level that will not build. A level's file is always `levels/<key>.json`, worked out rather than stored, so a key and
its file cannot drift apart.

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
| `tools/generate/prompt.mjs` | what the model is told, built from the live constants |
| `tools/generate/parse.mjs` | the ASCII layout to a grid and a list of objects |
| `.env.example` | the two variables generating needs, and where they are read |
| `tools/autotile-core.mjs` | `autotile()` and `serialize()`, shared with the command line |
| `vite.config.js` | the dev-only save and generate routes, and the build that deliberately excludes the editor |
| `public/levels/index.json` | the level list, in order |
| `src/config/levels.js` | turns that list into `LEVELS` and `FIRST_LEVEL`, and fails loudly if it cannot |
