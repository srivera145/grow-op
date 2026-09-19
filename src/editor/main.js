import { autotile } from '../../tools/autotile-core.mjs';
import { PARALLAX } from '../config/constants.js';
import { Art } from './Art.js';
import { Generate } from './Generate.js';
import { Grid, History } from './Grid.js';
import { ObjectLayer } from './Objects.js';
import { Palette } from './Palette.js';
import { OBJECT_TYPES, TILE, blankLevel, centreOf, parseLevel, serializeLevel } from './format.js';
import { summarise, validate } from './validate.js';
import { INDEX_URL, defaultLabel } from '../config/levels.js';

/**
 * The level editor. Plain canvas 2D, no Phaser.
 *
 * It holds a solid/empty grid and a list of named objects, and nothing else about the level: the tile
 * pieces shown on screen are worked out by the same autotile() that writes the file, so what is drawn
 * here is what the game will load. Everything else in the file is carried through untouched.
 */

const RULER = 22; // gutter for the tile coordinates, in screen pixels
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const PARALLAX_ALPHA = 0.16;
const NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * Whether the Vite dev server is the one serving this page.
 *
 * `import.meta.env` only exists because Vite puts it there, so this is also the honest answer to "is the
 * editor actually running?". Opened through any other static server - VS Code's Live Server, python's
 * http.server, the file system - the modules still load, but /levels is not where the editor thinks it
 * is and the routes it saves and deletes through do not exist at all. It would come up looking fine and
 * lose the first level somebody drew, so it says so instead.
 *
 * The optional chaining matters: without it, reading .DEV off nothing is an opaque TypeError and a blank
 * page, which is exactly the wrong way to find this out.
 */
const UNDER_VITE = Boolean(import.meta.env?.DEV);

const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const nameInput = document.getElementById('name');
const statusText = document.getElementById('status');
const savedText = document.getElementById('saved');
const readout = document.getElementById('readout');

const view = { x: -TILE, y: -TILE, zoom: 1 };
const pointer = { col: 0, row: 0, x: 0, y: 0, inside: false };

let level = blankLevel(120, 17);
let grid = new Grid(level.width, level.height, level.cells);
let objects = new ObjectLayer(level.objects, level.nextObjectId);
let tool = 'tiles';
let objectType = 'water-drop';
let problems = [];
let gids = null; // autotiled gids, rebuilt whenever the grid changes
let levelIndex = []; // public/levels/index.json, as loaded; the Level order panel edits this copy
// The level exactly as it is on disk, so "has this got unsaved work in it?" has an honest answer.
// null means there is nothing on disk to compare against: a generated draft, which is all unsaved.
let onDisk = null;

const art = { tiles: null, parallax: [], sheets: new Map() };

// ---------------------------------------------------------------- history

const history = new History(
  () => ({
    width: grid.width,
    height: grid.height,
    cells: grid.cells.slice(),
    objects: objects.list.map((object) => ({ ...object })),
    nextId: objects.nextId,
  }),
  (snapshot) => {
    grid.width = snapshot.width;
    grid.height = snapshot.height;
    grid.cells = snapshot.cells.slice();
    objects.list = snapshot.objects.map((object) => ({ ...object }));
    objects.nextId = snapshot.nextId;
    objects.selected = null;
    changed();
  },
);

/** Call after anything that alters the level. Rebuilds the tiles, revalidates, refreshes the panel. */
function changed() {
  gids = null;
  problems = validate(grid, objects);
  const summary = summarise(problems);
  statusText.textContent = summary.text;
  statusText.className = summary.severity;
  palette.update({ tool, objectType, width: grid.width, height: grid.height, problems });
}

// ---------------------------------------------------------------- art

