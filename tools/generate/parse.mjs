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
 * What it does repair is only ever what it can prove: the trailing empty cells of a row that came up a
 * character or two short, the trailing empty cells of one that came up a character or two long, and the
 * leading empty rows of a layout that stopped short of the sky. Every one of those moves empty air into
 * or out of columns the level does not have, and none of them can touch a tile that was drawn. See
 * PAD_TOLERANCE below and the pads that parseLayout hands back.
 *
 * There are two ways in, and which one is taken is read off the reply rather than set by a flag. A reply
 * whose rows carry an index prefix - see INDEX_SEPARATOR below - is read as numbered, and then a row that
 * went missing is named by what arrived rather than guessed at from what did not: the empty row goes back
 * at the index the numbering skipped, and every other row keeps the place it was written in. A reply
 * whose rows carry no prefix is read exactly as it always was, first-row-empty rule and all, because
 * every reply already on disk in .level-raw is one of those and re-parsing them has to stay free.
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

/**
 * The row prefix, and why there is one.
 *
 * A row that goes missing used to be a thing inferred from what did not arrive: sixteen rows came back
 * where seventeen were asked for, and nothing in the text said which one was gone. Asking the model to
 * write each row's index in front of it turns that into a thing stated - the gap is visible in what
 * arrives, so the empty row goes back where it belongs instead of at the top.
 *
 * The separator has to be a character the layout can never contain, or a prefix could not be told apart
 * from content. "|" is not in the legend and cannot become part of it: the legend is checked against the
 * game's object list above, and the list is names, not punctuation.
 *
 * The index is zero-padded to the width of the largest one so the prefixes line up in a column, which is
 * what makes a skipped number visible to the model writing it as well as to this. A reply that writes 9
 * where it was asked for 09 is still read: the number is unambiguous either way, and refusing a level
 * over a leading zero would cost a whole generation for nothing.
 */
export const INDEX_SEPARATOR = '|';

/** How wide the index field is for a level this tall - the width of the largest index, which is height-1. */
export const indexWidth = (height) => String(Math.max(0, height - 1)).length;

/** Rows with their index in front of them: what the prompt asks for, and what it shows an example of. */
export function numberRows(rows, height = rows.length) {
  const places = indexWidth(height);
  return rows.map((row, index) => `${String(index).padStart(places, '0')}${INDEX_SEPARATOR}${row}`);
}

const PREFIX = new RegExp(`^([0-9]+)[${INDEX_SEPARATOR}]`);

// One character, outside the layout alphabet, and one a character class takes literally. Checked
// rather than assumed, because swapping the separator for something the layout can contain is a one-line
// change that would make a prefix indistinguishable from a row.
const RESERVED = [SOLID, EMPTY, ...Object.keys(LETTERS), ...'0123456789', ']', '^', '-'];
if (INDEX_SEPARATOR.length !== 1 || RESERVED.includes(INDEX_SEPARATOR)) {
  throw new Error(`INDEX_SEPARATOR has to be one character outside the layout alphabet, not "${INDEX_SEPARATOR}"`);
}

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
 * "the 4th line", for the rows that have no index to be named by.
 *
 * An unnumbered row cannot be called row 4 - that is exactly what is missing from it - and calling it
 * line 4 would sit a 1-based count next to the 0-based indices in the same message. An ordinal is read
 * the one way whatever base the reader has in mind.
 */
function ordinal(position) {
  const suffix = position % 100 >= 11 && position % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[position % 10] ?? 'th';
  return `${position}${suffix}`;
}

/**
 * The indices off the front of the rows, or null if this reply is not a numbered one.
 *
 * Which path a reply takes is decided here and nowhere else, and it is decided by looking at the rows: a
 * flag would be a second thing to keep in step with what the model actually wrote, and the replies
 * already on disk predate any flag there might have been.
 *
 * Everything this refuses is something that could have been patched over and is not, on purpose. A
 * half-numbered reply could have had the gaps counted out from its neighbours; indices that repeat or
 * run backwards could have been sorted. Both of those are the same guess the numbering exists to remove,
 * made with worse information. The trade is deliberate and it is the whole point: a misnumbered reply is
 * refused loudly, where a dropped row used to be accepted quietly and silently wrong.
 */
