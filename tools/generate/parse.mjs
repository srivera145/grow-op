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
 * Nothing here is forgiving about content. A character that is not in the legend, a row with more in it
 * than was asked for, a layout taller than the request, a layout that lost a row from somewhere in the
 * middle - all refused, saying exactly what was wrong, because the alternative is a level that quietly
 * lost the thing the description asked for.
 *
 * What it does fill in is what it can prove it is filling in correctly: the trailing empty cells of a
 * row that came up a character or two short, and the leading empty rows of a layout that stopped short
 * of the sky. See PAD_TOLERANCE below and the pads that parseLayout hands back.
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
 * How much of a layout may be missing before it stops being a slip and starts being a different level.
 *
 * Counting to 120 seventeen times over is the thing a model is least reliable at, and a row that came
 * back one character short used to throw the whole generation away - a paid call, minutes of thinking,
 * and sixteen rows that were perfectly good, discarded over a character. A shortfall inside this much
 * of the width is read as a transcription slip and padded. Beyond it the model did not lose a
 * character, it drew a different row, and no amount of empty space turns that into the level asked for.
 *
 * The same fraction bounds a missing row, for the same reason and with a second condition on top of it:
 * see the height checks in parseLayout. One row out of seventeen is a line stopped short. Eight is a
 * different level, whatever the rows that did arrive look like.
 */
export const PAD_TOLERANCE = 0.1;

/** The wrong rows, all of them, capped so a layout that is wrong everywhere does not become a wall of text. */
function listRows(rows, describe) {
  const listed = rows.slice(0, 8).map(describe).join(', ');
  return rows.length > 8 ? `${listed}, and ${rows.length - 8} more` : listed;
}

const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * The layout as a level the editor can adopt: a solid/empty grid and a list of placed objects, plus
 * every repair that had to be made to get there.
 *
 * Why the repairs are safe, and the one direction they are allowed to be wrong in. A pad only ever adds
 * EMPTY. It cannot add ground, so it cannot bridge a pit the model left; it cannot add an object, so it
 * cannot put back a jar the model forgot. What it can do is leave a hole at the right-hand end of a
 * floor that was meant to run to the edge - and that makes the level harder, or unfinishable, never
 * easier. Padding fails closed. The padded grid then goes through the editor's own checks and the
 * reachability solver exactly as a hand-drawn one does, so a pad that broke the level is caught by the
 * same thing that catches a badly drawn one. Nothing downstream is loosened for it.
 *
 * A missing row is a harder case and is treated as one. The rest of a short row is still there, so the
 * pad can only be the empty cells at its end; a missing row takes a whole line of the level with it and
 * leaves nothing behind saying which line it was. Putting one back at the top is only right when the
 * layout opens with sky - the model was drawing empty air and stopped - so that is the only case where
 * it is done. Every other shortfall is refused, because a level shifted down a row passes the checks,
 * passes the solver, and is wrong by a tile everywhere.
 *
 * What is never done is silent. Every pad comes back in `pads` and is shown in the draft notes with the
 * row and how much, because a level that was quietly repaired is a level that is subtly not the one on
 * the screen - and the padded rows go back with the next request, so a model that is consistently short
 * is told so while there is still a session to learn it in.
 *
 * Objects land where the editor would drop them - standing on the floor of their cell, or centred in
 * it, depending on the type - so a generated level is placed exactly like a hand-drawn one, and the
 * cell a letter sits in is empty, because a letter is a thing in the air, not a tile.
 *
 * @param size the size that was asked for, clamped here the same way the request was clamped, so what
 *   the model was told to write and what this checks can never be two different numbers.
 * @returns { level, pads } - pads is every place the reply was short and was filled with empty space,
 *   each one carrying the row, the two lengths and a sentence saying so. An empty array is a reply that
 *   arrived exactly as asked for. Callers destructure both: the pads are not optional to look at.
 */