function loadImage(src) {
  // A missing sheet must not stop the editor: it falls back to a coloured block.
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function loadArt() {
  art.tiles = await loadImage('/assets/tiles/tiles-soil.png');
  art.parallax = await Promise.all(PARALLAX.map((layer) => loadImage(`/assets/bg/${layer.key}.png`)));
  await Promise.all(
    Object.entries(OBJECT_TYPES).map(async ([type, def]) => {
      const image = await loadImage(`/assets/sheets/${def.sheet}.png`);
      if (image) art.sheets.set(type, { image, frameWidth: image.width / def.frames, frameHeight: image.height });
    }),
  );
}

// ---------------------------------------------------------------- drawing

const toScreen = (x, y) => ({ x: RULER + (x - view.x) * view.zoom, y: RULER + (y - view.y) * view.zoom });
const toWorld = (x, y) => ({ x: (x - RULER) / view.zoom + view.x, y: (y - RULER) / view.zoom + view.y });

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#0d1711';
  context.fillRect(0, 0, width, height);

  drawParallax();
  drawTiles();
  drawGridLines();
  drawObjects();
  drawRectPreview();
  drawRuler(width, height);
  updateReadout();
}

/** The game's backdrop, faint, so vertical spacing can be judged against what the player will see. */
function drawParallax() {
  context.save();
  context.globalAlpha = PARALLAX_ALPHA;
  for (const image of art.parallax) {
    if (!image) continue;
    const drawWidth = image.width * view.zoom;
    const drawHeight = image.height * view.zoom;
    const origin = toScreen(0, 0);
    for (let x = origin.x; x < canvas.clientWidth; x += drawWidth) {
      context.drawImage(image, x, origin.y, drawWidth, drawHeight);
    }
  }
  context.restore();
}

function currentGids() {
  if (!gids) gids = autotile(Array.from(grid.cells), grid.width, grid.height, 1);
  return gids;
}

function drawTiles() {
  const data = currentGids();
  const topLeft = toWorld(RULER, RULER);
  const bottomRight = toWorld(canvas.clientWidth, canvas.clientHeight);
  const firstCol = Math.max(0, Math.floor(topLeft.x / TILE));
  const lastCol = Math.min(grid.width - 1, Math.ceil(bottomRight.x / TILE));
  const firstRow = Math.max(0, Math.floor(topLeft.y / TILE));
  const lastRow = Math.min(grid.height - 1, Math.ceil(bottomRight.y / TILE));
  const size = TILE * view.zoom;

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      const gid = data[row * grid.width + col];
      if (gid === 0) continue;
      const { x, y } = toScreen(col * TILE, row * TILE);
      if (art.tiles) {
        const piece = gid - 1;
        context.drawImage(art.tiles, (piece % 3) * TILE, Math.floor(piece / 3) * TILE, TILE, TILE, x, y, size, size);
      } else {
        context.fillStyle = '#4a2f24';
        context.fillRect(x, y, size, size);
      }
    }
  }
}

function drawGridLines() {
  const size = TILE * view.zoom;
  if (size < 8) return; // too dense to read; the ruler still gives the scale
  const start = toScreen(0, 0);
  const end = toScreen(grid.width * TILE, grid.height * TILE);

  context.save();
  context.beginPath();
  context.rect(RULER, RULER, canvas.clientWidth - RULER, canvas.clientHeight - RULER);
  context.clip();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(216, 243, 220, 0.07)';
  context.beginPath();
  for (let col = 0; col <= grid.width; col += 1) {
    const x = Math.round(start.x + col * size) + 0.5;
    context.moveTo(x, start.y);
    context.lineTo(x, end.y);
  }
  for (let row = 0; row <= grid.height; row += 1) {
    const y = Math.round(start.y + row * size) + 0.5;
    context.moveTo(start.x, y);
    context.lineTo(end.x, y);
  }
  context.stroke();

  // The edge of the map, which is also the line things fall past.
  context.strokeStyle = 'rgba(76, 209, 55, 0.55)';
  context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  context.restore();
}

