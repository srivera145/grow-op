import { autotile, serialize } from '../../tools/autotile-core.mjs';

/**
 * Reading and writing the Tiled JSON that GameScene loads.
 *
 * The editor holds only solid or empty per cell. Which of the nine soil pieces a cell gets is worked out
 * on write by the same autotile() the `npm run autotile` command uses, from the same file, so the editor
 * and the command line cannot disagree and no tile piece is ever hand-picked.
 *
 * Everything in the file that the editor does not own - the map header, the tileset block, layer ids,
 * object ids and any field Tiled wrote - is kept exactly as it was read and put back untouched. That is
 * what lets a level be loaded and saved again byte for byte.
 */

export const TILE = 32;
const GROUND_LAYER = 'ground';
const OBJECT_LAYER = 'objects';
const TILESET = 'tiles-soil';

/**
 * Every object type a level can hold.
 *
 *  - `width`/`height` are the Tiled rectangle, which is what GameScene measures hitboxes and ground lines
 *    from. They are not the size of the art.
 *  - `anchor` decides where a snapped object sits in its cell: 'bottom' stands it on the floor of the
 *    cell, which is what GameScene does with things that walk or stand; 'center' centres it, for things
 *    that hang in the air. Both reproduce the placements already in world1-1.json exactly.
 *  - `sheet`/`frames` name the animation strip the editor draws the first frame of.
 */
export const OBJECT_TYPES = {
  'player-start': { width: 0, height: 0, anchor: 'center', point: true, sheet: 'little-bud-small-idle', frames: 4, color: '#4cd137' },
  'water-drop': { width: 16, height: 16, anchor: 'center', sheet: 'water-drop-idle', frames: 4, color: '#4cc9f0' },
  'light-orb': { width: 24, height: 24, anchor: 'center', sheet: 'light-orb-idle', frames: 4, color: '#ffd60a' },
  nutrient: { width: 24, height: 24, anchor: 'center', sheet: 'nutrient-idle', frames: 4, color: '#c77dff' },
  'goal-jar': { width: 32, height: 64, anchor: 'bottom', sheet: 'goal-jar-idle', frames: 4, color: '#d8f3dc' },
  'spider-mite': { width: 32, height: 24, anchor: 'bottom', sheet: 'spider-mite-walk', frames: 4, color: '#e8443a' },
  'fungus-gnat': { width: 24, height: 24, anchor: 'center', sheet: 'fungus-gnat-fly', frames: 4, color: '#9d8189' },
  'root-rot': { width: 32, height: 32, anchor: 'bottom', sheet: 'root-rot-crawl', frames: 4, color: '#7f5539' },
};

/** Where an object of this type sits when it is dropped on a cell. */
export function snapTo(type, col, row) {
  const def = OBJECT_TYPES[type];
  if (def.point) return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  const x = col * TILE + (TILE - def.width) / 2;
  const y = def.anchor === 'bottom' ? (row + 1) * TILE - def.height : row * TILE + (TILE - def.height) / 2;
  return { x, y };
}

/** The middle of an object in world pixels. GameScene works this out the same way. */
export function centreOf(object) {
  return { x: object.x + (object.width || 0) / 2, y: object.y + (object.height || 0) / 2 };
}

/**
 * Where an object meets the ground: the bottom of its rectangle, or the bottom of the cell a point sits
 * in. Copied from GameScene.objectGroundY so validation judges a level the way the game will.
 */
export function groundYOf(object) {
  return object.height ? object.y + object.height : Math.ceil(object.y / TILE) * TILE;
}

/** A level read from disk, split into the parts the editor owns and the parts it only carries. */
export function parseLevel(text) {
  const map = JSON.parse(text);
  const ground = map.layers.find((layer) => layer.type === 'tilelayer' && layer.name === GROUND_LAYER);
  const objects = map.layers.find((layer) => layer.type === 'objectgroup' && layer.name === OBJECT_LAYER);
  const tileset = map.tilesets?.find((entry) => entry.name === TILESET);

  if (!ground) throw new Error(`no tile layer named "${GROUND_LAYER}"`);
  if (!objects) throw new Error(`no object layer named "${OBJECT_LAYER}"`);
  if (!tileset) throw new Error(`no "${TILESET}" tileset block`);

  return {
    map,
    width: ground.width,
    height: ground.height,
    // Only solid or empty is kept. The gid that was there is thrown away and worked out again on write.
    cells: Uint8Array.from(ground.data, (gid) => (gid === 0 ? 0 : 1)),
    objects: objects.objects.map((object) => ({ ...object })),
    nextObjectId: map.nextobjectid ?? objects.objects.reduce((top, object) => Math.max(top, object.id), 0) + 1,
  };
}

/** A new empty level, shaped like something Tiled would have written. */
export function blankLevel(width, height) {
  const map = {
    compressionlevel: -1,
    height,
    infinite: false,
    layers: [
      { data: new Array(width * height).fill(0), height, id: 1, name: GROUND_LAYER, opacity: 1, type: 'tilelayer', visible: true, width, x: 0, y: 0 },
      { draworder: 'topdown', id: 2, name: OBJECT_LAYER, objects: [], opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 },
    ],
    nextlayerid: 3,
    nextobjectid: 1,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.2',
    tileheight: TILE,
    tilesets: [
      {
        columns: 3,
        firstgid: 1,
        image: '../assets/tiles/tiles-soil.png',
        imageheight: 96,
        imagewidth: 96,
        margin: 0,
        name: TILESET,
        spacing: 0,
        tilecount: 9,
        tileheight: TILE,
        tilewidth: TILE,
      },
    ],
    tilewidth: TILE,
    type: 'map',
    version: '1.10',
    width,
  };
  return parseLevel(JSON.stringify(map));
}

/** A fresh object of `type`, with its keys in the order Tiled writes them. */
export function makeObject(id, type, x, y) {
  const def = OBJECT_TYPES[type];
  const object = { id, name: type, type: '', rotation: 0, visible: true, x, y, width: def.width, height: def.height };
  if (def.point) object.point = true;
  return object;
}

/**
 * The level as it should appear on disk. The carried map is updated in place with the current grid and
 * objects, the gids are worked out from the solid pattern, and the whole thing goes through the shared
 * serializer, so a level loaded and saved with no edits comes back byte for byte.
 */
export function serializeLevel(level) {
  const map = structuredClone(level.map);
  const ground = map.layers.find((layer) => layer.type === 'tilelayer' && layer.name === GROUND_LAYER);
  const objects = map.layers.find((layer) => layer.type === 'objectgroup' && layer.name === OBJECT_LAYER);
  const tileset = map.tilesets.find((entry) => entry.name === TILESET);

  map.width = level.width;
  map.height = level.height;
  ground.width = level.width;
  ground.height = level.height;
  ground.data = autotile(Array.from(level.cells), level.width, level.height, tileset.firstgid);
  objects.objects = level.objects.map((object) => ({ ...object }));
  map.nextobjectid = level.nextObjectId;

  return serialize(map);
}
