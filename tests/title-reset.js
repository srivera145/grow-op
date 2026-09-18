// Check 5: the reset option clears everything and the title returns to its pre-completion state.

import {
  check,
  clickGame,
  completeLevel,
  freshGame,
  launch,
  replayLevel,
  report,
  saved,
  sleep,
  startLevel,
  tap,
  texts,
  waitForTitle,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);

const sceneState = () => page.evaluate(() => ({
  title: window.__growop.scene.getScene('TitleScene').scene.isActive(),
  game: window.__growop.scene.getScene('GameScene').scene.isActive(),
  confirming: window.__growop.scene.getScene('TitleScene').confirming,
}));

await freshGame(page);

// Record something, then reach the title the way a player does: out of lives.
await startLevel(page);
await completeLevel(page, { score: 2000, drops: 40, timeMs: 48000 }); // 2500 filed: 85%, Top Shelf
await replayLevel(page);
await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  window.__growop.registry.set('lives', 1);
  scene.player.body.reset(scene.player.x, scene.map.heightInPixels + 300);
});
await page.waitForFunction(() => window.__growop.scene.getScene('TitleScene')?.scene.isActive(), { timeout: 30000 });
await sleep(500);

let t = await texts(page, 'TitleScene');
check(results, 'title after a game over shows the best', t.some((o) => o.text === 'BEST  Top Shelf  002500'), JSON.stringify(t.map((o) => o.text)));
const before = await saved(page);
check(results, 'a save exists to clear', before !== null);

// --- opening the confirmation must not also start the game ---
await clickGame(page, 480, 490);
let state = await sceneState();
t = await texts(page, 'TitleScene');
check(results, 'clicking erase opens the confirmation', state.confirming === true && t.some((o) => o.text === 'Erase saved records?'), JSON.stringify(state));
check(results, 'clicking erase does not start the game', state.title === true && state.game === false, JSON.stringify(state));

// --- keys that start the game are inert while it is open ---
await tap(page, 'Space');
await tap(page, 'Enter');
await sleep(200);
state = await sceneState();
check(results, 'Space and Enter cannot start the game through the confirmation', state.game === false && state.confirming === true, JSON.stringify(state));

// --- cancel keeps everything ---
await clickGame(page, 380, 318); // Cancel, now on the left
state = await sceneState();
t = await texts(page, 'TitleScene');
check(results, 'Cancel closes the confirmation', state.confirming === false && !t.some((o) => o.text === 'Erase saved records?'));
check(results, 'Cancel does not start the game', state.game === false && state.title === true, JSON.stringify(state));
check(results, 'Cancel keeps the save', (await saved(page)) === before);
check(results, 'the best is still on screen', t.some((o) => o.text === 'BEST  Top Shelf  002500'));

// --- Escape cancels too ---
await clickGame(page, 480, 490);
await tap(page, 'Escape');
await sleep(200);
check(results, 'Escape cancels', (await sceneState()).confirming === false && (await saved(page)) === before);

// --- erase, by clicking Erase ---
await clickGame(page, 480, 490);
await clickGame(page, 580, 318); // Erase, now on the right
await sleep(300);
check(results, 'the Erase button clears the save', (await saved(page)) === null, String(await saved(page)));
check(results, 'the Erase button does not start the game', (await sceneState()).game === false);

// --- and again by key, on a fresh record ---
await startLevel(page);
await completeLevel(page, { score: 900, drops: 4, timeMs: 70000 });
await replayLevel(page);
await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  window.__growop.registry.set('lives', 1);
  scene.player.body.reset(scene.player.x, scene.map.heightInPixels + 300);
});
await page.waitForFunction(() => window.__growop.scene.getScene('TitleScene')?.scene.isActive(), { timeout: 30000 });
await sleep(600);
await clickGame(page, 480, 490);
await tap(page, 'y');
await sleep(300);
state = await sceneState();
t = await texts(page, 'TitleScene');
check(results, 'Y erases and closes the confirmation', state.confirming === false && state.game === false, JSON.stringify(state));
check(results, 'title is back to its pre-completion state', !t.some((o) => o.text.startsWith('BEST')) && !t.some((o) => o.text.startsWith('Erase')), JSON.stringify(t.map((o) => o.text)));
check(results, 'the key is gone from localStorage', (await saved(page)) === null, String(await saved(page)));
const mem = await page.evaluate(() => {
  const title = window.__growop.scene.getScene('TitleScene');
  return { best: title.children.list.length };
});
check(results, 'title still has its own furniture', mem.best > 0);

// --- and it stays cleared across a refresh ---
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await sleep(350);
t = await texts(page, 'TitleScene');
check(results, 'still cleared after a refresh', !t.some((o) => o.text.startsWith('BEST')) && !t.some((o) => o.text.startsWith('Erase')), JSON.stringify(t.map((o) => o.text)));

// --- the title still works ---
await startLevel(page);
const hud = await page.evaluate(() => ({ best: window.__growop.scene.getScene('HUDScene').bestScore, lives: window.__growop.registry.get('lives') }));
check(results, 'the game still starts after a reset, with no best to beat', hud.best === null && hud.lives === 3, JSON.stringify(hud));
check(results, 'console stayed clean throughout', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