function drawObjects() {
  context.save();
  context.beginPath();
  context.rect(RULER, RULER, canvas.clientWidth - RULER, canvas.clientHeight - RULER);
  context.clip();

  for (const object of objects.list) {
    const def = OBJECT_TYPES[object.name];
    const sheet = art.sheets.get(object.name);
    const centre = centreOf(object);

    if (sheet && def) {
      // Line the art up the way the game does: bottom-centre for things that stand, centre for the rest.
      const drawWidth = sheet.frameWidth * view.zoom;
      const drawHeight = sheet.frameHeight * view.zoom;
      const anchorWorld = def.anchor === 'bottom' && object.height ? object.y + object.height : centre.y;
      const anchor = toScreen(centre.x, anchorWorld);
      const top = def.anchor === 'bottom' && object.height ? anchor.y - drawHeight : anchor.y - drawHeight / 2;
      context.drawImage(sheet.image, 0, 0, sheet.frameWidth, sheet.frameHeight, anchor.x - drawWidth / 2, top, drawWidth, drawHeight);
    } else {
      const { x, y } = toScreen(centre.x, centre.y);
      context.fillStyle = def?.color ?? '#ffffff';
      context.fillRect(x - 6, y - 6, 12, 12);
    }

    if (object === objects.selected) {
      const halfWidth = Math.max(object.width || 0, TILE) / 2;
      const halfHeight = Math.max(object.height || 0, TILE) / 2;
      const topLeft = toScreen(centre.x - halfWidth, centre.y - halfHeight);
      context.strokeStyle = '#ffd60a';
      context.lineWidth = 2;
      context.strokeRect(topLeft.x, topLeft.y, halfWidth * 2 * view.zoom, halfHeight * 2 * view.zoom);
    }
  }
  context.restore();
}

let rectStart = null;

function drawRectPreview() {
  if (!rectStart) return;
  const x0 = Math.min(rectStart.col, pointer.col) * TILE;
  const y0 = Math.min(rectStart.row, pointer.row) * TILE;
  const x1 = (Math.max(rectStart.col, pointer.col) + 1) * TILE;
  const y1 = (Math.max(rectStart.row, pointer.row) + 1) * TILE;
  const topLeft = toScreen(x0, y0);
  context.save();
  context.fillStyle = rectStart.solid ? 'rgba(76, 209, 55, 0.25)' : 'rgba(232, 68, 58, 0.25)';
  context.fillRect(topLeft.x, topLeft.y, (x1 - x0) * view.zoom, (y1 - y0) * view.zoom);
  context.restore();
}

/** Tile coordinates along the top and down the left, because the JSON stores pixels and these do not. */
function drawRuler(width, height) {
  const size = TILE * view.zoom;
  const every = size >= 48 ? 1 : size >= 24 ? 2 : size >= 12 ? 5 : 10;

  context.save();
  context.fillStyle = '#16241a';
  context.fillRect(0, 0, width, RULER);
  context.fillRect(0, 0, RULER, height);
  context.strokeStyle = '#24382a';
  context.beginPath();
  context.moveTo(0, RULER + 0.5);
  context.lineTo(width, RULER + 0.5);
  context.moveTo(RULER + 0.5, 0);
  context.lineTo(RULER + 0.5, height);
  context.stroke();

  context.font = '10px ui-monospace, monospace';
  context.fillStyle = '#8fae97';
  context.textBaseline = 'middle';

  context.textAlign = 'center';
  for (let col = 0; col <= grid.width; col += every) {
    const x = toScreen(col * TILE, 0).x + size / 2;
    if (x > RULER + 6 && x < width) context.fillText(String(col), x, RULER / 2);
  }

  context.textAlign = 'right';
  for (let row = 0; row <= grid.height; row += every) {
    const y = toScreen(0, row * TILE).y + size / 2;
    if (y > RULER + 6 && y < height) context.fillText(String(row), RULER - 4, y);
  }

  // The cell under the pointer, highlighted in both gutters.
  if (pointer.inside) {
    context.fillStyle = 'rgba(255, 214, 10, 0.25)';
    const cell = toScreen(pointer.col * TILE, pointer.row * TILE);
    context.fillRect(cell.x, 0, size, RULER);
    context.fillRect(0, cell.y, RULER, size);
  }
  context.restore();
}

function updateReadout() {
  const depth = history.depth;
  readout.textContent = pointer.inside
    ? `tile ${pointer.col},${pointer.row}   px ${Math.round(pointer.x)},${Math.round(pointer.y)}   ${grid.width}x${grid.height}   ${Math.round(view.zoom * 100)}%   undo ${depth.undo}/${depth.redo}`
    : `${grid.width}x${grid.height} tiles   ${grid.width * TILE}x${grid.height * TILE} px   ${Math.round(view.zoom * 100)}%`;
}

