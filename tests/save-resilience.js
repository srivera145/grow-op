// Check 3: a corrupt growop.save starts the game clean instead of crashing.
// Check 4: with localStorage disabled the game still plays, keeps nothing, and says nothing.

import {
  blockStorage,
  check,
  completeLevel,
  launch,
  openGame,
  report,
  saved,
  sleep,
  startLevel,
  texts,
  watchConsole,
} from './harness.js';
const results = [];
const browser = await launch();

// ---------- corrupt / foreign saves ----------
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const noise = watchConsole(page);
await openGame(page);

const CASES = {
  'not JSON at all': '{oops',
  'empty string': '',
  'JSON null': 'null',
  'a JSON array': '[1,2,3]',
  'a bare number': '42',
  'no version': '{"plays":3,"completed":true,"levels":{"world1-1":{"score":9999}}}',
  'the previous schema (v1)': '{"version":1,"plays":9,"completed":true,"levels":{"world1-1":{"score":5200,"grade":"Exotic","timeMs":50000,"drops":30,"completions":3}}}',
  'a future version': '{"version":99,"plays":3,"completed":true,"levels":{"world1-1":{"score":9999,"grade":"Exotic","completions":4}}}',
  'right version, junk fields': '{"version":2,"plays":"lots","completed":"yes","levels":{"world1-1":{"score":"9999","grade":"Legendary","timeMs":-5,"drops":null,"completions":2.7}}}',
  'levels is a string': '{"version":2,"plays":2,"completed":true,"levels":"nope"}',
  'valid counts but an unknown grade': '{"version":2,"plays":2,"completed":true,"levels":{"world1-1":{"score":9999,"grade":"Legendary","timeMs":1000,"drops":3,"completions":1}}}',
  'truncated object': '{"version":2,"plays":2,"completed":true,"levels":{"world1-1":{"score":',
};

for (const [name, value] of CASES.constructor === Object ? Object.entries(CASES) : []) {
  noise.length = 0;
  await page.evaluate((v) => localStorage.setItem('growop.save', v), value);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__growop?.scene.getScene('TitleScene')?.scene.isActive(), { timeout: 30000 });
  await sleep(350);
  const t = await texts(page, 'TitleScene');
  const state = await page.evaluate(() => {
    const title = window.__growop.scene.getScene('TitleScene');
    return { active: title.scene.isActive(), texts: title.children.list.length };
  });
  const best = t.find((o) => o.text.startsWith('BEST'));
  // An unrecognised grade alone is not disqualifying: the counts are sound, so the score is kept, and
  // the stored grade does not matter anyway now that grades are recomputed from the score on read.
  // Everything else must leave the title with nothing to show.
  const expected = name === 'valid counts but an unknown grade' ? 'BEST  Exotic  009999' : undefined;
  check(results, `corrupt (${name}): title boots`, state.active && t.length > 0);
  check(results, `corrupt (${name}): handled as designed`, best?.text === expected, JSON.stringify(t.map((o) => o.text)));
  check(results, `corrupt (${name}): console clean`, noise.length === 0, noise.join(' | '));
}

// the game is still playable after a corrupt file, and the next write replaces it
await startLevel(page);
await completeLevel(page, { score: 700, drops: 5, timeMs: 40000 });
const rewritten = JSON.parse(await saved(page));
check(results, 'corrupt file is replaced by the next real result',
  rewritten.version === 2 && rewritten.levels['world1-1'].score === 1200 && rewritten.levels['world1-1'].completions === 1,
  JSON.stringify(rewritten));
await page.close();

// ---------- localStorage switched off entirely ----------
const blocked = await browser.newPage();
await blocked.setViewport({ width: 960, height: 540 });
const blockedNoise = watchConsole(blocked);
await blockStorage(blocked);
await openGame(blocked);
let t = await texts(blocked, 'TitleScene');
check(results, 'no storage: title boots', t.length > 0, JSON.stringify(t.map((o) => o.text)));
check(results, 'no storage: no saved data shown', !t.some((o) => o.text.startsWith('BEST')));
check(results, 'no storage: no erase option (nothing stored yet)', !t.some((o) => o.text.startsWith('Erase')));

await startLevel(blocked);
const hud = await blocked.evaluate(() => {
  const h = window.__growop.scene.getScene('HUDScene');
  return { bestScore: h.bestScore, score: window.__growop.registry.get('score'), lives: window.__growop.registry.get('lives') };
});
check(results, 'no storage: the level plays', hud.bestScore === null && hud.lives === 3, JSON.stringify(hud));

await completeLevel(blocked, { score: 2000, drops: 12, timeMs: 51000 });
t = await texts(blocked, 'LevelCompleteScene');
check(results, 'no storage: grade screen still works', t.some((o) => o.text === 'Top Shelf') && t.some((o) => o.text === '2500 / 2910   85%'), JSON.stringify(t.map((o) => o.text)));
check(results, 'no storage: treated as a first harvest', t.filter((o) => o.text === '--').length === 3);
check(results, 'no storage: console completely clean', blockedNoise.length === 0, blockedNoise.join(' | '));

// a second run in the same visit still compares, from memory
await blocked.keyboard.down('r'); await sleep(70); await blocked.keyboard.up('r');
await blocked.waitForFunction(() => window.__growop.scene.getScene('GameScene')?.state === 'playing', { timeout: 30000 });
await sleep(300);
const hud2 = await blocked.evaluate(() => window.__growop.scene.getScene('HUDScene').bestScore);
check(results, 'no storage: records still work within the visit', hud2 === 2500, String(hud2));
check(results, 'no storage: still nothing logged', blockedNoise.length === 0, blockedNoise.join(' | '));

report(results);
await browser.close();
