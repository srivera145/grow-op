import { ENEMIES, GRAVITY_Y, PICKUPS, PLAYER, TILE_SIZE } from '../../src/config/constants.js';
import { analyseReachability, jumpEnvelope } from '../../src/editor/reachability.mjs';
import { EMPTY, INDEX_SEPARATOR, LETTERS, SOLID, indexWidth, numberRows, parseLayout } from './parse.mjs';

/**
 * What the model is told before it draws a level.
 *
 * Every number in here is read out of the live constants at the moment the request is made, and the
 * derived limits are worked out rather than written down. Retune the jump and the next level asked for
 * is designed against the new jump: there is no copy of the physics in this file to forget to update.
 *
 * The rules are deliberately about the shape of a level rather than its theme. The theme comes from the
 * person's description, and anything this file says about it would be the same level every time.
 */

const round = (value, places = 0) => Number(value.toFixed(places));

/** The legend, written out the way the layout uses it. */
function legend() {
  const rows = [
    `  ${SOLID}  solid ground`,
    `  ${EMPTY}  empty air`,
    ...Object.entries(LETTERS).map(([letter, name]) => `  ${letter}  ${name}`),
  ];
  return rows.join('\n');
}

/**
 * The physics, and what follows from it.
 *
 * The derivation is shown rather than just the answer, because the model is being asked to design
 * against a budget and a budget it can check is one it can stay inside.
 */
function movement() {
  const jump = jumpEnvelope();
  return [
    `A tile is ${TILE_SIZE} pixels. The player is ${PLAYER.BODY.small.width} by ${PLAYER.BODY.small.height} pixels, so any passage has to be at least 2 tiles tall.`,
    `Gravity is ${GRAVITY_Y} px/s^2. Running speed is ${PLAYER.RUN_SPEED} px/s. A jump leaves the ground at ${Math.abs(PLAYER.JUMP_VELOCITY)} px/s upward.`,
    '',
    'What that works out to:',
    `  peak jump height = jump speed^2 / (2 * gravity) = ${round(jump.rise, 1)}px = ${round(jump.riseTiles, 2)} tiles`,
    `  airtime          = 2 * jump speed / gravity     = ${round(jump.airtime, 2)}s`,
    `  horizontal reach = run speed * airtime          = ${round(jump.reach, 1)}px = ${round(jump.reachTiles, 2)} tiles`,
    '',
    `So the budget you design to is: no upward step taller than ${jump.stepBudget} tiles, and no gap wider than ${jump.gapBudget} tiles.`,
    `Those are under the ${round(jump.riseTiles, 2)} and ${round(jump.reachTiles, 2)} above on purpose. The margin is what makes the level playable rather than`,
    'only barely possible: a jump has to be reachable by a person who is also watching an enemy.',
    '',
    'Every part of the level has to be reachable from P without any of it. Anything you place that the',
    'player cannot get to is a mistake, and the level will be rejected for it.',
  ].join('\n');
}

/** What the things in a level do, so they are placed somewhere that suits them. */
function cast() {
  return [
    `  ${PICKUPS.WATER_DROP_SCORE}-point water drops (W) are the bread and butter. String them along a jump arc or a run so they read as a path.`,
    `  A light orb (L) is worth ${PICKUPS.LIGHT_ORB_SCORE} and belongs somewhere that costs a detour.`,
    `  A nutrient (N) is worth ${PICKUPS.NUTRIENT_SCORE} and makes the player briefly invincible, so put one before a hard stretch.`,
    '  The goal jar (J) ends the level. It stands on the floor, usually near the far end.',
    `  Spider mites (M) walk along the floor and turn at walls and ledges, so they need a few tiles of floor to patrol.`,
    `  Fungus gnats (G) fly in a sine wave and need clear air around them, not a tunnel.`,
    `  Root rot (R) crawls slowly and splits into two smaller ones when stomped, so leave room either side.`,
    `  Enemies sleep until the player is within ${ENEMIES.ACTIVATION_SCREENS} screen width of them.`,
  ].join('\n');
}

