# The level editor

```
npm run editor      # opens http://localhost:5173/editor.html
```

It is a development tool. It is not built, not deployed, and the route it saves through only exists
while the dev server is running. `npm run build` produces the game and nothing else.

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
`tiles-soil`. A level's file is always `levels/<key>.json`, worked out rather than stored, so a key and
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
whose file is not there. If a level file does go missing while its entry remains, the game says so on the
page at startup and does not start - there is no way to remove an entry from the editor yet, so that is
currently a hand edit of `index.json`.

## The checks panel

Live, and it never blocks a save — a level part-way through being built is expected to be broken.

- exactly one `player-start`
- at least one `goal-jar`
- no object with its centre inside a solid tile
- no object below the bottom of the map
- `player-start` standing on solid ground

It judges positions the way GameScene does: an object's position is the middle of its rectangle, and
where it meets the ground is the bottom of that rectangle, or the bottom of the cell a point sits in.

`world1-1.json` passes these. It did not before: `fungus-gnat` id 48 sat inside the solid tile at column
93, row 10, and was moved up into clear air.

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
| `tools/autotile-core.mjs` | `autotile()` and `serialize()`, shared with the command line |
| `vite.config.js` | the dev-only save routes, and the build that deliberately excludes the editor |
| `public/levels/index.json` | the level list, in order |
| `src/config/levels.js` | turns that list into `LEVELS` and `FIRST_LEVEL`, and fails loudly if it cannot |