// ---------------------------------------------------------------- input

let stroke = null; // { solid, changed } while painting
let dragging = null; // { object, changed } while moving an object
let panning = null; // { x, y } in screen pixels
let spaceDown = false;

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return toWorld(event.clientX - rect.left, event.clientY - rect.top);
}

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  const world = pointerPosition(event);
  const col = Math.floor(world.x / TILE);
  const row = Math.floor(world.y / TILE);

  if (event.button === 1 || spaceDown) {
    panning = { x: event.clientX, y: event.clientY };
    return;
  }

  if (tool === 'objects') {
    const hit = objects.at(world.x, world.y);
    if (event.button === 2) {
      if (hit) {
        history.record();
        objects.remove(hit);
        changed();
      }
      return;
    }
    history.record();
    if (hit) {
      objects.selected = hit;
      dragging = { object: hit, changed: false };
    } else {
      objects.add(objectType, world.x, world.y, { snap: !event.altKey });
      changed();
    }
    if (dragging) history.forget(); // only recorded once the drag actually moves something
    return;
  }

  const solid = event.button !== 2;
  history.record();
  if (event.shiftKey) {
    rectStart = { col, row, solid };
    history.forget(); // recorded again when the rectangle is committed
    return;
  }
  stroke = { solid, changed: grid.set(col, row, solid) };
  if (stroke.changed) changed();
});

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const world = pointerPosition(event);
  pointer.x = world.x;
  pointer.y = world.y;
  pointer.col = Math.floor(world.x / TILE);
  pointer.row = Math.floor(world.y / TILE);
  pointer.inside = event.clientX - rect.left > RULER && event.clientY - rect.top > RULER;

  if (panning) {
    view.x -= (event.clientX - panning.x) / view.zoom;
    view.y -= (event.clientY - panning.y) / view.zoom;
    panning = { x: event.clientX, y: event.clientY };
    return;
  }

  if (dragging) {
    if (!dragging.changed) {
      history.record();
      dragging.changed = true;
    }
    objects.moveTo(dragging.object, world.x, world.y, { snap: !event.altKey });
    changed();
    return;
  }

  if (stroke && grid.set(pointer.col, pointer.row, stroke.solid)) {
    stroke.changed = true;
    changed();
  }
});

canvas.addEventListener('pointerup', (event) => {
  canvas.releasePointerCapture(event.pointerId);
  panning = null;

  if (rectStart) {
    history.record();
    const filled = grid.fillRect(rectStart.col, rectStart.row, pointer.col, pointer.row, rectStart.solid);
    if (!filled) history.forget();
    rectStart = null;
    changed();
    return;
  }

  if (stroke) {
    if (!stroke.changed) history.forget();
    stroke = null;
    return;
  }

  dragging = null;
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const before = toWorld(event.clientX - rect.left, event.clientY - rect.top);
  const next = view.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15);
  view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  const after = toWorld(event.clientX - rect.left, event.clientY - rect.top);
  // Keep whatever was under the pointer under the pointer.
  view.x += before.x - after.x;
  view.y += before.y - after.y;
}, { passive: false });

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const control = event.ctrlKey || event.metaKey;

  if (event.code === 'Space') {
    spaceDown = true;
    event.preventDefault();
    return;
  }
  if (control && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault();
    history.undo();
    return;
  }
  if (control && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
    event.preventDefault();
    history.redo();
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && objects.selected) {
    event.preventDefault();
    history.record();
    objects.remove(objects.selected);
    changed();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') spaceDown = false;
});

// ---------------------------------------------------------------- panel

