// Check 1: finish the level, refresh, and see the best score and grade survive.
// Check 2: beat it (NEW BEST fires), then fail to beat it (it does not).

import {
  check,
  completeLevel,
  earn,
  freshGame,
  is,
  launch,
  replayLevel,
  report,
  saved,
  sleep,
  startLevel,
  texts,
  waitForTitle,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);

await freshGame(page);

// --- a clean title shows no best and no reset option ---
let t = await texts(page, 'TitleScene');
check(results, 'clean title: no BEST line', !t.some((o) => o.text.startsWith('BEST')), JSON.stringify(t.map((o) => o.text)));
check(results, 'clean title: no erase option', !t.some((o) => o.text.startsWith('Erase')));

// --- run 1: first completion ---
await startLevel(page);
let hud = await page.evaluate(() => {
  const h = window.__growop.scene.getScene('HUDScene');
  return { bestScore: h.bestScore, flashed: h.newBestFlashed };
});
check(results, 'run 1 HUD has no best to beat', hud.bestScore === null, JSON.stringify(hud));

await completeLevel(page, { score: 1200, drops: 24, timeMs: 62400 });
t = await texts(page, 'LevelCompleteScene');
const find = (s) => t.filter((o) => o.text === s);
check(results, 'run 1 grade screen: Mids for 1700', t.some((o) => o.text === 'Mids'), JSON.stringify(t.map((o) => o.text)));
check(results, 'run 1: previous column is empty', t.filter((o) => o.text === '--').length === 3);
check(results, 'run 1: says first harvest, not NEW BEST', find('FIRST HARVEST RECORDED').length === 1 && find('NEW BEST').length === 0);

let raw = await saved(page);
const save1 = JSON.parse(raw);
check(results, 'run 1 written to growop.save', raw !== null, raw);
check(results, 'run 1 record correct', save1.version === 2 && save1.completed === true && save1.levels['world1-1'].score === 1700
  && save1.levels['world1-1'].grade === 'Mids' && save1.levels['world1-1'].drops === 24 && save1.levels['world1-1'].completions === 1,
  JSON.stringify(save1));
check(results, 'time recorded to the tenth', Math.abs(save1.levels['world1-1'].timeMs - 62400) < 400, String(save1.levels['world1-1'].timeMs));
check(results, 'plays counted', save1.plays === 1, String(save1.plays));

// --- refresh: does it survive? ---
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await sleep(400);
t = await texts(page, 'TitleScene');
const bestLine = t.find((o) => o.text.startsWith('BEST'));
is(results, 'after refresh the title shows the best', bestLine?.text, 'BEST  Mids  001700');
is(results, 'best line uses the grade colour', bestLine?.color, '#4cd137');
check(results, 'erase option appears', t.some((o) => o.text.startsWith('Erase records')));

// --- run 2: beat it ---
await startLevel(page);
hud = await page.evaluate(() => {
  const h = window.__growop.scene.getScene('HUDScene');
  return { bestScore: h.bestScore, flashed: h.newBestFlashed, alpha: h.newBestText.alpha };
});
check(results, 'run 2 HUD knows the best (1700)', hud.bestScore === 1700 && hud.flashed === false, JSON.stringify(hud));

await earn(page, 1700); // equal to the stored best, not past it
let flashed = await page.evaluate(() => window.__growop.scene.getScene('HUDScene').newBestFlashed);
check(results, 'HUD does not flash on a tie', flashed === false);

await earn(page, 1); // one point past it
const after = await page.evaluate(() => {
  const h = window.__growop.scene.getScene('HUDScene');
  return { flashed: h.newBestFlashed, alpha: h.newBestText.alpha, text: h.newBestText.text };
});
check(results, 'HUD flashes NEW BEST once the best is passed', after.flashed === true && after.alpha > 0 && after.text === 'NEW BEST', JSON.stringify(after));

await completeLevel(page, { score: 2000, drops: 31, timeMs: 55000 }); // 2500 filed: 85% of the level
t = await texts(page, 'LevelCompleteScene');
check(results, 'run 2 grade screen shows NEW BEST', t.some((o) => o.text === 'NEW BEST'), JSON.stringify(t.map((o) => o.text)));
check(results, 'run 2 shows the previous best beside it', t.some((o) => o.text === '1700' && o.x > 560) && t.some((o) => o.text.startsWith('2500 / 2910') && o.x < 600));
check(results, 'run 2 shows the previous grade', t.some((o) => o.text === 'previous best  Mids'));
const rowGold = (list) => list.filter((o) => o.color === '#ffd60a' && o.y >= 150 && o.y <= 240);
check(results, 'beaten values are gold', rowGold(t).length === 3, JSON.stringify(rowGold(t)));

// --- run 3: do not beat it ---
await replayLevel(page);
await completeLevel(page, { score: 400, drops: 3, timeMs: 90000 });
t = await texts(page, 'LevelCompleteScene');
check(results, 'run 3 does NOT show NEW BEST', !t.some((o) => o.text === 'NEW BEST'), JSON.stringify(t.map((o) => o.text)));
check(results, 'run 3 still shows the standing best', t.some((o) => o.text === '2500') && t.some((o) => o.text === '31'));
check(results, 'run 3 has no gold values', rowGold(t).length === 0, JSON.stringify(rowGold(t)));

const save3 = JSON.parse(await saved(page));
check(results, 'a worse run does not overwrite the record', save3.levels['world1-1'].score === 2500 && save3.levels['world1-1'].drops === 31, JSON.stringify(save3.levels));
check(results, 'a worse time does not overwrite the record', Math.abs(save3.levels['world1-1'].timeMs - 55000) < 400, String(save3.levels['world1-1'].timeMs));
check(results, 'completions counted', save3.levels['world1-1'].completions === 3, String(save3.levels['world1-1'].completions));
check(results, 'console stayed clean', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
