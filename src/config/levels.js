/**
 * The level list, as data.
 *
 * public/levels/index.json is an ordered array of entries. The order is the order of the game: the first
 * entry is where a new game starts, and each level's Next is the one after it, with the last wrapping
 * back to the first. An entry can name its own `next` to break out of that.
 *
 * A level's file is worked out from its key rather than stored, so a key and its file can never drift
 * apart. Adding a level therefore means adding one line of data, not editing source - which is what lets
 * the editor register a level when it saves one.
 *
 * LEVELS and FIRST_LEVEL keep the shape they have always had. They are filled in by loadLevels() before
 * the game is created; everything reads them at use time, so nothing has to know they arrive late.
 */

export const INDEX_URL = 'levels/index.json';
const DEFAULT_TILESET = 'tiles-soil';
const KEY_PATTERN = /^[a-z0-9-]+$/;

/** Keyed by level key. Filled by loadLevels(); do not replace the object, other modules hold this one. */
export const LEVELS = {};

/** The key of the first entry in the index. A live binding, so importers see it once it is known. */
export let FIRST_LEVEL = '';

/** The short form beside the HUD's world icon: "world1-1" reads as "1-1". */
export function defaultLabel(key) {
  return key.split(/[^0-9-]+/).filter(Boolean).pop() || key;
}

/**
 * Turns the index into the LEVELS shape. Pure, so the browser and `npm run check-levels` build the same
 * table from the same file. Throws on anything that would leave the game unable to start.
 */
export function buildLevels(index) {
  if (!Array.isArray(index) || index.length === 0) {
    throw new Error('the level index must be a non-empty array');
  }

  const seen = new Set();
  for (const entry of index) {
    if (!entry || typeof entry !== 'object') throw new Error('every level index entry must be an object');
    if (typeof entry.key !== 'string' || !KEY_PATTERN.test(entry.key)) {
      throw new Error(`"${entry?.key}" is not a usable level key: only a-z, 0-9 and dashes`);
    }
    if (seen.has(entry.key)) throw new Error(`the level index lists "${entry.key}" twice`);
    seen.add(entry.key);
  }

  const levels = {};
  index.forEach((entry, position) => {
    levels[entry.key] = {
      key: entry.key,
      name: entry.name || entry.key,
      label: entry.label || defaultLabel(entry.key),
      file: `levels/${entry.key}.json`,
      tileset: entry.tileset || DEFAULT_TILESET,
      // The next level is the next in the list, and the last one loops back to the start, unless the
      // entry says otherwise. A `next` naming a level that is not in the index is left as written so the
      // mistake is visible rather than silently corrected.
      next: entry.next || index[(position + 1) % index.length].key,
    };
  });
  return levels;
}

/**
 * Fetches the index and fills LEVELS and FIRST_LEVEL. Called once, before the game is created; the
 * caller is expected to show the error rather than start a game with no levels in it.
 */
export async function loadLevels(url = INDEX_URL) {
  let index;
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    index = await response.json();
  } catch (error) {
    throw new Error(`Could not read ${url} (${error.message}). The game has no levels without it.`);
  }

  const built = buildLevels(index);
  await checkLevelFilesExist(built);

  for (const key of Object.keys(LEVELS)) delete LEVELS[key];
  Object.assign(LEVELS, built);
  FIRST_LEVEL = index[0].key;
  return LEVELS;
}

/**
 * An entry in the index with no map behind it is a level that loads into nothing the moment a player
 * reaches it, which is a far worse way to find out. Checked at startup so it is said once, plainly,
 * before the game starts.
 *
 * The map is fetched and looked at rather than probed with HEAD, because a dev server answers a missing
 * file with its HTML fallback and a 200: the status says nothing, only the content does. The files are
 * small and the browser serves BootScene's own load of them from its cache a moment later.
 */
async function checkLevelFilesExist(levels) {
  const missing = [];
  await Promise.all(
    Object.values(levels).map(async (level) => {
      try {
        const response = await fetch(level.file, { cache: 'no-cache' });
        if (!response.ok) throw new Error(String(response.status));
        const map = await response.json();
        if (!Array.isArray(map?.layers)) throw new Error('not a Tiled map');
      } catch {
        missing.push(level.file);
      }
    }),
  );

  if (missing.length > 0) {
    const list = missing.sort().map((file) => `public/${file}`).join(', ');
    throw new Error(`The level index lists ${missing.length} level(s) with no usable map file: ${list}.`);
  }
}

