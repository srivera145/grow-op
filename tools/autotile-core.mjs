// The two pure functions behind the level format: which tile piece a solid cell gets, and how a map is
// written back out. No file system, no process - so the browser level editor and the `npm run autotile`
// command line run exactly the same code and cannot drift apart. tools/autotile.mjs is the command line
// wrapper around this; src/editor/format.js is the editor's.

/**
 * New gids for a row-major tile grid. `data` is not modified.
 *
 * Only gid 0 is empty; any other gid counts as solid, so a map can be painted with any soil tile and
 * still come out right. A tile's piece comes from which of its four neighbours are solid, and cells
 * outside the map count as solid, so ground running off the edge of the level gets no border there.
 *
 * The set is 3 columns x 3 rows: top-left, top, top-right / left, centre, right / bottom-left, bottom,
 * bottom-right. A one-tile-thick platform uses the top row; a one-tile-wide column uses the centre column.
 */
export function autotile(data, width, height, firstGid) {
  const solid = (col, row) => col < 0 || row < 0 || col >= width || row >= height || data[row * width + col] !== 0;

  return data.map((gid, index) => {
    if (gid === 0) return 0;
    const col = index % width;
    const row = Math.floor(index / width);
    const up = solid(col, row - 1);
    const down = solid(col, row + 1);
    const left = solid(col - 1, row);
    const right = solid(col + 1, row);

    const setRow = !up ? 0 : !down ? 2 : 1;
    const setCol = !left && right ? 0 : left && !right ? 2 : 1;
    return firstGid + setRow * 3 + setCol;
  });
}

/** Stable, diff-friendly JSON: one map row per line in tile layers, one object per line in object layers. */
export function serialize(map) {
  const blocks = [];
  const stash = (lines) => {
    blocks.push(lines.length ? `[\n        ${lines.join(',\n        ')}\n      ]` : '[]');
    return `@@block${blocks.length - 1}@@`;
  };

  const copy = structuredClone(map);
  for (const layer of copy.layers) {
    if (Array.isArray(layer.data)) {
      const rows = [];
      for (let r = 0; r < layer.height; r++) rows.push(layer.data.slice(r * layer.width, (r + 1) * layer.width).join(','));
      layer.data = stash(rows);
    }
    if (Array.isArray(layer.objects)) {
      layer.objects = stash(layer.objects.map((object) => JSON.stringify(object)));
    }
  }
  return JSON.stringify(copy, null, 2).replace(/"@@block(\d+)@@"/g, (match, i) => blocks[Number(i)]) + '\n';
}