/** The format contract. Anything outside the fenced block is thrown away, so this says so plainly. */
function format(width, height) {
  const places = indexWidth(height);
  const first = '0'.padStart(places, '0');
  const last = String(height - 1).padStart(places, '0');
  return [
    `Write the level as ${height} lines inside one \`\`\` fenced block.`,
    '',
    `Every line is its row number, then "${INDEX_SEPARATOR}", then exactly ${width} characters of level:`,
    '',
    `  ${first}${INDEX_SEPARATOR}<${width} characters>     the top row`,
    `  ${last}${INDEX_SEPARATOR}<${width} characters>     the bottom row`,
    '',
    `Row numbers start at 0, go up by one every line, and are written with ${places} `
      + `${places === 1 ? 'digit' : 'digits'} - ${first} through ${last} - so they line up in a`,
    'column and a skipped number is something you can see. Number every line or none of them; half and',
    'half is rejected.',
    `A number that repeats, goes backwards, or is outside ${first} to ${last} is rejected too, saying which.`,
    '',
    'This is worth the few extra characters. If a line does go missing, the numbers say which row it was,',
    'and an empty row is put back exactly there - so the rest of your level stays where you drew it. Without',
    'them a dropped row shifts everything below it down by one and the level is quietly wrong.',
    '',
    `The ${width} characters after the "${INDEX_SEPARATOR}" are one character per tile. The legend:`,
    '',
    legend(),
    '',
    'Rules about the characters:',
    `  Exactly one P. At least one J.`,
    `  A letter is a thing standing in the air of that cell, so the cell it is in counts as empty, not solid.`,
    `  P, J, M and R have to sit in a cell with solid ground directly below them.`,
    `  W, L, N and G hang in the air, so they need a clear cell, usually within a jump of somewhere to stand.`,
    `  Nothing may sit inside solid ground.`,
    '',
    'You may write whatever you like around the block - it is ignored. Only the block is read, and it is',
    'read strictly: a row of the wrong length, or a character that is not in the legend, is rejected.',
    '',
    `Getting every row to exactly ${width} characters is the part that goes wrong, and one short row throws`,
    'the whole level away. So do not write a row by eye. Work each one out first as runs that add up to',
    `${width} - "7 dots, 5 hashes, 12 dots, ..." - and check the arithmetic before you draw it. Do that`,
    `working above the block, where it is ignored. Then render the runs. The "${INDEX_SEPARATOR}" is not one of`,
    `the ${width}: count the level, not the prefix.`,
    '',
    `Here is a whole reply at ${EXAMPLE_WIDTH} by ${EXAMPLE.length}, which is far smaller than what you are being asked for.`,
    'It is here for its shape, not for its size or its contents:',
    `Being ${EXAMPLE.length} rows, its numbers run ${EXAMPLE_FIRST} to ${EXAMPLE_LAST} in `
      + `${EXAMPLE_PLACES} ${EXAMPLE_PLACES === 1 ? 'digit' : 'digits'}; yours run ${first} to ${last} in `
      + `${places}. The width of the number follows the height of the level.`,
    '',
    '```',
    ...numberRows(EXAMPLE),
    '```',
  ].join('\n');
}

/**
 * A whole small level, so the shape of a reply is shown rather than only described.
 *
 * Deliberately much smaller than anything that will be asked for, and said to be, because an example
 * the same size as the request is an example to copy. Its rows are checked below: an example that did
 * not obey the rule it is demonstrating would teach exactly the wrong thing.
 */
const EXAMPLE = [
  '........................',
  '........................',
  '..........W.W...........',
  '.......W..........G.....',
  '......L.....#####.......',
  '...W.....W..............',
  '..#####........WW.......',
  '.......M....R......W..J.',
  '..P....########....#####',
  '#######........#########',
];

const EXAMPLE_WIDTH = EXAMPLE[0].length;
if (EXAMPLE.some((row) => row.length !== EXAMPLE_WIDTH)) {
  throw new Error('the worked example in tools/generate/prompt.mjs has rows of different widths');
}

// The example is written without its numbers and numbered on the way out, so the one piece of code that
// decides what a prefix looks like is the one in parse.mjs that reads them back. The example is shorter
// than any real request, so its indices are narrower than a real reply's - which is the rule working, and
// is said out loud beside it rather than left to be noticed.
const EXAMPLE_PLACES = indexWidth(EXAMPLE.length);
const EXAMPLE_FIRST = '0'.padStart(EXAMPLE_PLACES, '0');
const EXAMPLE_LAST = String(EXAMPLE.length - 1).padStart(EXAMPLE_PLACES, '0');

// It also has to be a level that can actually be finished, checked by the same solver that judges what
// comes back. An example nobody could play is an example of the wrong thing, and it is the one part of
// the prompt that would never get played.
//
// It is parsed in the numbered form, which is the form the prompt actually shows, so the example is put
// through the same path a reply drawn from it will take. An example the parser would refuse is the worst
// possible thing to show a model, and this is the cheapest place to find out.
const EXAMPLE_REPLY = numberRows(EXAMPLE).join('\n');
if (!analyseReachability(parseLayout(EXAMPLE_REPLY, { width: EXAMPLE_WIDTH, height: EXAMPLE.length }).level).ok) {
  throw new Error('the worked example in tools/generate/prompt.mjs is not a level that can be finished');
}

