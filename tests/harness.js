import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

/**
 * Shared setup for the smoke suites: finding Chrome, opening the game, driving it, and recording checks.
 *
 * These are end-to-end suites. They drive the real game in a real browser and read state back out of the
 * running Phaser instance through `window.__growop`, which main.js exposes in dev builds only. Nothing is
 * stubbed: when a suite says a root rot split, a root rot really split.
 *
 * Run them with `npm run smoke`. A single suite can be run on its own with `node tests/<suite>.js`,
 * as long as a dev server is up.
 */

// ---------------------------------------------------------------- browser

const CHROME_ENV = 'GROWOP_CHROME';

/** Where Chrome usually is, per platform. Checked in order when the environment variable is not set. */
const CHROME_CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

/**
 * The Chrome to drive. We use puppeteer-core deliberately, so installing the tests does not download a
 * second copy of a browser that is already on the machine; the cost is having to find it ourselves.
 */
export function chromePath() {
  const fromEnv = process.env[CHROME_ENV];
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    throw new Error(`${CHROME_ENV} is set to "${fromEnv}", but there is nothing there.`);
  }

  const found = (CHROME_CANDIDATES[process.platform] ?? []).find((candidate) => existsSync(candidate));
  if (found) return found;

  throw new Error(
    `Could not find Chrome on this machine (looked in the usual places for ${process.platform}).\n` +
      `Set ${CHROME_ENV} to the full path of a Chrome or Chromium executable and run it again, for example:\n` +
      `  ${process.platform === 'win32' ? 'set' : 'export'} ${CHROME_ENV}=${(CHROME_CANDIDATES[process.platform] ?? ['/path/to/chrome'])[0]}`
  );
}

export const BASE_URL = process.env.GROWOP_URL ?? 'http://localhost:5173/';
export const HEADED = process.env.GROWOP_HEADED === '1';

const openBrowsers = new Set();

export async function launch(options = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !HEADED,
    // SwiftShader gives headless Chrome a working WebGL context, which Phaser needs.
    args: ['--enable-unsafe-swiftshader', '--window-size=1000,640'],
    ...options,
  });
  openBrowsers.add(browser);
  return browser;
}

async function closeBrowsers() {
  await Promise.all([...openBrowsers].map((browser) => browser.close().catch(() => {})));
  openBrowsers.clear();
}

// A suite is a script of top-level awaits, so a failed waitForFunction surfaces here. Without this the
// process would exit on the rejection and leave a headless Chrome behind.
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, async (error) => {
    console.error(`\n${suiteName()} crashed: ${error?.stack ?? error}`);
    setTimeout(() => process.exit(1), 5000).unref(); // go even if a wedged browser will not close
    await closeBrowsers();
    process.exit(1);
  });
}

// ---------------------------------------------------------------- checks

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const suiteName = () => (process.argv[1] ?? 'suite').split(/[\\/]/).pop().replace(/\.js$/, '');

/** Records a check. `actual` is whatever was observed, and is printed when the check fails. */
export function check(results, name, passed, actual = '') {
  results.push({ name, passed, actual: String(actual) });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${actual ? `  -- ${actual}` : ''}`);
  return passed;
}

/** Records an equality check. Both sides are printed when it fails, which is usually what you want. */
export function is(results, name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const passed = a === e;
  results.push({ name, passed, actual: a, expected: e });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `\n      expected: ${e}\n      actual:   ${a}`}`);
  return passed;
}

/**
 * Prints the tally and hands the runner a machine-readable summary on the last line, so it can report
 * every failure across every suite without scraping the human output. Sets a failing exit code.
 */