function readNumbering(rows, width, height) {
  const marks = rows.map((row) => PREFIX.exec(row));
  if (marks.every((mark) => mark === null)) return null;

  const bare = marks.map((mark, line) => (mark ? null : line)).filter((line) => line !== null);
  if (bare.length > 0) {
    throw new LayoutError(
      `some rows are numbered and ${plural(bare.length, 'one is', `${bare.length} are`)} not: the `
        + `${listRows(bare, (line) => ordinal(line + 1))} ${plural(bare.length, 'line', 'lines')} of the block `
        + `${plural(bare.length, 'carries', 'carry')} no index. A reply is numbered or it is not - the two are `
        + 'not reconciled here, because working out which index an unnumbered row was meant to carry is exactly '
        + `the guess the numbering is for. Write it again with every row as its ${indexWidth(height)}-digit `
        + `index, then "${INDEX_SEPARATOR}", then the ${width}-character row`,
      { row: bare[0] },
    );
  }

  const indices = marks.map((mark) => Number(mark[1]));
  const bodies = rows.map((row, line) => row.slice(marks[line][0].length));

  // Every wrong index at once, for the same reason every wrong row is named at once further down: the
  // message is what the next attempt is taught from, and one attempt per bad index is one too many.
  const counts = new Map();
  for (const index of indices) counts.set(index, (counts.get(index) ?? 0) + 1);
  const outOfRange = [...new Set(indices.filter((index) => index >= height))];
  const duplicated = [...counts].filter(([, count]) => count > 1).map(([index]) => index);
  const backwards = indices
    .map((index, line) => (line > 0 && index < indices[line - 1] ? { from: indices[line - 1], to: index } : null))
    .filter(Boolean);

  if (outOfRange.length > 0 || duplicated.length > 0 || backwards.length > 0) {
    const reasons = [];
    if (outOfRange.length > 0) {
      reasons.push(
        `${listRows(outOfRange, (index) => `${index}`)} ${plural(outOfRange.length, 'is', 'are')} outside `
          + `0 to ${height - 1}, which are the only rows a ${height}-row level has`,
      );
    }
    if (duplicated.length > 0) {
      reasons.push(
        `${listRows(duplicated, (index) => `${index}`)} ${plural(duplicated.length, 'appears', 'appear')} more `
          + 'than once, so there is no telling which of them is that row',
      );
    }
    if (backwards.length > 0) {
      reasons.push(
        `the numbering goes backwards at ${listRows(backwards, (step) => `${step.from} then ${step.to}`)}`
          + ' - rows out of order are rows in an order nobody meant',
      );
    }
    const firstBad = indices.findIndex(
      (index, line) => index >= height || counts.get(index) > 1 || (line > 0 && index < indices[line - 1]),
    );
    throw new LayoutError(
      `the rows are numbered, but the numbering is wrong: ${reasons.join('; and ')}. This is not sorted out `
        + 'here - a level rebuilt from indices that contradict each other is a level nobody drew. Write it '
        + `again, each row numbered once, in order, 0 to ${height - 1}`,
      { row: Math.max(0, firstBad) },
    );
  }

  return { indices, bodies };
}

/**
 * A numbered reply laid back out at full height, with an empty row at every index the numbering skipped.
 *
 * This is the whole of what numbering buys. A row is put back where its own neighbours say the gap is,
 * so nothing below it moves: the level that comes out is the level that was drawn, minus one row of
 * content and plus one row of air, at a stated place. Compare the unnumbered case below, where the only
 * provable place to put a row is the top and every row after it moves down a tile.
 *
 * The same PAD_TOLERANCE bounds it, and for the same reason. Knowing exactly which eight rows are gone
 * does not make eight missing rows a transcription slip - it makes them eight rows of level that were
 * never written, and an empty row is not what was in any of them.
 */
function fillNumbered({ indices, bodies }, width, height) {
  const present = new Set(indices);
  const missing = [];
  for (let index = 0; index < height; index += 1) if (!present.has(index)) missing.push(index);

  const was = indices.length;
  const limit = Math.floor(height * PAD_TOLERANCE);
  if (missing.length > limit) {
    throw new LayoutError(
      `the layout has ${was} of the ${height} rows that were asked for, and the ${missing.length} missing `
        + `${plural(missing.length, 'index', 'indices')} (${listRows(missing, (index) => `${index}`)}) `
        + `${plural(missing.length, 'is', 'are')} more than the ${limit} that could be filled in (10% of `
        + `${height}). The numbering says exactly which rows are gone, which is not the same as being able `
        + 'to put them back: this is a layout missing whole rows of level, not one that lost a line',
      { row: missing[0] },
    );
  }

  const rows = new Array(height);
  indices.forEach((index, line) => { rows[index] = bodies[line]; });
  for (const index of missing) rows[index] = EMPTY.repeat(width);

  return {
    rows,
    pads: missing.map((index) => ({
      where: 'height',
      row: index,
      added: 1,
      was,
      want: height,
      message: `The layout was ${was} rows of ${height} and none of them was numbered ${index}, so an empty row `
        + `was put back at index ${index} - where the numbering says the gap is, rather than at the top. Every `
        + 'other row kept the index it was written with.',
    })),
  };
}

