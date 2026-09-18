#!/usr/bin/env node
// Rewrites the "ground" tile layer of each level so every solid tile uses the right piece of the
// 3x3 soil edge set. Only the gids change. Which cells are solid never changes, so collision and
// layout stay exactly as they were, and running it again produces the same file.
//
//   npm run autotile                         every map in public/levels
//   npm run autotile -- path/to/map.json     just that map
//   npm run autotile -- --check              write nothing; exit 1 if any map is out of date
//
// Rules
//   - Only gid 0 is empty. Any other gid counts as solid, so you can paint with any soil tile in Tiled.
//   - A tile's piece comes from which of its four neighbours are solid. Cells outside the map count as
//     solid, so ground that runs off the edge of the level gets no border there.
//   - The set is 3 columns x 3 rows: top-left, top, top-right / left, centre, right / bottom-left,
//     bottom, bottom-right. A one-tile-thick platform uses the top row; a one-tile-wide column uses
//     the centre column.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { autotile, serialize } from './autotile-core.mjs';

const LEVEL_DIR = 'public/levels';
const LAYER_NAME = 'ground';
const TILESET_NAME = 'tiles-soil';

function processFile(file, checkOnly) {
  const original = fs.readFileSync(file, 'utf8');
  const map = JSON.parse(original);

  const layer = map.layers.find((l) => l.type === 'tilelayer' && l.name === LAYER_NAME);
  if (!layer) throw new Error(`${file}: no tile layer named "${LAYER_NAME}"`);
  const tileset = map.tilesets.find((t) => t.name === TILESET_NAME);
  if (!tileset || tileset.columns !== 3 || tileset.tilecount < 9) {
    throw new Error(`${file}: needs a "${TILESET_NAME}" tileset block with columns 3 and tilecount 9`);
  }

  const before = layer.data;
  const after = autotile(before, layer.width, layer.height, tileset.firstgid);

  // Guard the promise in the header: the solid/empty pattern must come out untouched.
  const pattern = (data) => data.map((gid) => (gid === 0 ? '0' : '1')).join('');
  if (pattern(before) !== pattern(after)) throw new Error(`${file}: solid pattern changed, refusing to write`);

  layer.data = after;
  const output = serialize(map);
  const changed = output !== original;
  const solidCount = after.filter((gid) => gid !== 0).length;
  const retiled = after.filter((gid, i) => gid !== before[i]).length;

  if (changed && !checkOnly) fs.writeFileSync(file, output);
  const status = !changed ? 'already up to date' : checkOnly ? 'OUT OF DATE' : 'written';
  console.log(`${file}: ${solidCount} solid tiles, ${retiled} gids changed, ${status}`);
  return changed;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const named = args.filter((a) => !a.startsWith('--'));
  const files = named.length ? named : fs.readdirSync(LEVEL_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(LEVEL_DIR, f));

  let outOfDate = 0;
  for (const file of files) {
    if (processFile(file, checkOnly)) outOfDate += 1;
  }
  process.exit(checkOnly && outOfDate > 0 ? 1 : 0);
}

// Re-exported so this file stays the one place the command line reaches for.
export { autotile, serialize };

// Run only when called from the command line, so the functions above can be imported elsewhere.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
