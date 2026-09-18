// A level's maximum must not depend on the order things are taken in: nutrient first has to be worth
// exactly as much as stomping first. Also pins the kill rules the fix touches.

import {
  check,
  clearRemainingWhileInvincible,
  clearStompables,
  freshGame,
  is,
  launch,
  report,
  sleep,
  startLevel,
  survey,
  take,
  takeAll,
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

const rootRots = () => page.evaluate(() => {
  const alive = window.__growop.scene.getScene('GameScene').enemies.getChildren().filter((e) => !e.defeated);
  return { full: alive.filter((e) => e.isSmall === false).length, mini: alive.filter((e) => e.isSmall === true).length };
});

// ---- 1. one full-size blob, walked through under a nutrient ----
await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  window.__growop.registry.set('lives', 99);
  // Leave exactly one full-size blob. Over a copy: destroy() removes from the group as we go.
  let kept = false;
  for (const enemy of [...scene.enemies.getChildren()]) {
    if (!kept && enemy.isSmall === false) {
      kept = true;
      continue;
    }
    enemy.destroy();
  }
});
await sleep(120);
const before = await rootRots();
is(results, 'one full-size root rot on the field', before, { full: 1, mini: 0 });

await take(page, 'nutrient');
const invincible = await page.evaluate(() => window.__growop.scene.getScene('GameScene').player.isInvincible());
check(results, 'the nutrient made the player invincible', invincible === true);

const scoreBefore = await page.evaluate(() => window.__growop.registry.get('levelScore'));
await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  const blob = scene.enemies.getChildren().find((e) => !e.defeated && e.isSmall === false);
  blob.activate();
  scene.player.body.reset(blob.x, blob.y);
});
await sleep(200);
let after = await rootRots();
is(results, 'INVINCIBLE CONTACT SPLITS a full-size blob into two minis', after, { full: 0, mini: 2 });
const splitScore = await page.evaluate(() => window.__growop.registry.get('levelScore'));
is(results, 'the split itself pays the same 100 a stomp does', splitScore - scoreBefore, 100);

// the player keeps falling through; no bounce off an invincible-contact split
const vy = await page.evaluate(() => window.__growop.scene.getScene('GameScene').player.body.velocity.y);
check(results, 'the player does not bounce off it', vy >= 0, `velocity.y ${vy}`);

// ---- 2. minis still die outright to invincible contact, and do not split again ----
await sleep(400); // their spawn grace
await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  const mini = scene.enemies.getChildren().find((e) => !e.defeated && e.isSmall === true);
  mini.activate();
  scene.player.body.reset(mini.x, mini.y);
});
await sleep(200);
after = await rootRots();
check(results, 'a mini dies outright and leaves nothing behind', after.mini === 1 && after.full === 0, JSON.stringify(after));

// ---- 3. the slash still does nothing to either size ----
const slash = await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  const mini = scene.enemies.getChildren().find((e) => !e.defeated && e.isSmall === true);
  const blob = scene.spawnEnemy('root-rot', mini.x + 200, mini.y);
  blob.activate();
  const scoredBefore = window.__growop.registry.get('levelScore');
  scene.onSlashHit(scene.player.attackZone, mini);
  scene.onSlashHit(scene.player.attackZone, blob);
  return {
    miniDead: mini.defeated,
    blobDead: blob.defeated,
    scored: window.__growop.registry.get('levelScore') - scoredBefore,
    slashableMini: mini.slashable,
    slashableBlob: blob.slashable,
  };
});
check(results, 'the slash does nothing to either root rot size',
  slash.miniDead === false && slash.blobDead === false && slash.scored === 0, JSON.stringify(slash));

// ---- 4. other enemies are unchanged by invincible contact ----
const others = await page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  const out = {};
  for (const kind of ['spider-mite', 'fungus-gnat']) {
    const countBefore = scene.enemies.getChildren().filter((e) => !e.defeated).length;
    const enemy = scene.spawnEnemy(kind, scene.player.x + 300, scene.player.y - 100);
    enemy.activate();
    const scoredBefore = window.__growop.registry.get('levelScore');
    scene.onEnemyContact(scene.player, enemy); // the player is still invincible
    out[kind] = {
      defeated: enemy.defeated,
      scored: window.__growop.registry.get('levelScore') - scoredBefore,
      spawned: scene.enemies.getChildren().filter((e) => !e.defeated).length - countBefore,
    };
  }
  return out;
});
check(results, 'a mite still dies outright for 100, spawning nothing',
  others['spider-mite'].defeated === true && others['spider-mite'].scored === 100 && others['spider-mite'].spawned === 0, JSON.stringify(others));
check(results, 'a gnat still dies outright for 100, spawning nothing',
  others['fungus-gnat'].defeated === true && others['fungus-gnat'].scored === 100 && others['fungus-gnat'].spawned === 0, JSON.stringify(others));

// ---- 5. the whole level, nutrient taken FIRST, must still be worth 2910 ----
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForTitle(page);
await sleep(300);
await startLevel(page);
const fresh = await survey(page);
check(results, 'a fresh level to run in order', fresh.levelScore === 0 && fresh.maxScore === 2910, JSON.stringify(fresh));
await page.evaluate(() => window.__growop.registry.set('lives', 99));

const gotNutrient = await take(page, 'nutrient');
check(results, 'nutrient-first run: the nutrient is taken before anything else', gotNutrient === true);
await clearRemainingWhileInvincible(page); // walks through whatever it can reach while protected
await clearStompables(page); // the minis that walk-through left behind, once invincibility lapses
await clearRemainingWhileInvincible(page);
await takeAll(page, 'water-drop');
await takeAll(page, 'light-orb');
const swept = await survey(page);
check(results, 'nutrient-first: nothing collectable left on the field',
  swept.enemiesAlive === 0 && swept.pickupsLeft === 0, JSON.stringify(swept));
is(results, 'nutrient-first: everything but the jar is still 2410', swept.levelScore, 2410);

await touchJar(page);
const t = await texts(page, 'LevelCompleteScene');
check(results, 'NUTRIENT FIRST STILL REACHES 2910 AND EXOTIC',
  t.some((o) => o.text === '2910 / 2910   100%') && t.some((o) => o.text === 'Exotic'), JSON.stringify(t.map((o) => o.text)));
check(results, 'console clean', noise.length === 0, noise.join(' | '));

report(results);
await browser.close();
