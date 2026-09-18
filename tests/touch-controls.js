// The title's "tap anywhere to start" must not fire when the tap lands on the erase option
// or on the confirmation over it. Same pointer path as the mouse, but worth proving on a phone.
import {
  BASE_URL,
  check,
  launch,
  report,
  saved,
  sleep,
  tapGame,
  texts,
  waitForTitle,
  watchConsole,
} from './harness.js';
import { KnownDevices } from 'puppeteer-core';

const results = [];
const browser = await launch();
const page = await browser.newPage();
await page.emulate(KnownDevices['iPhone 14 landscape']);
const noise = watchConsole(page);
// Fullscreen cannot be entered headless; count the attempts instead.
await page.evaluateOnNewDocument(() => { window.__fs = 0; });

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await page.evaluate(() => {
  window.__growop.scale.startFullscreen = () => { window.__fs += 1; };
  localStorage.setItem('growop.save', JSON.stringify({
    version: 2, plays: 3, completed: true,
    levels: { 'world1-1': { score: 2600, grade: 'Top Shelf', timeMs: 51000, drops: 30, completions: 2 } },
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await page.evaluate(() => { window.__growop.scale.startFullscreen = () => { window.__fs += 1; }; });
await sleep(600);

const state = () => page.evaluate(() => ({
  title: window.__growop.scene.getScene('TitleScene').scene.isActive(),
  game: window.__growop.scene.getScene('GameScene').scene.isActive(),
  confirming: window.__growop.scene.getScene('TitleScene').confirming,
  fullscreen: window.__fs,
}));

let t = await texts(page, 'TitleScene');
check(results, 'phone: prompt is the tap wording', t.some((o) => o.text === 'Tap to start'), JSON.stringify(t.map((o) => o.text)));
check(results, 'phone: erase option drops the key hint', t.some((o) => o.text === 'Erase records'), JSON.stringify(t.map((o) => o.text)));
check(results, 'phone: best line shows', t.some((o) => o.text === 'BEST  Top Shelf  002600'));

await tapGame(page, 480, 490); // the erase option
let s = await state();
check(results, 'phone: tapping erase opens the confirmation, not the game', s.confirming === true && s.game === false, JSON.stringify(s));
check(results, 'phone: tapping erase does not go fullscreen either', s.fullscreen === 0, JSON.stringify(s));

await tapGame(page, 480, 120); // empty part of the backdrop
s = await state();
check(results, 'phone: tapping the backdrop does nothing', s.confirming === true && s.game === false, JSON.stringify(s));

await tapGame(page, 380, 318); // Cancel
s = await state();
check(results, 'phone: Cancel closes it without starting the game', s.confirming === false && s.game === false, JSON.stringify(s));
check(results, 'phone: the save survived', (await saved(page)) !== null);

await tapGame(page, 480, 490);
await tapGame(page, 580, 318); // Erase
s = await state();
t = await texts(page, 'TitleScene');
check(results, 'phone: Erase clears it and stays on the title', s.game === false && (await saved(page)) === null, JSON.stringify(s));
check(results, 'phone: title back to its pre-completion state', !t.some((o) => o.text.startsWith('BEST')) && !t.some((o) => o.text.startsWith('Erase')), JSON.stringify(t.map((o) => o.text)));

// a tap anywhere else still starts the game, and still asks for fullscreen
await tapGame(page, 480, 300);
s = await state();
check(results, 'phone: a normal tap still starts the game', s.game === true, JSON.stringify(s));
check(results, 'phone: a normal tap still asks for fullscreen', s.fullscreen === 1, JSON.stringify(s));
check(results, 'phone: console clean', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
