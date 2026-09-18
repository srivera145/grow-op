// The stored drops, time and score come from real play: real pickups, the real clock, no values injected.

import {
  check,
  freshGame,
  launch,
  report,
  saved,
  sleep,
  startLevel,
  texts,
  touchJar,
  waitForTitle,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);

await freshGame(page);
await startLevel(page);

// Walk onto four real water drops, one at a time, letting the overlap fire each time.
const collected = [];
for (let i = 0; i < 4; i += 1) {
  const got = await page.evaluate((n) => {
    const scene = window.__growop.scene.getScene('GameScene');
    const drops = scene.pickups.getChildren().filter((p) => p.kind === 'water-drop' && !p.collected);
    if (!drops[0]) return null;
    scene.player.body.reset(drops[0].x, drops[0].y);
    return { n, remaining: drops.length };
  }, i);
  await sleep(260);
  collected.push(await page.evaluate(() => window.__growop.scene.getScene('GameScene').levelDrops));
}
check(results, 'four real drops were collected', collected[3] === 4, JSON.stringify(collected));

const mid = await page.evaluate(() => ({
  score: window.__growop.registry.get('score'),
  drops: window.__growop.registry.get('drops'),
  levelDrops: window.__growop.scene.getScene('GameScene').levelDrops,
}));
check(results, 'the score came from the pickups (4 x 10)', mid.score === 40, JSON.stringify(mid));

await sleep(2500); // let the real clock run
const clock = await page.evaluate(() => window.__growop.registry.get('time'));
check(results, 'the HUD clock is running', clock >= 3, String(clock));

// Touch the goal jar for real, with nothing injected.
await touchJar(page);

const t = await texts(page, 'LevelCompleteScene');
check(results, 'grade screen shows the played score out of the level max', t.some((o) => o.text === '540 / 2910   18%'), JSON.stringify(t.map((o) => o.text)));
check(results, 'grade screen shows the played drops', t.some((o) => o.text === '4'));

const save = JSON.parse(await saved(page));
const best = save.levels['world1-1'];
check(results, 'a real run is stored intact', best.score === 540 && best.drops === 4 && best.grade === 'Shake', JSON.stringify(best));
check(results, 'the stored time matches the clock that ran', best.timeMs >= 3000 && best.timeMs < 30000, String(best.timeMs));

// refresh and confirm it survived
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await sleep(400);
const title = await texts(page, 'TitleScene');
check(results, 'it survived the refresh', title.some((o) => o.text === 'BEST  Shake  000540'), JSON.stringify(title.map((o) => o.text)));
check(results, 'console clean', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