export function parseLayout(text, size) {
  const { width, height } = clampSize(size);

  const rows = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/[\r\t ]+$/, '')); // trailing whitespace is invisible; nothing else is trimmed
  while (rows.length > 0 && rows[0] === '') rows.shift();
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  const pads = [];
  if (rows.length === 0) throw new LayoutError('the fenced block is empty, so there is no layout in it');

  // Too many rows is refused for the same reason an over-long row is: dropping one drops whatever was
  // drawn in it, and which one was surplus cannot be guessed at from here.
  if (rows.length > height) {
    throw new LayoutError(
      `the layout is ${rows.length} rows tall, but ${height} were asked for, and the ${rows.length - height} extra `
        + `${plural(rows.length - height, 'row is', 'rows are')} not thrown away because there is no telling which was meant`,
      { row: height },
    );
  }

  if (rows.length < height) {
    const added = height - rows.length;
    const was = rows.length;
    const limit = Math.floor(height * PAD_TOLERANCE);

    // Same tolerance as a row, and the same argument: one row missing out of seventeen is a model that
    // stopped a line early, eight is a model that drew a different level.
    if (added > limit) {
      throw new LayoutError(
        `the layout is ${was} rows tall, but ${height} were asked for. ${added} missing `
          + `${plural(added, 'row is', 'rows are')} more than the ${limit} that could be filled in (10% of ${height}), `
          + 'so this is a layout missing whole rows of level rather than one that stopped short of the sky',
        { row: 0 },
      );
    }

    // The proof that the rows to add are the ones that went missing. A row that came up short can be
    // padded on the right because the rest of it is still there; a layout that came up a row short has
    // no such guarantee - a whole row of content is gone and nothing in what came back says which. The
    // one case where the top is demonstrably the right place is a layout that opens with sky, because
    // then the model was still drawing empty air when it stopped, and empty air is what gets added.
    // Anything else is refused: a level shifted down a row passes every geometry check there is, and is
    // the wrong level by 32 pixels everywhere.
    if (![...rows[0]].every((cell) => cell === EMPTY)) {
      throw new LayoutError(
        `the layout is ${was} rows tall, but ${height} were asked for, and its first row is not empty. Rows are only `
          + 'put back at the top of a layout that opens with sky, because that is the one case where the missing '
          + `${plural(added, 'row', 'rows')} can be shown to belong there. This one lost ${plural(added, 'a row', 'rows')} `
          + `somewhere that cannot be worked out from here, and padding the top would move every row down ${added} - `
          + 'the level would pass every check and still be the wrong level',
        { row: 0 },
      );
    }

    rows.unshift(...Array.from({ length: added }, () => EMPTY.repeat(width)));
    pads.push({
      where: 'height',
      row: 0,
      added,
      was,
      want: height,
      message: `The layout was ${was} rows, ${added} short of ${height}, and its first row was empty - so it stopped `
        + `short of the sky, and ${added} empty ${plural(added, 'row was', 'rows were')} added at the top: `
        + `${plural(added, 'row 0 is', `rows 0-${added - 1} are`)} air the model did not draw.`,
    });
  }

  // Every wrong row at once, not just the first. Losing count of the columns is the mistake a model
  // makes, and it usually makes it on several rows; sending them all back means one more attempt
  // rather than one more attempt per row. The two ways a row can be wrong are refused for different
  // reasons, so they are named separately - the message is what the next attempt is taught from.
  const limit = Math.floor(width * PAD_TOLERANCE);
  const measured = rows.map((row, index) => ({ index, length: row.length }));
  const tooLong = measured.filter((row) => row.length > width);
  const tooShort = measured.filter((row) => width - row.length > limit);

  if (tooLong.length > 0 || tooShort.length > 0) {
    const reasons = [];
    if (tooLong.length > 0) {
      reasons.push(
        `${listRows(tooLong, (row) => `row ${row.index} is ${row.length}, ${row.length - width} over`)}`
          + ' - a long row is never trimmed, because the characters cut off the end would be real content',
      );
    }
    if (tooShort.length > 0) {
      reasons.push(
        `${listRows(tooShort, (row) => `row ${row.index} is ${row.length}, ${width - row.length} short of ${width}`)}`
          + ` - more than ${limit} short (10% of ${width}) is a row drawn wrong rather than a row that lost a`
          + ' character, so it is not padded either',
      );
    }
    throw new LayoutError(
      `every row has to be ${width} characters: ${reasons.join('; and ')}`,
      { row: Math.min(...[...tooLong, ...tooShort].map((row) => row.index)) },
    );
  }

  // What is left is short by a character or two. Padded on the right, with empty space, and recorded.
  for (const row of measured) {
    const added = width - row.length;
    if (added === 0) continue;
    rows[row.index] += EMPTY.repeat(added);
    pads.push({
      where: 'width',
      row: row.index,
      added,
      was: row.length,
      want: width,
      message: `Row ${row.index} came in ${row.length} characters, ${added} short of ${width}, and was padded on the `
        + `right with ${added} empty ${plural(added, 'cell', 'cells')}.`,
    });
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

  return { level, pads };
}

/** How many of each object a level holds, for a preview that says what arrived without drawing it. */
export function countObjects(objects) {
  const counts = {};
  for (const object of objects) counts[object.name] = (counts[object.name] ?? 0) + 1;
  return counts;
}
