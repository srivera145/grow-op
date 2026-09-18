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

// A broken entry is treated differently depending on who is looking. In development it is a mistake
// somebody is making right now and stopping is the fastest way to say so; in front of a player it is a
// deploy that went out with a file missing, and taking the whole game down over one level helps nobody.
// Vite replaces this with a literal in a build, so the branch not taken is dropped.
const IS_DEV = Boolean(import.meta.env?.DEV);

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

  const unusable = await findUnusable(buildLevels(index));

  if (unusable.size > 0 && IS_DEV) {
    const list = [...unusable].sort().map((key) => `public/levels/${key}.json`).join(', ');
    throw new Error(`The level index lists ${unusable.size} level(s) with no usable map file: ${list}.`);
  }

  const usable = index.filter((entry) => !unusable.has(entry.key));

  if (usable.length === 0) {
    throw new Error('Every level in the index is missing its map file. There is nothing to play.');
  }

  if (unusable.size > 0) {
    // Said once, naming them, so the gap is visible in a bug report rather than being a level that
    // quietly never comes up.
    console.warn(
      `[levels] skipping ${unusable.size} level(s) with no usable map file: ${[...unusable].sort().join(', ')}. `
        + 'The rest of the game is unaffected.',
    );
  }

  const built = buildLevels(survivingIndex(index, unusable));

  for (const key of Object.keys(LEVELS)) delete LEVELS[key];
  Object.assign(LEVELS, built);
  FIRST_LEVEL = usable[0].key;
  return LEVELS;
}

/**
 * The index with the dropped levels taken out, and the chain still walkable.
 *
 * An implicit next needs nothing done to it: it means "the entry after me", so rebuilding over the
 * shortened list re-derives it. An explicit next pointing at a dropped level would dead-end, so it moves
 * on to whatever survived after the level it named - the closest thing to what it actually asked for.
 *
 * Exported because this is the part worth testing on its own: the alternative is inferring it from a
 * running build, where LEVELS is not reachable.
 */
export function survivingIndex(index, dropped) {
  const surviving = index.filter((entry) => !dropped.has(entry.key));
  if (dropped.size === 0 || surviving.length === 0) return surviving;

  const survivorAfter = (key) => {
    const from = index.findIndex((entry) => entry.key === key);
    for (let step = 1; step <= index.length; step += 1) {
      const candidate = index[(from + step) % index.length];
      if (!dropped.has(candidate.key)) return candidate.key;
    }
    return surviving[0].key; // unreachable: surviving is not empty here
  };

  return surviving.map((entry) => (entry.next && dropped.has(entry.next) ? { ...entry, next: survivorAfter(entry.next) } : entry));
}

/**
 * The keys whose map file is missing or is not a map. An entry with nothing behind it is a level that
 * loads into nothing the moment a player reaches it, which is a far worse way to find out.
 *
 * Each map is fetched and looked at rather than probed with HEAD, because a dev server answers a missing
 * file with its HTML fallback and a 200: the status says nothing, only the content does. The files are
 * small and the browser serves BootScene's own load of them from its cache a moment later.
 */
async function findUnusable(levels) {
  const unusable = new Set();
  await Promise.all(
    Object.values(levels).map(async (level) => {
      try {
        const response = await fetch(level.file, { cache: 'no-cache' });
        if (!response.ok) throw new Error(String(response.status));
        const map = await response.json();
        if (!Array.isArray(map?.layers)) throw new Error('not a Tiled map');
      } catch {
        unusable.add(level.key);
      }
    }),
  );

  return unusable;
}