const palette = new Palette(document.getElementById('palette'), {
  onTool: (next) => {
    tool = next;
    changed();
  },
  onObjectType: (type) => {
    objectType = type;
    tool = 'objects';
    changed();
  },
  onReorder: (from, to) => {
    if (to < 0 || to >= levelIndex.length) return;
    const working = palette.readIndex(); // keep whatever has been typed into the rows
    const [moved] = working.splice(from, 1);
    working.splice(to, 0, moved);
    levelIndex = working;
    palette.renderIndex(levelIndex);
    say('Level order changed. Save level order to write it.', 'warn');
  },
  onSaveIndex: async (index) => {
    try {
      const response = await fetch('/api/level-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      levelIndex = index;
      palette.renderIndex(levelIndex);
      say(`Wrote the list of ${body.levels} level(s).`);
    } catch (error) {
      say(`Could not write the level list (${error.message}).`, 'error');
    }
  },
  onDelete: () => deleteLevel(nameInput.value.trim()),
  onResize: (width, height) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8) {
      say('Width and height have to be at least 8 tiles.', 'error');
      return;
    }
    const lostTiles = grid.countLostBy(width, height);
    const lostObjects = objects.countOutside(width, height);
    if (lostTiles + lostObjects > 0) {
      const parts = [];
      if (lostTiles) parts.push(`${lostTiles} solid tile${lostTiles === 1 ? '' : 's'}`);
      if (lostObjects) parts.push(`${lostObjects} object${lostObjects === 1 ? '' : 's'}`);
      if (!window.confirm(`Shrinking to ${width}x${height} leaves ${parts.join(' and ')} outside the map. Go ahead?`)) {
        changed();
        return;
      }
    }
    history.record();
    grid.resize(width, height);
    changed();
    say(`Map is now ${width}x${height}.`);
  },
});

/**
 * The Generate panel.
 *
 * It owns the description, the request and the checks; the only thing it cannot decide is whether a
 * draft may take the canvas, because that is a question about the level already open. A draft arrives
 * unsaved and under a level key nothing is registered under, so the Save button cannot be the way
 * somebody finds out it replaced their work.
 */
const generate = new Generate(document.getElementById('generate'), {
  onAccept: (draft) => {
    const open = nameInput.value.trim() || 'the open level';
    if (unsaved() && !window.confirm(`Replace ${open} with the generated draft?

It has changes that have not been saved, and this cannot be undone.`)) {
      return false;
    }
    adopt(draft, { saved: false });
    const key = freeDraftName();
    nameInput.value = key;
    applyMeta(key);
    say(`Generated draft loaded as "${key}". Nothing has been written yet - Save does that.`, 'warn');
    return true;
  },
});

/**
 * The Art panel.
 *
 * It owns everything about making an asset and nothing about the level on the canvas, so unlike
 * Generate it has no accept handler to answer to: a tileset or a background that gets accepted is
 * registered in constants.js by the server, which reloads this page, and the reload is what puts a new
 * tileset in the dropdown. Nothing here has to be told about it.
 */
const artPanel = new Art(document.getElementById('art'), {
  onRegistered: (answer) => say(`${answer.key} registered in ${answer.registered.where}. Reloading the editor to pick it up.`, 'warn'),
});

function say(message, severity = 'ok') {
  savedText.textContent = message;
  savedText.style.color = severity === 'error' ? '#e8443a' : severity === 'warn' ? '#ffd60a' : '#8fae97';
}

// ---------------------------------------------------------------- loading and saving

function adopt(loaded, { saved = true } = {}) {
  level = loaded;
  grid = new Grid(loaded.width, loaded.height, loaded.cells);
  objects = new ObjectLayer(loaded.objects, loaded.nextObjectId);
  history.undoStack.length = 0;
  history.redoStack.length = 0;
  changed();
  onDisk = saved ? currentText() : null;
}

/** Whether the level on the canvas has anything in it that is not in a file. */
const unsaved = () => onDisk === null || currentText() !== onDisk;

/** A level key nothing is registered under, so accepting a draft cannot arm a Save over something. */
function freeDraftName(base = 'draft') {
  const taken = new Set(levelIndex.map((entry) => entry.key));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
}