/**
 * The layout as a level the editor can adopt: a solid/empty grid and a list of placed objects, plus
 * every repair that had to be made to get there.
 *
 * Why the repairs are safe, and the one direction they are allowed to be wrong in. A pad only ever adds
 * EMPTY and a trim only ever removes it. Neither can add ground, so neither can bridge a pit the model
 * left; neither can add an object, so neither can put back a jar the model forgot; and neither can take
 * one away, because a trim that would have cut anything but empty air is a refusal instead. What a pad
 * can do is leave a hole at the right-hand end of a
 * floor that was meant to run to the edge - and that makes the level harder, or unfinishable, never
 * easier. Padding fails closed. The padded grid then goes through the editor's own checks and the
 * reachability solver exactly as a hand-drawn one does, so a pad that broke the level is caught by the
 * same thing that catches a badly drawn one. Nothing downstream is loosened for it.
 *
 * A missing row is a harder case and is treated as one, in whichever of the two ways the reply allows.
 * If the rows are numbered, the reply says which index is gone and the empty row goes there, leaving
 * every other row exactly where it was written; see fillNumbered above. If they are not, all there is to
 * go on is that a whole line of the level is missing and nothing says which. Putting one back at the top
 * is only right when the layout opens with sky - the model was drawing empty air and stopped - so that
 * is the only case where it is done, and every other shortfall is refused, because a level shifted down
 * a row passes the checks, passes the solver, and is wrong by a tile everywhere.
 *
 * That rule has a hole in it that numbering is what closes: an unnumbered layout which opens with sky
 * *and* lost a row from its middle is padded at the top and shifted, and nothing in the text tells it
 * apart from one that stopped short. It is left open for unnumbered replies rather than closed by
 * refusing them, because closing it would refuse the honest case too and would make every reply on disk
 * unreadable. A numbered reply is not subject to it at all.
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
 * @returns { level, pads } - pads is every place the reply did not arrive at the size it was asked for
 *   and was made to fit with empty space: `added` cells where it was short, `trimmed` ones where it ran
 *   past the end into nothing. Each carries the row, the two lengths and a sentence saying so. An empty
 *   array is a reply that arrived exactly as asked for. Callers destructure both: the pads are not
 *   optional to look at.
 */
export function parseLayout(text, size) {
  const { width, height } = clampSize(size);

  let rows = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/[\r\t ]+$/, '')); // trailing whitespace is invisible; nothing else is trimmed
  while (rows.length > 0 && rows[0] === '') rows.shift();
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  const pads = [];
  if (rows.length === 0) throw new LayoutError('the fenced block is empty, so there is no layout in it');

  // Which of the two paths this reply takes, read off the rows rather than told. A numbered reply is put
  // back to full height here, with the prefixes gone, so the two height checks below cannot fire on one -
  // they are the unnumbered path's rules, and the first-row-empty rule inside them with them. The width
  // rule is unchanged and applies to both, because by this point a numbered row is just a row: the prefix
  // is off before anything measures it.
  const numbering = readNumbering(rows, width, height);
  if (numbering) {
    const filled = fillNumbered(numbering, width, height);
    rows = filled.rows;
    pads.push(...filled.pads);
  }

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

  // An over-long row is refused because the characters cut off the end would be real content - unless
  // they demonstrably would not be. A row whose excess is entirely EMPTY is over-long by empty air
  // standing in columns the level does not have, and cutting that away cannot change a tile: it is the
  // same argument that lets a short row be padded on the right, run in the other direction, and it is a
  // stronger one. Padding a short row can leave a hole where ground was meant to be; trimming empty
  // overhang is a no-op on the level itself.
  //
  // It is the excess that is looked at, never the row. One character of ground past the end is still a
  // refusal, because then there really is content out there and no telling which of it was surplus.
  //
  // The same tolerance bounds it, for a reason that is about the row rather than the repair: an overhang
  // wider than that is not a slip, it is a row drawn to a different width, and a row laid out for
  // different columns is not made right by the fact that its content happens to fit inside these ones.
  for (let index = 0; index < rows.length; index += 1) {
    const over = rows[index].length - width;
    if (over <= 0 || over > limit) continue;
    if (![...rows[index].slice(width)].every((cell) => cell === EMPTY)) continue;

    rows[index] = rows[index].slice(0, width);
    pads.push({
      where: 'width',
      row: index,
      trimmed: over,
      was: width + over,
      want: width,
      message: `Row ${index} came in ${width + over} characters, ${over} over ${width}, and the `
        + `${plural(over, 'extra character was', `${over} extra characters were`)} empty - so `
        + `${plural(over, 'it was', 'they were')} cut from the right. ${plural(over, 'It stood', 'They stood')} `
        + `in ${plural(over, 'a column', 'columns')} the level does not have, so nothing was lost with `
        + `${plural(over, 'it', 'them')}.`,
    });
  }

  const measured = rows.map((row, index) => ({ index, length: row.length }));
  const tooLong = measured.filter((row) => row.length > width);
  const tooShort = measured.filter((row) => width - row.length > limit);

  if (tooLong.length > 0 || tooShort.length > 0) {
    const reasons = [];
    if (tooLong.length > 0) {
      reasons.push(
        `${listRows(tooLong, (row) => `row ${row.index} is ${row.length}, ${row.length - width} over`)}`
          + ` - what is past ${width} is not all empty, or is more than ${limit} over (10% of ${width}), so it`
          + ' is real content rather than air standing in columns that do not exist. A row is never trimmed'
          + ' into content: there would be no telling which of it was surplus',
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
