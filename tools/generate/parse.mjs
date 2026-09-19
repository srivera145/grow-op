import { blankLevel, makeObject, snapTo } from '../../src/editor/format.js';
import { knownObjectNames } from '../../src/state/levelScore.js';

/**
 * Turning the ASCII layout a model writes into a level the editor can hold.
 *
 * The model never sees a gid, a tileset or a Tiled field. It writes one character per tile and one line
 * per row, and everything else - which of the nine soil pieces each solid cell becomes, where in its
 * cell an object sits, the map header - is worked out here by the same code the editor uses when a
 * person draws the level by hand. There is no second format to keep in step.
 *
 * Nothing here is forgiving. A layout of the wrong size, or with a character that is not in the legend,
 * is refused and says exactly what was wrong, because the alternative is a level that quietly lost the
 * thing the description asked for.
 */

/** One letter per object type. The letters are the whole vocabulary the model is given. */
export const LETTERS = {
  P: 'player-start',
  J: 'goal-jar',
  W: 'water-drop',
  L: 'light-orb',
  N: 'nutrient',
  M: 'spider-mite',
  G: 'fungus-gnat',
  R: 'root-rot',
};

export const SOLID = '#';
export const EMPTY = '.';

// The legend has to name every object the game knows about and nothing else. A type added to the game
// and not to the legend would be a thing no generated level could ever contain; a letter here for a
// type the game dropped would be a level that fails to spawn. Checked once, when the module loads.
const known = new Set(knownObjectNames());
const named = new Set(Object.values(LETTERS));
const missing = [...known].filter((name) => !named.has(name));
const extra = [...named].filter((name) => !known.has(name));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `tools/generate/parse.mjs is out of step with the game's object list: ${
      [missing.length > 0 ? `nothing writes ${missing.join(', ')}` : '', extra.length > 0 ? `${extra.join(', ')} is not a real object` : '']
        .filter(Boolean)
        .join('; ')
    }`,
  );
}

/**
 * How big a generated level may be.
 *
 * The lower bounds are a level with somewhere to go; the upper ones are what a model can hold in its
 * head and write out without losing its place, which is well under what the editor can hold. A request
 * outside them is clamped rather than refused, and the clamped size is what the model is asked for and
 * what the reply is checked against, so the two can never disagree.
 */
export const DEFAULT_SIZE = { width: 120, height: 17 };
export const SIZE_LIMITS = { width: [24, 200], height: [9, 24] };

export function clampSize({ width, height } = {}) {
  const fit = (value, fallback, [low, high]) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
  };
  return {
    width: fit(width, DEFAULT_SIZE.width, SIZE_LIMITS.width),
    height: fit(height, DEFAULT_SIZE.height, SIZE_LIMITS.height),
  };
}

/** Refusals carry the line they are about, so the panel can show it without parsing the message. */
export class LayoutError extends Error {
  constructor(message, { row } = {}) {
    super(message);
    this.name = 'LayoutError';
    this.row = row;
  }
}

/**
 * The layout out of whatever the model wrote around it.
 *
 * Everything outside the fenced block is ignored on purpose: a model that explains its level before
 * drawing it has done nothing wrong. The last fenced block wins, because a reply that shows a sketch
 * and then the real thing means the second one.
 */
export function extractLayout(reply) {
  const blocks = [...String(reply ?? '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (blocks.length === 0) throw new LayoutError('the reply had no ``` block in it, so there is no layout to read');
  return blocks[blocks.length - 1].replace(/\s+$/, '');
}

/**
 * The layout as a level the editor can adopt: a solid/empty grid and a list of placed objects.
 *
 * Objects land where the editor would drop them - standing on the floor of their cell, or centred in
 * it, depending on the type - so a generated level is placed exactly like a hand-drawn one, and the
 * cell a letter sits in is empty, because a letter is a thing in the air, not a tile.
 *
 * @param size the size that was asked for, clamped here the same way the request was clamped, so what
 *   the model was told to write and what this checks can never be two different numbers. The reply has
 *   to be that size: a layout of some other shape
 *   is a layout the model lost count in, and the parts of it that are right cannot be told from the
 *   parts that are not.
 */
export function parseLayout(text, size) {
  const { width, height } = clampSize(size);

  const rows = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/[\r\t ]+$/, '')); // trailing whitespace is invisible; nothing else is trimmed
  while (rows.length > 0 && rows[0] === '') rows.shift();
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  if (rows.length !== height) {
    throw new LayoutError(`the layout is ${rows.length} row${rows.length === 1 ? '' : 's'} tall, but ${height} were asked for`);
  }

  // Every wrong row at once, not just the first. Losing count of the columns is the mistake a model
  // makes, and it usually makes it on several rows; sending them all back means one more attempt
  // rather than one more attempt per row.
  const wrong = rows
    .map((row, index) => ({ index, length: row.length }))
    .filter((row) => row.length !== width);
  if (wrong.length > 0) {
    const listed = wrong.slice(0, 8).map((row) => `row ${row.index} is ${row.length}`).join(', ');
    const more = wrong.length > 8 ? `, and ${wrong.length - 8} more` : '';
    throw new LayoutError(
      `every row has to be exactly ${width} characters, but ${listed}${more}`,
      { row: wrong[0].index },
    );
  }

  const level = blankLevel(width, height);
  const legend = Object.entries(LETTERS).map(([letter, name]) => `${letter} ${name}`).join(', ');

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const character = rows[row][col];
      if (character === EMPTY) continue;
      if (character === SOLID) {
        level.cells[row * width + col] = 1;
        continue;
      }

      const name = LETTERS[character];
      if (!name) {
        throw new LayoutError(
          `row ${row}, column ${col} is "${character}", which is not one of ${SOLID} ${EMPTY} ${legend}`,
          { row },
        );
      }

      const { x, y } = snapTo(name, col, row);
      level.objects.push(makeObject(level.nextObjectId, name, x, y));
      level.nextObjectId += 1;
    }
  }

  return level;
}

/** How many of each object a level holds, for a preview that says what arrived without drawing it. */
export function countObjects(objects) {
  const counts = {};
  for (const object of objects) counts[object.name] = (counts[object.name] ?? 0) + 1;
  return counts;
}
