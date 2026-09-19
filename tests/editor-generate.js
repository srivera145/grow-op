import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 *
 * The second half is about what a failure costs. A row that came back a character short has to be
 * padded and said to have been padded; a row short by a fifth has to be refused; and a reply already on
 * disk has to be readable again without paying for it. None of that may soften what a draft must pass,
 * so the checks that a bad level is still refused are repeated on padded ones.
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
const status = () => page.evaluate(() => document.getElementById('generate-status').textContent);

// The dev-server routes, called directly, the way the art suite calls the repack route: what a panel
// sends is not the only thing that reaches them, so they are checked on their own terms as well.
const request = async (path, options) => {
  const response = await fetch(new URL(path, BASE_URL).href, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const get = (path) => request(path, {});
const post = (path, body) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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

// ---------------------------------------------------------------- a row that lost a character

/**
 * The expensive failure this exists to stop: a 120x17 generation refused because one row came back 119
 * characters. Counting is the part a model is worst at, so the parser pads a small shortfall with empty
 * space and says so. Everything below is about the two halves of that being true - that it pads, and
 * that padding buys the layout nothing it would not otherwise have had.
 */

const nicked = gapLevel(4).split('\n');
nicked[3] = nicked[3].slice(1); // 29 of 30: one character, well inside the tolerance
const padded = await offer(nicked.join('\n'));
check(results, 'a row one character short is padded, not thrown away', padded.ok, padded.problems.join(' | '));
check(
  results,
  'the pad names the row and both lengths',
  padded.pads.some((pad) => pad.includes('Row 3 came in 29 characters, 1 short of 30')),
  padded.pads.join(' | '),
);
is(results, 'the padded draft is the size that was asked for', padded.size, `${WIDTH}x${HEIGHT}`);
check(results, 'a padded draft can be accepted', await canAccept());
const shown = await page.evaluate(() => [...document.querySelectorAll('#generate .problems li.pad')].map((li) => li.textContent));
check(results, 'the pad is in the draft notes, not only in the verdict', shown.length === 1 && shown[0].includes('Row 3'), shown.join(' | '));
check(results, 'the status says a row was padded', (await status()).includes('1 short row was padded'), await status());

// A pad only ever adds empty space, so a floor that came up short ends in a hole rather than in ground.
// That is the whole safety argument, and it is worth a check rather than a comment: the padded level has
// less ground than the one that arrived whole, never more.
const holed = gapLevel(4).split('\n');
holed[HEIGHT - 1] = holed[HEIGHT - 1].slice(0, -1);
const withHole = await offer(holed.join('\n'));
check(
  results,
  'padding a floor leaves a hole rather than filling one',
  withHole.solid === crossable.solid - 1,
  `${crossable.solid} solid whole -> ${withHole.solid} solid padded`,
);

// ---------------------------------------------------------------- and nothing downstream is softened

const strandedShort = gapLevel(7).split('\n');
strandedShort[3] = strandedShort[3].slice(1);
const stillImpossible = await offer(strandedShort.join('\n'));
check(
  results,
  'a padded level that cannot be played is still refused',
  !stillImpossible.ok && stillImpossible.problems.some((problem) => problem.includes('goal-jar cannot be reached')),
  stillImpossible.problems.join(' | '),
);
check(results, 'the pad is reported on a refused draft too', stillImpossible.pads.length === 1, stillImpossible.pads.join(' | '));
check(results, 'a padded draft that cannot be played cannot be accepted', !(await canAccept()));

const jarless = gapLevel(4).replace('J', '.').split('\n');
jarless[2] = jarless[2].slice(1);
const noJar = await offer(jarless.join('\n'));
check(
  results,
  "the editor's own checks run on a padded level unchanged",
  !noJar.ok && noJar.problems.some((problem) => problem.includes('No goal-jar')),
  noJar.problems.join(' | '),
);
check(results, 'with the pad reported beside them', noJar.pads.length === 1, noJar.pads.join(' | '));

// ---------------------------------------------------------------- shortfalls that are not slips

const badlyShort = gapLevel(4).split('\n');
badlyShort[5] = badlyShort[5].slice(6); // 24 of 30: 20% gone, which is a row drawn wrong
const refusedShort = await offer(badlyShort.join('\n'));
check(
  results,
  'a row 20% short is refused, naming the row and both lengths',
  !refusedShort.ok && refusedShort.problems.some((problem) => problem.includes('row 5 is 24, 6 short of 30')),
  refusedShort.problems.join(' | '),
);
is(results, 'a refused layout is not padded at all', refusedShort.pads, []);

const overLong = gapLevel(4).split('\n');
overLong[4] = `${overLong[4]}..`;
const refusedLong = await offer(overLong.join('\n'));
check(
  results,
  'an over-long row is refused rather than trimmed',
  !refusedLong.ok && refusedLong.problems.some((problem) => problem.includes('row 4 is 32, 2 over') && problem.includes('never trimmed')),
  refusedLong.problems.join(' | '),
);

// ---------------------------------------------------------------- rows, rather than characters

const missingRow = gapLevel(4).split('\n').slice(1); // the top row, which was empty air
const grown = await offer(missingRow.join('\n'));
check(
  results,
  'a missing row is added at the top, where a map keeps its empty space',
  grown.ok && grown.pads.some((pad) => pad.includes(`1 short of ${HEIGHT}`) && pad.includes('at the top')),
  grown.pads.join(' | '),
);
is(results, 'and the level comes out with the ground it arrived with', grown.solid, crossable.solid);
is(results, 'and the objects it arrived with', grown.objects, crossable.objects);

const tallMap = [...gapLevel(4).split('\n'), '.'.repeat(WIDTH)];
const refusedTall = await offer(tallMap.join('\n'));
check(
  results,
  'a layout with too many rows is refused rather than trimmed',
  !refusedTall.ok && refusedTall.problems.some((problem) => problem.includes(`${HEIGHT + 1} rows tall`)),
  refusedTall.problems.join(' | '),
);

// ---------------------------------------------------------------- re-parsing a saved reply is free

/**
 * The other half of not paying twice. Every reply is written to .level-raw as it arrives, so one that
 * was refused for something since fixed can be read again for nothing.
 *
 * A fixture is written straight into .level-raw here, the way the art suite writes a strip into
 * .art-raw, and then re-parsed through the same route and the same panel a real one would go through.
 * No API call is made - the route has no key and never reaches for the SDK - and the model named in the
 * fixture is one that does not exist, so a reply that had been fetched rather than read could not carry
 * it back.
 */

const RAW_DIR = join(process.cwd(), '.level-raw');
const FIXTURE = 'suite-saved-reply-202609190000.json';
await mkdir(RAW_DIR, { recursive: true });
await writeFile(
  join(RAW_DIR, FIXTURE),
  `${JSON.stringify({
    at: '2026-09-19T00:00:00.000Z',
    description: 'a fixture, not a real generation',
    size: { width: WIDTH, height: HEIGHT },
    previous: null,
    model: 'no-model-was-called',
    usage: { input: 0, output: 0 },
    seconds: 0,
    stop: 'end_turn',
    reply: fenced(gapLevel(4)),
  }, null, 2)}\n`,
);

const listing = await get('/api/level-raw');
check(
  results,
  'a saved reply is listed with what was asked for',
  listing.body.files?.some((file) => file.name === FIXTURE && file.size === `${WIDTH}x${HEIGHT}`),
  JSON.stringify(listing.body.files?.slice(0, 3) ?? listing.body),
);

const fresh = await offer(gapLevel(4));
const reread = await page.evaluate((raw) => window.__editor.reparse(raw), FIXTURE);
is(results, 'a re-parsed reply gives the same draft as the reply itself did', reread, fresh);
check(results, 'the panel says plainly that it cost nothing', (await status()).includes('no API call, nothing spent'), await status());
check(results, 'a re-parsed draft can be accepted like any other', await canAccept());

const climbing = await post('/api/reparse-level', { raw: '../.env' });
is(results, 'a name that is not a file in .level-raw is refused', climbing.status, 400);
const absent = await post('/api/reparse-level', { raw: 'no-such-reply-202601010000.json' });
is(results, 'a reply that is not there is a 404, naming it', absent.status, 404);
check(results, 'and says which one', absent.body.error?.includes('no-such-reply-202601010000.json'), absent.body.error);

await rm(join(RAW_DIR, FIXTURE), { force: true });

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
