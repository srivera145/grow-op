// Stored grades are recomputed from the stored score, and an unworkable level falls back to absolute scores.

import {
  BASE_URL,
  check,
  emptyObjectLayer,
  is,
  launch,
  liveImport,
  openGame,
  report,
  sleep,
  texts,
  waitForTitle,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();

// A save written under the old absolute thresholds. 2700 was Top Shelf then (2500-3999); against
// world1-1's real maximum of 2910 it is 92%, which is Exotic now.
const OLD_SAVE = {
  version: 2, plays: 6, completed: true,
  levels: { 'world1-1': { score: 2700, grade: 'Top Shelf', timeMs: 51000, drops: 28, completions: 3 } },
};

const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);
await openGame(page);
await page.evaluate((save) => localStorage.setItem('growop.save', JSON.stringify(save)), OLD_SAVE);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await sleep(400);

let t = await texts(page, 'TitleScene');
check(results, 'the title shows the recomputed grade, not the stored one',
  t.some((o) => o.text === 'BEST  Exotic  002700'), JSON.stringify(t.map((o) => o.text)));
check(results, 'the stored grade on disk is untouched',
  JSON.parse(await page.evaluate(() => localStorage.getItem('growop.save'))).levels['world1-1'].grade === 'Top Shelf');

const api = await liveImport(page, '/src/state/Save.js', (mod) => ({
  best: mod.default.best(),
  level: mod.default.getLevelBest('world1-1'),
}));
check(results, 'Save recomputes on read for every caller',
  api.best.grade === 'Exotic' && api.level.grade === 'Exotic', JSON.stringify(api));

// the other direction: a score the old table called Mids is only 37% here, which is Shake
await page.evaluate(() => {
  const save = JSON.parse(localStorage.getItem('growop.save'));
  save.levels['world1-1'] = { score: 1100, grade: 'Mids', timeMs: 51000, drops: 10, completions: 3 };
  localStorage.setItem('growop.save', JSON.stringify(save));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await sleep(400);
t = await texts(page, 'TitleScene');
check(results, 'a grade can be recomputed downwards too', t.some((o) => o.text === 'BEST  Shake  001100'), JSON.stringify(t.map((o) => o.text)));
check(results, 'no warning on the normal path', noise.length === 0, noise.join(' | '));

// the previous-best line on the grade screen uses the recomputed grade as well
await page.evaluate(() => window.__growop.scene.start('LevelCompleteScene', { level: 'world1-1', score: 2700, runTotal: 2700, drops: 12, timeMs: 60000 }));
await sleep(700);
t = await texts(page, 'LevelCompleteScene');
check(results, 'the grade screen recomputes the previous best too', t.some((o) => o.text === 'previous best  Shake'), JSON.stringify(t.map((o) => o.text)));
await page.close();

// ---------- a level with nothing scoreable in it ----------
const empty = await browser.newPage();
await empty.setViewport({ width: 960, height: 540 });
const emptyNoise = watchConsole(empty);
await emptyObjectLayer(empty);
await empty.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await empty.waitForFunction(() => window.__growop?.scene.getScene('TitleScene')?.scene.isActive(), { timeout: 30000 });
await sleep(400);

const warnings = emptyNoise.filter((line) => line.includes('levelScore'));
check(results, 'an empty object layer warns, once', warnings.length === 1, JSON.stringify(emptyNoise));
check(results, 'and nothing else was logged', emptyNoise.length === warnings.length, JSON.stringify(emptyNoise));

const fallback = await liveImport(empty, '/src/state/levelScore.js', (mod) => ({
  max: mod.maxScoreForLevel('world1-1'),
  at2700: mod.gradeFor(2700, 0).name,
  at4000: mod.gradeFor(4000, 0).name,
  at900: mod.gradeFor(900, 0).name,
}));
is(results, 'the max is zero, not a crash', fallback.max, 0);
check(results, 'grading falls back to the absolute thresholds',
  fallback.at2700 === 'Top Shelf' && fallback.at4000 === 'Exotic' && fallback.at900 === 'Shake', JSON.stringify(fallback));

// the level still plays, and the grade screen still works, on the fallback path
await empty.keyboard.down('Space'); await sleep(70); await empty.keyboard.up('Space');
await empty.waitForFunction(() => window.__growop.scene.getScene('GameScene')?.state === 'playing', { timeout: 30000 });
await sleep(400);
const hud = await empty.evaluate(() => ({
  max: window.__growop.registry.get('levelMaxScore'),
  harvest: window.__growop.scene.getScene('HUDScene').harvestText.text,
  score: window.__growop.scene.getScene('HUDScene').scoreText.text,
}));
check(results, 'the level still plays with nothing in it', hud.max === 0 && hud.score === '000000', JSON.stringify(hud));
check(results, 'the HUD hides the harvest percent when there is no max', hud.harvest === '', JSON.stringify(hud));

await empty.evaluate(() => window.__growop.scene.start('LevelCompleteScene', { level: 'world1-1', score: 2700, runTotal: 2700, drops: 0, timeMs: 30000 }));
await sleep(700);
t = await texts(empty, 'LevelCompleteScene');
check(results, 'the grade screen grades on absolute scores in the fallback', t.some((o) => o.text === 'Top Shelf'), JSON.stringify(t.map((o) => o.text)));
check(results, 'and shows a bare score, not "2700 / 0"', t.some((o) => o.text === '2700') && !t.some((o) => o.text.includes('/ 0')), JSON.stringify(t.map((o) => o.text)));

report(results);
await browser.close();