/** The house style: what makes one of these levels feel like the others. */
function craft(width, height) {
  const pickups = Math.round(width / 4);
  return [
    `The bottom rows are the ground. Holes in it are pits the player dies in, so keep them inside the gap budget and`,
    '  give the player somewhere to land on the far side.',
    `Build left to right: the player starts near the left and the jar is near the right.`,
    'Vary it. A level that is one flat floor for its whole length is not a level; so is one that is a staircase',
    '  the whole way. Alternate: a run, a climb, a gap, a platform worth going up for, a drop.',
    `Leave the top few rows clear so the camera has somewhere to look.`,
    `Around ${pickups} pickups and ${Math.max(2, Math.round(width / 12))} enemies suits a level this size. Reward every climb with something.`,
    'Put something out of the way on a high platform - the player who explores should be paid for it.',
  ].join('\n');
}

/**
 * The whole request. `previous` is what came back last time and what had to be said about it, which is
 * the only thing that changes on a regenerate: the level is drawn again from the description with the
 * failure in front of it, rather than patched, because a layout with an unreachable corner is usually
 * wrong in its shape and not in one character.
 *
 * Two different things can be in there, and they are worded differently on purpose. `problems` is a
 * level that was refused, so the layout is quoted back and the fix is the point. `pads` is a level that
 * was taken - the short rows were filled with empty space - and the point is only that the counting
 * went wrong and where, so that a model which is consistently short is told so while it still has the
 * session to correct in. Neither of them softens what the format section above asks for: rows are still
 * written to an exact width, and the padding is never offered as an allowance to draw inside.
 */
export function buildPrompt({ description, width, height, previous = null }) {
  const system = [
    'You design levels for Grow Op, a 2D side-scrolling platformer where a cannabis seedling fights its way',
    'through a grow room. You are given a description and you answer with a level as ASCII art.',
    '',
    '== HOW THE PLAYER MOVES ==',
    movement(),
    '',
    '== WHAT GOES IN A LEVEL ==',
    cast(),
    '',
    '== HOW TO WRITE IT ==',
    format(width, height),
    '',
    '== WHAT MAKES A GOOD ONE ==',
    craft(width, height),
  ].join('\n');

  const user = [`Design a ${width} by ${height} level.`, '', description.trim()];

  const problems = previous?.problems ?? [];
  const pads = previous?.pads ?? [];

  if (problems.length > 0) {
    // The layout is only shown when there was one to show: a reply with no block in it fails before
    // anything is drawn, and quoting an empty block back would teach the wrong lesson.
    if (previous.layout) user.push('', 'You drew this last time and it was rejected:', '', '```', previous.layout, '```');
    user.push(
      '',
      'What was wrong with it:',
      ...problems.map((problem) => `  - ${problem}`),
      '',
      'Draw it again, fixing that.',
      '',
      'If what was wrong was the shape of the level - something stranded, nowhere to land, no way through -',
      'keep what worked and be willing to move ground around, rather than only moving the thing that ended',
      'up stranded. The problem is usually the route rather than the decoration.',
      '',
      'If what was wrong was the count - the number of rows, or the length of them - then the design was',
      `fine and the transcription was not. Write the level out again and count as you go: ${height} lines `
        + `numbered ${'0'.padStart(indexWidth(height), '0')} to `
        + `${String(height - 1).padStart(indexWidth(height), '0')},`,
      `${width} characters after the "${INDEX_SEPARATOR}" on each, worked out as runs before you draw them.`,
      '',
      'Number every line. That is what lets a line you drop be put back where it belongs instead of losing',
      'you the whole level - but only an empty row goes back, never whatever you had drawn in it, so a row',
      'you meant to matter is still a row to get right the first time.',
    );
  }

  if (pads.length > 0) {
    user.push(
      '',
      `${problems.length > 0 ? 'Also, your' : 'Your'} rows did not all come out as asked last time. These had to be`,
      'filled in with empty space to be usable:',
      ...pads.map((pad) => `  - ${pad}`),
      '',
      'Empty space is the only thing that can be filled in, so a short row that was meant to end in ground',
      'ends in a hole instead. Count this time: work each row out as runs that add up before you draw it.',
    );
  }

  return { system, user: user.join('\n') };
}
