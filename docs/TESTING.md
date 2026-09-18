# Testing Grow Op

Two checks, both plain node scripts. There is no test framework and no CI config.

| Command | What it does | Takes |
| --- | --- | --- |
| `npm run check-levels` | Reads every level file and checks what it is worth | instant |
| `npm run smoke` | Drives the real game in a real browser, nine suites | ~100s |

Run `npm run smoke` before committing anything that touches scoring, saving, or a scene.

## npm run smoke

Nine end-to-end suites. They open the real game in Chrome and read state back out of the running Phaser
instance through `window.__growop`, which `main.js` exposes in dev builds only. Nothing is stubbed: when a
suite says a root rot split, a root rot really split.

```
npm run smoke                 # all nine, headless
npm run smoke -- --headed     # a visible browser, one suite at a time, for watching a failure
npm run smoke -- save         # only suites whose filename contains "save"
npm run smoke -- --jobs 1     # one at a time
```

It exits 1 if anything fails, and prints the suite, the check, and what it expected against what it got.
Each suite is a separate process against a freshly loaded page, so they can be run in any order, or one at
a time with `node tests/<suite>.js` while a dev server is up.

**The dev server.** If something is already answering on `http://localhost:5173/` it is used and left
running. Otherwise a server is started for the run and stopped again at the end. A server you started
yourself is never touched.

**Chrome.** `puppeteer-core` drives a Chrome that is already installed rather than downloading its own, so
installing this does not pull a browser. The usual install locations are checked; if yours is somewhere
else, point `GROWOP_CHROME` at it:

```
set GROWOP_CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe   # Windows
export GROWOP_CHROME=/usr/bin/chromium                                    # Linux, macOS
```

**Speed.** Suites run two at a time by default. Each drives its own Chrome, and past two they slow each
other down more than the parallelism wins back. Raise it with `--jobs` on a bigger machine.

### The suites

| Suite | Covers |
| --- | --- |
| `save-persistence.js` | A result survives a refresh. Best score, grade, time and drops are recorded; a worse run does not overwrite them; the HUD's NEW BEST flash fires when the stored best is passed and not on a tie. |
| `save-resilience.js` | A corrupt, truncated, foreign-version or junk-typed `growop.save` starts the game clean and silent, and the next result replaces it. With `localStorage` throwing on access, the game still plays, keeps records in memory for the visit, and logs nothing. |
| `title-reset.js` | The title's erase option: the confirmation opens without starting the game, Cancel and Escape keep the save, Erase and `Y` clear it, and the title returns to its pre-completion state across a refresh. |
| `touch-controls.js` | The same erase flow by finger on an emulated phone, proving a tap on the option is not also read as "tap anywhere to start", and that an ordinary tap still starts the game and asks for fullscreen. |
| `played-run.js` | Score, drops and the clock reaching the save from real play: real pickups collected, the real clock running, the real jar touched. |
| `score-carryover.js` | Score is per level. With a second level registered, a run total carried into the next level does not trip its NEW BEST flash, and each level files only what it earned. Replay resets the level's earnings and leaves the records alone. |
| `grade-percentage.js` | Grades as a share of a level's maximum: the maximum is known before any level loads, a jar-only run is Shake, and taking everything in the level reaches 100% and Exotic. |
| `grade-recompute.js` | A stored grade is recomputed from the stored score, upwards and downwards, so an old save never shows a grade its score no longer earns. With nothing scoreable in a level, grading falls back to absolute scores, warns once, and does not divide by zero. |
| `scoring-order.js` | A level is worth the same whatever order it is taken in: invincible contact splits a root rot exactly as a stomp does, minis still die outright, the slash still does nothing to either, other enemies are unchanged, and a nutrient-first run still reaches the full 2910. |

### Writing one

`tests/harness.js` holds everything shared: finding Chrome, booting the page, driving a level, reading the
screen, and taking a whole level apart. A suite is a plain script.

```js
import { check, freshGame, is, launch, report, startLevel, texts, watchConsole } from './harness.js';

const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 }); // 1 canvas pixel = 1 screen pixel
const noise = watchConsole(page);

await freshGame(page);          // a clean page with no saved data
await startLevel(page);

is(results, 'the level knows what it is worth', await page.evaluate(() => window.__growop.registry.get('levelMaxScore')), 2910);
check(results, 'console stayed clean', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
```

- `is(results, name, actual, expected)` prints both sides when it fails. Prefer it for equality.
- `check(results, name, passed, actual)` is for everything else; name the expectation in `name`, and pass
  whatever you observed as `actual` so a failure says what happened.
- `report(results)` prints the tally, sets the exit code, and hands the runner its summary.

Things that have caught people out, all of them real:

- **Hold a key across a frame.** Phaser clears the just-pressed flag on key up, so `page.keyboard.press`
  is lost. Use `tap(page, key)`.
- **Leave the grade screen with `replayLevel` / `nextLevel`.** It arms its keys a beat after opening, so a
  bare keypress lands in the gap and the suite waits forever. Those helpers wait for the binding.
- **Wait on something only the new scene can be true of.** After a restart, the outgoing scene still
  reports `state === 'playing'` for a moment.
- **Never track enemies by index or by how long the group is.** A root rot split makes the group *longer*,
  so "did it get shorter" is false exactly when the stomp worked. Stamp an id on each one.
- **`isSmall` is `false` on a full-size root rot, `true` on a mini and `undefined` on everything else,** so
  `isSmall !== false` keeps the blobs and destroys everything else. Compare explicitly.
- **Iterate a copy** when destroying things out of a Phaser group.
- **Match `warn` as well as `warning`** when reading the console: puppeteer-core reports `console.warn` as
  `warn`, and a filter that only looks for `warning` silently sees nothing.
- **Score points with `addScore`,** not by writing the registry: writing the run total directly leaves the
  per-level figure, the one that gets recorded, at zero.
- **Keep injected scores inside the level's real maximum,** or percentages read over 100.

## npm run check-levels

Prints each level's maximum with a per-object breakdown, and fails if a level holds an object that
`objectValues()` in `src/state/levelScore.js` has no score for. That is how a new enemy silently lowers
every grade in a level. It also fails on a level worth nothing at all.

It covers the level-file half of "a level's maximum is always the same figure". The other half, that the
maximum does not depend on the order a player collects things in, is a property of the kill rules rather
than of the level file, and lives in `scoring-order.js`.
