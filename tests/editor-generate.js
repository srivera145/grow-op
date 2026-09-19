import { BASE_URL, check, is, launch, report, watchConsole } from './harness.js';

/**
 * The generate pipeline, in the editor, in a real browser.
 *
 * Everything here goes through `__editor.offer()`, which is the same path a generated level takes -
 * parse, then the editor's own checks, then the reachability solver - with the model's reply handed in
 * instead of fetched. No API call, no key, no money: what is being tested is the judgement, and the
 * judgement is the part that must not be wrong.
 *
 * The one thing worth stating plainly: a level that cannot be finished must not reach the canvas. Two
 * of these check that from both sides, because a solver that refuses everything would pass the first.
 */

const WIDTH = 30;
const HEIGHT = 12;
const results = [];

/** A flat two-tile floor with one gap in it, a drop past the gap, and the jar at the far end. */
function gapLevel(gap) {
  const rows = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill('.'));
  for (let col = 0; col < WIDTH; col += 1) {
    const inGap = col >= 10 && col < 10 + gap;
    rows[HEIGHT - 1][col] = inGap ? '.' : '#';
    rows[HEIGHT - 2][col] = inGap ? '.' : '#';
  }
  rows[HEIGHT - 3][2] = 'P';
  rows[HEIGHT - 3][10 + gap + 2] = 'W';
  rows[HEIGHT - 3][WIDTH - 3] = 'J';
  return rows.map((row) => row.join('')).join('\n');
}

const fenced = (layout) => `Here is the level.\n\n\`\`\`\n${layout}\n\`\`\`\n`;
const size = { width: WIDTH, height: HEIGHT };

const browser = await launch();
const page = await browser.newPage();
const noise = watchConsole(page);

await page.goto(new URL('editor.html', BASE_URL).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__editor && document.getElementById('generate-run'));

const offer = (layout) => page.evaluate((reply, where) => window.__editor.offer(reply, where), fenced(layout), size);
const state = () => page.evaluate(() => window.__editor.state());
const accepted = () => page.evaluate(() => window.__editor.useDraft());
const canAccept = () => page.evaluate(() => !document.getElementById('generate-accept').hidden);

// Dialogs: the editor asks before replacing unsaved work. Each test says what to answer next.
let answerNextDialog = 'dismiss';
const dialogs = [];
page.on('dialog', async (dialog) => {
  dialogs.push(dialog.message());
  await (answerNextDialog === 'accept' ? dialog.accept() : dialog.dismiss());
});

// ---------------------------------------------------------------- a level that works

const crossable = await offer(gapLevel(4));
is(results, 'a 4-tile gap parses and passes every check', crossable.ok, true);
is(results, 'nothing is stranded behind a 4-tile gap', crossable.stranded, []);
is(results, 'the draft is the size that was asked for', crossable.size, `${WIDTH}x${HEIGHT}`);
check(results, 'the draft can be accepted', await canAccept());

// ---------------------------------------------------------------- one that does not

const before = await state();
const impossible = await offer(gapLevel(7));
is(results, 'a 7-tile gap is refused', impossible.ok, false);
check(results, 'the far side is named as stranded', impossible.stranded.length === 2, impossible.stranded.join(' | '));
check(
  results,
  'the goal is reported unreachable',
  impossible.problems.some((problem) => problem.includes('goal-jar cannot be reached')),
  impossible.problems.join(' | '),
);
check(results, 'a refused draft cannot be accepted', !(await canAccept()));
is(results, 'a refused draft never touched the canvas', await state(), before);

// ---------------------------------------------------------------- replies that are not layouts

const ragged = gapLevel(4).split('\n');
ragged[3] = ragged[3].slice(1);
const short = await offer(ragged.join('\n'));
check(
  results,
  'a row of the wrong width is refused, naming the row',
  !short.ok && short.problems.some((problem) => problem.includes('row 3 is 29')),
  short.problems.join(' | '),
);

const strange = await offer(gapLevel(4).replace('W', 'X'));
check(
  results,
  'a letter that is not an object type is refused, naming it',
  !strange.ok && strange.problems.some((problem) => problem.includes('"X"')),
  strange.problems.join(' | '),
);

const prose = await page.evaluate((where) => window.__editor.offer('I had a think about it and decided not to.', where), size);
check(
  results,
  'a reply with no layout in it is refused',
  !prose.ok && prose.problems.some((problem) => problem.includes('``` block')),
  prose.problems.join(' | '),
);

// ---------------------------------------------------------------- taking a draft

const world = await state();
check(results, 'the level loaded from disk starts out saved', !(await page.evaluate(() => window.__editor.unsaved())));

await offer(gapLevel(4));
answerNextDialog = 'dismiss'; // nothing should ask: the open level has no unsaved work in it
is(results, 'a draft over a saved level is taken without asking', await accepted(), true);
is(results, 'no question was asked', dialogs.length, 0);
check(results, 'the canvas now holds the draft', (await state()).solid !== world.solid, `${world.solid} -> ${(await state()).solid}`);
is(results, 'the draft is named as a draft', await page.evaluate(() => document.getElementById('name').value), 'draft');
check(results, 'a draft counts as unsaved work', await page.evaluate(() => window.__editor.unsaved()));

// ---------------------------------------------------------------- unsaved work is not overwritten

const draftState = await state();
await offer(gapLevel(3));
answerNextDialog = 'dismiss';
is(results, 'replacing unsaved work is refused when the question is declined', await accepted(), false);
is(results, 'the question named the open level', dialogs.length, 1);
check(results, 'the question says what would be lost', /unsaved|not been saved/i.test(dialogs[0] ?? ''), dialogs[0]);
is(results, 'nothing was replaced', await state(), draftState);

answerNextDialog = 'accept';
is(results, 'replacing unsaved work is allowed when the question is accepted', await accepted(), true);
check(results, 'the canvas now holds the second draft', (await state()).solid !== draftState.solid, `${draftState.solid} -> ${(await state()).solid}`);

// ---------------------------------------------------------------- and quietly

is(results, 'the editor logged nothing', noise, []);

await browser.close();
report(results);
