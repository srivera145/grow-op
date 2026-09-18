// The carry-over bug: with a second level registered, entering it with a carried score must not trip the
// NEW BEST flash, and finishing it must file only what that level earned.

import {
  addSecondLevel,
  check,
  completeLevel,
  freshGame,
  is,
  launch,
  nextLevel,
  replayLevel,
  report,
  saved,
  sleep,
  startLevel,
  texts,
  touchJar,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);
const patchCount = await addSecondLevel(page);

await freshGame(page);

const levels = await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  return scene ? null : null;
});
check(results, 'the patched constants.js was served', patchCount() > 0, `patched ${patchCount()} time(s)`);

const state = () => page.evaluate(() => {
  const game = window.__growop;
  const g = game.scene.getScene('GameScene');
  const h = game.scene.getScene('HUDScene');
  return {
    level: g?.level.key,
    score: game.registry.get('score'),
    levelScore: game.registry.get('levelScore'),
    hudScore: h?.scoreText.text,
    best: h?.bestScore,
    flashed: h?.newBestFlashed,
  };
});

// ---- 1-1, earn 1200, finish (jar adds 500) ----
await startLevel(page);
await completeLevel(page, { score: 1200, drops: 20, timeMs: 60000 });
let save = JSON.parse(await saved(page));
check(results, '1-1 filed its own 1700', save.levels['world1-1'].score === 1700, JSON.stringify(save.levels));
check(results, 'save is at version 2', save.version === 2, String(save.version));

// ---- Next into 1-2, carrying 1700 ----
await nextLevel(page);
let s = await state();
check(results, 'Next advanced to 1-2', s.level === 'world1-2', JSON.stringify(s));
is(results, 'the run total carried over intact', s.score, 1700);
is(results, 'level-earned reset to zero on entering 1-2', s.levelScore, 0);
is(results, 'the HUD still reads the cumulative run total', s.hudScore, '001700');
check(results, 'no flash on entering 1-2 with a carried score', s.flashed === false, JSON.stringify(s));
check(results, '1-2 has no stored best of its own yet', s.best === null, JSON.stringify(s));

// score well past 1-1's stored best while still inside 1-2
await page.evaluate(() => window.__growop.scene.getScene('GameScene').addScore(900));
await sleep(150);
s = await state();
check(results, 'run total climbs, level-earned tracks separately', s.score === 2600 && s.levelScore === 900, JSON.stringify(s));
check(results, 'still no flash: 1-2 has no record to beat', s.flashed === false, JSON.stringify(s));
check(results, 'HUD still shows the run total, not the level figure', s.hudScore === '002600', JSON.stringify(s));

await completeLevel(page, { score: null, drops: 7, timeMs: 45000 });
let t = await texts(page, 'LevelCompleteScene');
save = JSON.parse(await saved(page));
check(results, '1-2 filed only what 1-2 earned (900 + 500 jar)', save.levels['world1-2'].score === 1400, JSON.stringify(save.levels));
check(results, "1-1's record was not touched by 1-2", save.levels['world1-1'].score === 1700, JSON.stringify(save.levels));
check(results, 'the grade screen grades the level, not the run', t.some((o) => o.text === '1400 / 2910   48%') && t.some((o) => o.text === 'Mids'), JSON.stringify(t.map((o) => o.text)));
check(results, 'the carried run total is still shown', t.some((o) => o.text === 'Run total') && t.some((o) => o.text === '3100'), JSON.stringify(t.map((o) => o.text)));
check(results, 'no NEW BEST on a first completion of 1-2', !t.some((o) => o.text === 'NEW BEST'));

// ---- back into 1-1 via Next, carrying 3100, which beats 1-1's stored 1700 ----
await nextLevel(page);
s = await state();
check(results, 'Next looped back to 1-1', s.level === 'world1-1', JSON.stringify(s));
check(results, '1-1 knows its own best again', s.best === 1700, JSON.stringify(s));
check(results, 'THE BUG: a carried 3100 does not trip 1-1 flash', s.flashed === false && s.score === 3100 && s.levelScore === 0, JSON.stringify(s));

// Prove the check is not vacuous: fed the run total, the way the old code did it, the flash DOES fire.
const wouldHaveFired = await page.evaluate(() => {
  const h = window.__growop.scene.getScene('HUDScene');
  h.flashNewBest(window.__growop.registry.get('score')); // what the pre-fix code compared
  const fired = h.newBestFlashed;
  h.newBestFlashed = false; // put it back so the real check below still means something
  h.newBestText.setAlpha(0);
  return fired;
});
check(results, 'the old comparison (run total) would have fired here', wouldHaveFired === true, String(wouldHaveFired));

// earn past it for real inside 1-1
await page.evaluate(() => window.__growop.scene.getScene('GameScene').addScore(1701));
await sleep(150);
s = await state();
check(results, 'the flash fires on real level earnings past the best', s.flashed === true, JSON.stringify(s));

// ---- Replay resets level-earned; the stored best is untouched ----
await touchJar(page);
const savedBeforeReplay = await saved(page);
await replayLevel(page);
s = await state();
check(results, 'Replay resets level-earned to zero', s.levelScore === 0, JSON.stringify(s));
check(results, 'Replay also resets the run total (it is a fresh run)', s.score === 0, JSON.stringify(s));
const levelsBefore = JSON.stringify(JSON.parse(savedBeforeReplay).levels);
const levelsAfter = JSON.stringify(JSON.parse(await saved(page)).levels);
check(results, 'Replay leaves the records untouched', levelsAfter === levelsBefore, `${levelsBefore} -> ${levelsAfter}`);
check(results, 'Replay does count as another play', JSON.parse(await saved(page)).plays === JSON.parse(savedBeforeReplay).plays + 1);
check(results, 'Replay clears the flash for the new attempt', s.flashed === false, JSON.stringify(s));
check(results, 'console clean throughout', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
