// Percentage grading: the computed max, a full clear reaching Exotic, and a bare run grading Shake.

import {
  check,
  clearRemainingWhileInvincible,
  clearStompables,
  freshGame,
  is,
  launch,
  liveImport,
  replayLevel,
  report,
  saved,
  startLevel,
  survey,
  take,
  takeAll,
  texts,
  touchJar,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);

await freshGame(page);

// ---- the computed max, known before any level is played ----
const boot = await liveImport(page, '/src/state/levelScore.js', (mod) => ({
  max: mod.maxScoreForLevel('world1-1'),
  gradeAt2619: mod.gradeFor(2619, 2910).name,
  gradeAt2618: mod.gradeFor(2618, 2910).name,
}));
console.log(`computed max for world1-1: ${boot.max}`);
is(results, 'max is known at the title screen, before any level loads', boot.max, 2910);
check(results, 'the 90% Exotic boundary is exact', boot.gradeAt2619 === 'Exotic' && boot.gradeAt2618 === 'Top Shelf', JSON.stringify(boot));

// ---- a bare run: straight to the jar ----
await startLevel(page);
const liveMax = await page.evaluate(() => window.__growop.registry.get('levelMaxScore'));
is(results, 'the level agrees with the boot-time max', liveMax, 2910);

await touchJar(page);
let t = await texts(page, 'LevelCompleteScene');
check(results, 'a jar-only run grades Shake', t.some((o) => o.text === 'Shake'), JSON.stringify(t.map((o) => o.text)));
check(results, 'it shows the score out of the max with a percentage', t.some((o) => o.text === '500 / 2910   17%'), JSON.stringify(t.map((o) => o.text)));

// ---- a full clear ----
await replayLevel(page);

const cleared = await clearStompables(page);
check(results, 'every stompable enemy was stomped, splits included', cleared === true);
let mid = await survey(page);
// 3 root rot at 300 each (the blob plus both its minis) + 6 mites at 100 = 1500. The 3 gnats cannot be
// stomped, so they are still standing. Drops and orbs get swept up incidentally by the falling player,
// which is why the running score is checked against a floor rather than an exact figure here.
check(results, 'stomping left only the 3 gnats', mid.enemiesAlive === 3, JSON.stringify(mid));
check(results, 'stomping paid at least the 1500 the enemies are worth', mid.levelScore >= 1500, JSON.stringify(mid));

const gotNutrient = await take(page, 'nutrient');
check(results, 'the nutrient was taken', gotNutrient === true);
const restCleared = await clearRemainingWhileInvincible(page);
check(results, 'the gnats went down while invincible', restCleared === true);

await takeAll(page, 'water-drop');
await takeAll(page, 'light-orb');
mid = await survey(page);
check(results, 'nothing collectable is left on the field', mid.enemiesAlive === 0 && mid.pickupsLeft === 0, JSON.stringify(mid));
is(results, 'everything but the jar is 2410 of 2910', mid.levelScore, 2410);
is(results, 'the HUD tracks harvest progress', mid.harvest, 'Harvest 82%');

await touchJar(page);
t = await texts(page, 'LevelCompleteScene');
check(results, 'EXOTIC IS REACHABLE: a full clear grades Exotic', t.some((o) => o.text === 'Exotic'), JSON.stringify(t.map((o) => o.text)));
check(results, 'a full clear is exactly the computed max', t.some((o) => o.text === '2910 / 2910   100%'), JSON.stringify(t.map((o) => o.text)));

const save = JSON.parse(await saved(page));
check(results, 'the record stored the full score and Exotic', save.levels['world1-1'].score === 2910 && save.levels['world1-1'].grade === 'Exotic', JSON.stringify(save.levels));
check(results, 'SAVE.VERSION was not bumped', save.version === 2, String(save.version));
check(results, 'console clean', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