export function report(results) {
  const failures = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failures.length}/${results.length} passed`);
  console.log(`__SMOKE_RESULT__ ${JSON.stringify({ total: results.length, failures })}`);
  if (failures.length > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------- booting the game

/** Collects console errors and warnings plus uncaught errors, so a suite can assert the log stayed clean. */
export function watchConsole(page) {
  const noise = [];
  page.on('console', (message) => {
    // puppeteer-core reports console.warn as 'warn', not 'warning'. Match both.
    if (['error', 'warn', 'warning'].includes(message.type())) noise.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => noise.push(`pageerror: ${error.message}`));
  return noise;
}

export async function openGame(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForTitle(page);
  await sleep(300);
}

export async function waitForTitle(page) {
  await page.waitForFunction(() => window.__growop?.scene.getScene('TitleScene')?.scene.isActive(), { timeout: 30000 });
}

/** Reloads to a clean page with no saved data. Every suite starts from here; none depends on another. */
export async function freshGame(page) {
  await openGame(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForTitle(page);
  await sleep(300);
}

/** Phaser clears the just-pressed flag on key up, so a press has to be held across a frame. */
export async function tap(page, key) {
  await page.keyboard.down(key);
  await sleep(70);
  await page.keyboard.up(key);
}

export async function startLevel(page) {
  await tap(page, 'Space');
  await page.waitForFunction(() => {
    const scene = window.__growop.scene.getScene('GameScene');
    return scene?.scene.isActive() && scene.player && scene.state === 'playing';
  }, { timeout: 30000 });
  await sleep(200);
}

export async function waitForPlaying(page) {
  await page.waitForFunction(() => window.__growop.scene.getScene('GameScene')?.state === 'playing', { timeout: 20000 });
}

// ---------------------------------------------------------------- driving a level

/** Scores points the way the game does, so the run total and the level's own earnings both move. */
export async function earn(page, points) {
  await page.evaluate((n) => window.__growop.scene.getScene('GameScene').addScore(n), points);
  await sleep(120);
}

/**
 * Finishes the level for real: this level's earnings are topped up to `score`, the drop count and clock
 * are set, then the player is dropped onto the goal jar so the normal overlap -> completeLevel ->
 * LevelCompleteScene path runs untouched. GOAL_SCORE (500) is added by the game on top of `score`.
 *
 * Points are earned through addScore rather than written to the registry: writing the run total directly
 * would leave the level's own figure - the one that gets recorded - at zero. `score: null` leaves whatever
 * has already been earned alone.
 */
export async function completeLevel(page, { score, drops, timeMs }) {
  await page.evaluate((args) => {
    const game = window.__growop;
    const scene = game.scene.getScene('GameScene');
    const jar = scene.pickups.getChildren().find((pickup) => pickup.kind === 'goal-jar');
    if (args.score !== null) {
      const earned = game.registry.get('levelScore') ?? 0;
      if (args.score > earned) scene.addScore(args.score - earned);
    }
    scene.levelDrops = args.drops;
    scene.levelStartTime = scene.time.now - args.timeMs;
    scene.player.body.reset(jar.x, jar.y - 30);
  }, { score: score ?? null, drops, timeMs });
  await waitForScene(page, 'LevelCompleteScene');
  await sleep(400);
}

/** Touches the goal jar with whatever has actually been earned, changing nothing else. */
export async function touchJar(page) {
  await page.evaluate(() => {
    const scene = window.__growop.scene.getScene('GameScene');
    const jar = scene.pickups.getChildren().find((pickup) => pickup.kind === 'goal-jar');
    scene.player.body.reset(jar.x, jar.y - 30);
  });
  await waitForScene(page, 'LevelCompleteScene');
  await sleep(500);
}

/**
 * Waits for the grade screen to arm its keys. It binds them a beat after opening (INPUT_DELAY_MS, so a
 * key still held from the level cannot skip it), and a tap before that is simply lost. Waiting on the
 * binding rather than on a sleep is what keeps these suites honest when the machine is busy.
 */
export async function waitForGradeKeys(page) {
  await page.waitForFunction(() => {
    const scene = window.__growop.scene.getScene('LevelCompleteScene');
    return scene?.scene.isActive() && scene.input.keyboard.listenerCount('keydown-R') > 0;
  }, { timeout: 30000 });
}

/** Leaves the grade screen by key and waits for the next level to actually be running. */
async function leaveGradeScreen(page, key) {
  await waitForGradeKeys(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await tap(page, key);
    try {
      await page.waitForFunction(() => window.__growop.scene.getScene('GameScene')?.state === 'playing', { timeout: 4000 });
      await sleep(300);
      return;
    } catch {
      // the press landed between frames; the grade screen is still up, so try again
    }
  }
  throw new Error(`the grade screen did not respond to "${key}"`);
}

/** Replay: the same level again from scratch. */
export const replayLevel = (page) => leaveGradeScreen(page, 'r');

/** Next: on to the level this one points at, carrying the run total. */
export const nextLevel = (page) => leaveGradeScreen(page, 'n');

export function waitForScene(page, key) {
  return page.waitForFunction((k) => window.__growop.scene.getScene(k)?.scene.isActive(), { timeout: 30000 }, key);
}

/** Runs the player out of lives the way a player does: off the bottom of the map. */
export async function gameOver(page) {
  await page.evaluate(() => {
    const scene = window.__growop.scene.getScene('GameScene');
    window.__growop.registry.set('lives', 1);
    scene.player.body.reset(scene.player.x, scene.map.heightInPixels + 300);
  });
  await waitForTitle(page);
  await sleep(600);
}

// ---------------------------------------------------------------- reading the screen

/** Every Text object in a scene, containers included, with the bits a layout assertion needs. */
export function readTexts(sceneKey) {
  const scene = window.__growop.scene.getScene(sceneKey);
  if (!scene || !scene.scene.isActive()) return null;
  const out = [];
  const walk = (list) => {
    for (const object of list) {
      if (object.type === 'Container') walk(object.list);
      else if (object.type === 'Text') {
        out.push({
          text: object.text,
          x: Math.round(object.x),
          y: Math.round(object.y),
          color: object.style.color,
          alpha: Number(object.alpha.toFixed(2)),
        });
      }
    }
  };
  walk(scene.children.list);
  return out;
}

/**
 * Imports one of the game's modules INSIDE the page and hands back whatever the callback pulls out of it.
 *
 * It resolves the URL the page actually loaded rather than importing the bare path, because Vite hangs a
 * `?t=<timestamp>` on a module after it is edited: a bare import then resolves to a different URL, which
 * is a second, freshly-initialised copy of the module. Anything that module remembered - a memo, a
 * singleton, a table filled in at startup - is empty in that copy, so the test reads zero and believes it.
 */
export function liveImport(page, path, pick) {
  return page.evaluate(
    async (modulePath, source) => {
      const loaded = performance
        .getEntriesByType('resource')
        .map((resource) => resource.name)
        .find((name) => new URL(name).pathname.endsWith(modulePath));
      const module = await import(loaded ?? modulePath);
      // eslint-disable-next-line no-new-func
      return new Function('module', `return (${source})(module);`)(module);
    },
    path,
    pick.toString(),
  );
}

export const texts = (page, key) => page.evaluate(readTexts, key);
export const labels = async (page, key) => (await texts(page, key)).map((object) => object.text);
export const saved = (page) => page.evaluate(() => localStorage.getItem('growop.save'));

/** A click in game units, mapped through the canvas rect, with down and up a frame apart. */
export async function clickGame(page, gx, gy) {
  const rect = await page.evaluate(() => {
    const box = document.querySelector('canvas').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const x = rect.x + (gx * rect.width) / 960;
  const y = rect.y + (gy * rect.height) / 540;
  await page.mouse.move(x, y);
  await sleep(60);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(200);
}

/** The same, by finger. */
export async function tapGame(page, gx, gy) {
  const rect = await page.evaluate(() => {
    const box = document.querySelector('canvas').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const touch = await page.touchscreen.touchStart(rect.x + (gx * rect.width) / 960, rect.y + (gy * rect.height) / 540);
  await sleep(60);
  await touch.end();
  await sleep(250);
}

// ---------------------------------------------------------------- taking a whole level

/**
 * Taking everything the level has, through the real rules only. Order matters: root rots have to be
 * killed before the nutrient runs out or after it lapses, and the gnats can only be reached while it is
 * running, because they cannot be stomped.
 *
 * Enemies are tracked by an id stamped onto each one, never by position in the group: a split ADDS two
 * minis mid-pass, so any index or length-based bookkeeping goes wrong exactly where it matters most.
 */
async function tagEnemies(page) {
  await page.evaluate(() => {
    const scene = window.__growop.scene.getScene('GameScene');
    scene.__tagSeq = scene.__tagSeq ?? 0;
    for (const enemy of scene.enemies.getChildren()) {
      if (enemy.__tag === undefined) enemy.__tag = scene.__tagSeq++;
    }
  });
}

/** Drops the player onto one enemy from just above it, which is what the stomp rule looks for. */
async function stompTag(page, tag, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await waitForPlaying(page);
    await page.evaluate((wanted) => {
      const scene = window.__growop.scene.getScene('GameScene');
      window.__growop.registry.set('lives', 99); // a mistimed drop must not end the run
      const enemy = scene.enemies.getChildren().find((candidate) => candidate.__tag === wanted);
      if (!enemy || enemy.defeated) return;
      enemy.activate();
      scene.player.body.reset(enemy.x, enemy.body.top - 46); // feet a short fall above its head
    }, tag);
    await sleep(400);
    // Check THIS enemy, not the size of the group: a split makes the group longer, not shorter.
    const done = await page.evaluate((wanted) => {
      const scene = window.__growop.scene.getScene('GameScene');
      const enemy = scene.enemies.getChildren().find((candidate) => candidate.__tag === wanted);
      return !enemy || enemy.defeated;
    }, tag);
    if (done) return true;
  }
  return false;
}

/** Every stompable enemy on the field, including the minis a split leaves behind. */
export async function clearStompables(page) {
  for (let guard = 0; guard < 40; guard += 1) {
    await tagEnemies(page);
    const tag = await page.evaluate(() => {
      const scene = window.__growop.scene.getScene('GameScene');
      const target = scene.enemies.getChildren().find((enemy) => !enemy.defeated && enemy.stompable);
      return target ? target.__tag : null;
    });
    if (tag === null) return true;
    if (!(await stompTag(page, tag))) return false;
    await sleep(420); // let a split settle and its minis' spawn grace expire
  }
  return false;
}

/** Walks into a pickup and waits for the overlap. */
export async function take(page, kind) {
  await waitForPlaying(page);
  const found = await page.evaluate((wanted) => {
    const scene = window.__growop.scene.getScene('GameScene');
    const pickup = scene.pickups.getChildren().find((candidate) => candidate.kind === wanted && !candidate.collected);
    if (!pickup) return false;
    scene.player.body.reset(pickup.x, pickup.y);
    return true;
  }, kind);
  if (found) await sleep(140);
  return found;
}

export async function takeAll(page, kind) {
  let taken = 0;
  while (await take(page, kind)) taken += 1;
  return taken;
}

/** Touches every remaining enemy while the nutrient is running: the only way to reach a flying gnat. */
export async function clearRemainingWhileInvincible(page) {
  for (let guard = 0; guard < 20; guard += 1) {
    const done = await page.evaluate(() => {
      const scene = window.__growop.scene.getScene('GameScene');
      const enemy = scene.enemies.getChildren().find((candidate) => !candidate.defeated);
      if (!enemy) return true;
      enemy.activate();
      scene.player.body.reset(enemy.x, enemy.y);
      return false;
    });
    if (done) return true;
    await sleep(140);
  }
  return false;
}

/** How much of the level has actually been taken, by category. */
export const survey = (page) => page.evaluate(() => {
  const scene = window.__growop.scene.getScene('GameScene');
  return {
    levelScore: window.__growop.registry.get('levelScore'),
    maxScore: window.__growop.registry.get('levelMaxScore'),
    enemiesAlive: scene.enemies.getChildren().filter((enemy) => !enemy.defeated).length,
    pickupsLeft: scene.pickups.getChildren().filter((pickup) => !pickup.collected && pickup.kind !== 'goal-jar').length,
    harvest: window.__growop.scene.getScene('HUDScene').harvestText.text,
  };
});

// ---------------------------------------------------------------- level fixtures

/**
 * Registers world1-1's map a second time as world1-2 for one page load, so behaviour that only shows up
 * when a run spans levels can be tested while the game still ships one.
 *
 * The level list is data now, so this patches the index the game fetches and serves world1-1's map under
 * the second key as well - a level's file is derived from its key, so the same map cannot simply be
 * pointed at twice. Nothing on disk changes, so there is nothing to put back afterwards. Returns a
 * function giving the number of times the index was patched.
 */
export async function addSecondLevel(page) {
  let patched = 0;
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const path = new URL(request.url()).pathname;

    if (path.endsWith('/levels/index.json')) {
      const index = await (await fetch(request.url())).json();
      if (!Array.isArray(index) || index[0]?.key !== 'world1-1') {
        return request.respond({ status: 500, contentType: 'text/plain', body: 'the level index is not the shape this fixture expects' });
      }
      patched += 1;
      const both = [...index, { key: 'world1-2', name: 'World 1-2', label: '1-2', tileset: 'tiles-soil' }];
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(both) });
    }

    // The second level is the first level's map under another name, including the HEAD the startup
    // check makes before the game is created.
    if (path.endsWith('/levels/world1-2.json')) {
      const map = await (await fetch(request.url().replace('world1-2', 'world1-1'))).text();
      return request.respond({ status: 200, contentType: 'application/json', body: request.method() === 'HEAD' ? '' : map });
    }

    return request.continue();
  });
  return () => patched;
}

/** Serves world1-1 with an empty object layer, so the level has nothing in it worth points. */
export async function emptyObjectLayer(page) {
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (!new URL(request.url()).pathname.endsWith('/levels/world1-1.json')) return request.continue();
    const json = await (await fetch(request.url())).json();
    for (const layer of json.layers) if (layer.type === 'objectgroup') layer.objects = [];
    request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
}

/** Makes every localStorage access throw, the way a browser with site data blocked does. */
export async function blockStorage(page) {
  await page.evaluateOnNewDocument(() => {
    const blocked = () => {
      throw new DOMException('Access denied', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: blocked });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: blocked });
  });
}