/** The level list, for the Level order panel and for knowing whether a save needs to register. */
async function loadIndex() {
  try {
    const response = await fetch(INDEX_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const parsed = await response.json();
    levelIndex = Array.isArray(parsed) ? parsed : [];
  } catch {
    levelIndex = []; // a missing index is not fatal here: saving a level will start one
  }
  palette.renderIndex(levelIndex);
}

const indexEntry = (key) => levelIndex.find((entry) => entry.key === key) ?? null;

async function loadLevel(name) {
  if (!NAME_PATTERN.test(name)) {
    say('A level name may only use a-z, 0-9 and dashes.', 'error');
    return;
  }
  try {
    const response = await fetch(`/levels/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    adopt(parseLevel(await response.text()));
    applyMeta(name);
    say(`Loaded ${name}.json`);
  } catch {
    adopt(blankLevel(120, 17));
    applyMeta(name);
    say(`No ${name}.json yet - started an empty 120x17 map.`, 'warn');
  }
}

/** Shows this level's index entry, or the defaults a new level would be registered with. */
function applyMeta(key) {
  const entry = indexEntry(key);
  palette.setMeta({
    name: entry?.name ?? key,
    label: entry?.label ?? defaultLabel(key),
    tileset: entry?.tileset ?? 'tiles-soil',
  });
}

/** The level exactly as it would be written to disk. */
function currentText() {
  return serializeLevel({ map: level.map, width: grid.width, height: grid.height, cells: grid.cells, objects: objects.list, nextObjectId: objects.nextId });
}

/**
 * Removes a level and its registration.
 *
 * The key has to be typed out to go ahead. This throws away authored work with nothing to undo it, and a
 * button that only needs one careless click is the wrong shape for that; a name typed on purpose cannot
 * be a slip. The server does the refusing - last level, or another entry pointing here - because it is
 * the one holding the list.
 */
async function deleteLevel(key) {
  if (!NAME_PATTERN.test(key)) {
    say('A level name may only use a-z, 0-9 and dashes.', 'error');
    return;
  }

  const typed = window.prompt(
    `Delete ${key}?

This removes public/levels/${key}.json and its entry in the level list. `
      + `It cannot be undone.

Type the level key to confirm:`,
  );
  if (typed === null) return;
  if (typed.trim() !== key) {
    say('That did not match the level key, so nothing was deleted.', 'warn');
    return;
  }

  try {
    const response = await fetch(`/api/level/${encodeURIComponent(key)}`, { method: 'DELETE' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

    await loadIndex();
    // Whatever is left is what the editor should be showing; sitting on a level that is gone is worse.
    const next = levelIndex[0]?.key ?? '';
    nameInput.value = next;
    await loadLevel(next);
    say(`Deleted ${key}${body.fileRemoved ? '' : ' (its file was already gone)'}.`);
  } catch (error) {
    say(`Could not delete ${key}: ${error.message}`, 'error');
  }
}

document.getElementById('load').addEventListener('click', () => loadLevel(nameInput.value.trim()));

document.getElementById('save').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!NAME_PATTERN.test(name)) {
    say('A level name may only use a-z, 0-9 and dashes.', 'error');
    return;
  }
  const written = currentText();
  try {
    const response = await fetch('/api/level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `entry` is only used if this key is not in the index yet: saving a level registers a new one
      // and never rewrites an existing entry. Level order is the panel for changing those.
      body: JSON.stringify({ name, json: written, entry: palette.meta() }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    onDisk = written; // what is on disk now, so the next unsaved() answer is about edits made since
    if (body.registered) await loadIndex();
    say(`Saved public/levels/${name}.json${body.registered ? ' and registered it' : ''}`);
  } catch (error) {
    say(`Could not save (${error.message}). Use Download instead.`, 'error');
  }
});

document.getElementById('download').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'level';
  const url = URL.createObjectURL(new Blob([currentText()], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(url);
  say(`Downloaded ${name}.json`);
});

document.getElementById('play').addEventListener('click', () => {
  window.open(`/?level=${encodeURIComponent(nameInput.value.trim())}`, '_blank', 'noopener');
});

document.getElementById('undo').addEventListener('click', () => history.undo());
document.getElementById('redo').addEventListener('click', () => history.redo());

// ---------------------------------------------------------------- test seam

/**
 * A handle for the automated editor checks, the same idea as window.__growop in the game. The editor
 * only ever runs under the dev server, but the guard says plainly that none of this is shipped.
 */
if (UNDER_VITE) {
  window.__editor = {
    state: () => {
      const last = objects.list[objects.list.length - 1];
      return {
        width: grid.width,
        height: grid.height,
        solid: grid.cells.reduce((total, cell) => total + cell, 0),
        objects: objects.list.length,
        last: last ? { name: last.name, x: last.x, y: last.y } : null,
        problems: problems.length,
        undo: history.depth,
      };
    },
    setTool: (next, type) => {
      tool = next;
      if (type) objectType = type;
      changed();
    },
    placeAt: (type, col, row) => {
      history.record();
      const placed = objects.add(type, col * TILE + TILE / 2, row * TILE + TILE / 2);
      changed();
      return { name: placed.name, x: placed.x, y: placed.y };
    },
    removeAll: (types) => {
      history.record();
      const wanted = new Set(types);
      objects.list = objects.list.filter((object) => !wanted.has(object.name));
      changed();
      return objects.list.length;
    },
    paintRect: (colA, rowA, colB, rowB, solid = true) => {
      history.record();
      grid.fillRect(colA, rowA, colB, rowB, solid);
      changed();
    },
    reset: () => adopt(blankLevel(grid.width, grid.height)),
    unsaved: () => unsaved(),
    // Judges a layout exactly as a generated one is judged, without spending a request on one. The
    // verdict is flattened because it crosses into a test runner, where a level object means nothing.
    offer: (reply, size) => {
      const verdict = generate.offer(reply, size);
      return {
        ok: verdict.ok,
        problems: verdict.problems.map((problem) => `${problem.severity}: ${problem.message}`),
        stranded: (verdict.reach?.stranded ?? []).map((object) => `${object.name} at ${Math.floor(object.x / TILE)},${Math.floor(object.y / TILE)}`),
        objects: verdict.level?.objects.length ?? 0,
        size: verdict.level ? `${verdict.level.width}x${verdict.level.height}` : null,
      };
    },
    useDraft: () => generate.use(),
    // The Art panel's audit, judged without generating anything: the packed result and its audit are
    // handed in the same shape a route answers with. Flattened, because it crosses into a test runner.
    offerArt: (packed) => {
      const verdict = artPanel.offer(packed);
      return { ok: verdict.ok, key: verdict.key, flags: verdict.flags, canAccept: !document.getElementById('art-accept').hidden };
    },
    artKind: (kind) => {
      document.getElementById('art-kind').value = kind;
      artPanel.applyKind();
    },
    artRequest: () => artPanel.request(),
    index: () => levelIndex,
    setMeta: (meta) => palette.setMeta(meta),
    saveIndex: (index) => palette.handlers.onSaveIndex(index ?? palette.readIndex()),
    reorder: (from, to) => palette.handlers.onReorder(from, to),
    remove: (key) => deleteLevel(key),
    tilesetOptions: () => [...document.querySelectorAll('.fields select[name="tileset"] option')].map((o) => o.value),
    text: () => currentText(),
  };
}

// ---------------------------------------------------------------- go

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

if (UNDER_VITE) {
  await loadArt();
  await loadIndex(); // before the level, so its name, label and tileset can be shown
  const wanted = new URLSearchParams(window.location.search).get('level');
  if (wanted) nameInput.value = wanted;
  await loadLevel(nameInput.value.trim());

  (function frame() {
    draw();
    requestAnimationFrame(frame);
  })();
} else {
  wrongServer();
}

/** Says which server this needs, rather than half-working on whichever one opened the page. */
function wrongServer() {
  document.body.innerHTML = '';
  document.body.style.display = 'block';
  document.body.style.padding = '32px';

  const heading = document.createElement('h1');
  heading.style.color = '#ffd60a';
  heading.style.font = '600 18px ui-monospace, monospace';
  heading.textContent = 'The level editor needs the Vite dev server.';

  const detail = document.createElement('p');
  detail.style.maxWidth = '60ch';
  detail.textContent =
    `This page is being served by something else (${window.location.origin}), which cannot serve the level `
    + 'files or the routes the editor saves and deletes through. Nothing you do here would be written.';

  const how = document.createElement('pre');
  how.style.color = '#4cd137';
  how.textContent = 'npm run editor';

  const link = document.createElement('p');
  link.innerHTML = 'Then open <a href="http://localhost:5173/editor.html" style="color:#4cd137">http://localhost:5173/editor.html</a>.';

  document.body.append(heading, detail, how, link);
}
