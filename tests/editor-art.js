import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE_URL, check, is, launch, report, watchConsole } from './harness.js';

/**
 * The Art panel's audit, and what the dev server will and will not write because of it.
 *
 * Nothing here generates anything. Two fixture strips are written straight into .art-raw - one drawn
 * the way the prompt asks for, one drawn every way it asks you not to - and then repacked through the
 * same route the panel uses. So tools/repack.py really runs, the audit is really measured off a PNG,
 * and no API call is made and no money is spent.
 *
 * The check worth having is the second half: a flagged asset must not be able to become an asset. The
 * panel does not offer Accept on one, but the panel is a page, so the accept request is also made
 * directly here with the flags stripped out of it - which is exactly what a reloaded page, or a
 * console, or a future caller who forgot, would send.
 */

const results = [];

// 256x64, four blobs on transparency, feet on the bottom row: what the prompt asks for.
const GOOD = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAYAAAD1Xam+AAAB5ElEQVR42u3d0VFDIRAFUKACy7AcS7EUS7Ecy7AD/c4YJ5l5sCxwzreauRt2eTHJoxQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKCDqgQQ6KX8PPyZ77i+NAA4ugHSZJ5UCwNAAxzdANG53z5eH/7a5/tXWB2qBtAAJzdARPZnMj9ViwE1qBpAA5zcAKOf8yvZ/10PHetQNUDuRTDyyc/c+EsOgkHZR9agagANcHIDrJJ9VA2qBtAAJzdA7/wjs/+pQYf8bZVFcPP3rvxPYeEGSFuDoOZPW4PA5r95nA756+kTcLUGSLkLBjdAqjUwIXvPGrTTJ+Cw3WmDx8ncAFnXwGra1Lf4Zr/FqAFYdPfvtQbaqrtSil0w2WtQDUDsALAASor8kOJdAHD5v9QmaAAcvgDkdwVgAYABABgAgAEAGACAAQAYAFBuv4R09+Ytpez/paBN8jcLQH5cAQAGAF1uW7b542a5Cpp+9bNB/mYBXM+f5fU4TLsCiB4C03e/yUMwzWt/+ZfO35bffRLtflGLIM3wk3/KEMh3U9CFC9B7CI2uQcq74p6eP3A49f771W2x5ZffwSDOBZBffkeDORlIfmcDOhzU2YDyy+94cKcDyy//3vlrymLs/MEW+eX3wS4gg19H64wpU0AIzQAAAABJRU5ErkJggg==';

// 255x64, three blobs, opaque white background, and a width that will not divide by four. Every one
// of those is a separate way the same picture is unusable, and the audit has to name all of them.
const BAD = 'iVBORw0KGgoAAAANSUhEUgAAAP8AAABACAIAAABa9jY9AAABpklEQVR42u3c0U3DQBAG4fhEA3RBOZRCKZRCOXRBCeYBKYqi2FIUr9nf+eY1YDLO5M5C9k7zPJ+Ap2Q4BVA/oH5A/YD6AfUD6gfUD6gfUD+gfkD9gPoB9QPqB9QPqB9QP6B+QP2A+gH1A+oH1A+oH1A/oH5A/YD6gUVe9v+T0+u09NL8c/yB0vT76E+7TTBf0X6GDug31N+j/ivz98+3pZ/8+vg+XgT02+rX1n9pvqK9fiJyI6DfXL+w/rP8XeY3z0JiAfT764+28pe/e9dV4zE+e/o76Jes/X9v9xHzm8tAyhJIP0V/9Jc/Hy1iCaQfpD/+8R9bDY9P/6n0S677t/3q1x2zCPop+qP5rhd0AUA/Tt99Pji5yw1Qf9eNr/nuTz9R39oPaz+gfkD9gPoB9QPqP60/jXb1eM7mtL3bkX6ivrUf1n5A/Z23v+YPedCP0x91b7T/MUs/J/r99UfFAlC9wLSFftbxR8QOGPRgK/0g/aqJJps81Z871YN+hP6o3qQeWQZyB9rQj9A3y80sN7PcDLKkb46nIcb0zXA2wJ6++f3AcfkF1cN6YkwN+gYAAAAASUVORK5CYII=';

const RAW_DIR = join(process.cwd(), '.art-raw');
const fixtures = { 'suite-good-walk.png': GOOD, 'suite-bad-walk.png': BAD };

await mkdir(RAW_DIR, { recursive: true });
for (const [name, data] of Object.entries(fixtures)) {
  await writeFile(join(RAW_DIR, name), Buffer.from(data, 'base64'));
}

const post = async (path, body) => {
  const response = await fetch(new URL(path, BASE_URL).href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const strip = (raw, key, frames) => ({
  raw, key, kind: 'enemy', description: 'a fixture, not a real asset',
  frames, frameWidth: 40, frameHeight: 32, align: 'bottom',
});

const exists = async (path) => access(join(process.cwd(), path)).then(() => true, () => false);
const mentions = (flags, text) => flags.some((flag) => flag.includes(text));

// ---------------------------------------------------------------- a strip drawn the right way

const good = await post('/api/repack-art', strip('suite-good-walk.png', 'suite-good-walk', 4));
// Carrying the error into the check matters here: the likeliest reason this suite fails on a machine
// it has never run on is that repack.py has no Python with numpy and Pillow, and that is a sentence
// the route already writes. Asserting only the status code would hide it behind "expected 200, got 500".
check(results, 'a clean strip repacks', good.status === 200, good.body.error ?? good.status);
is(results, 'nothing is flagged on it', good.body.audit?.flags, []);
is(results, 'its four frames are found', good.body.audit?.impliedFrames, 4);
check(results, 'its width divides evenly', good.body.audit?.dividesEvenly === true, good.body.audit?.frameWidth);
check(results, 'it is mostly transparent', good.body.audit?.transparentPercent > 20, `${good.body.audit?.transparentPercent}%`);
is(results, 'the sheet is cut into the cells that were asked for', good.body.entry?.frameWidth, 40);
check(results, 'a preview of the packed sheet comes back', String(good.body.png ?? '').startsWith('data:image/png;base64,'));

// ---------------------------------------------------------------- and one drawn every wrong way

const bad = await post('/api/repack-art', strip('suite-bad-walk.png', 'suite-bad-walk', 4));
is(results, 'a bad strip still repacks, so there is something to look at', bad.status, 200);
const flags = bad.body.audit?.flags ?? [];
check(results, 'no alpha channel is flagged', mentions(flags, 'no alpha channel'), flags.join(' | '));
check(results, 'an opaque background is flagged', mentions(flags, 'transparent, under the'), flags.join(' | '));
check(results, 'a width that does not divide is flagged', mentions(flags, 'does not divide into 4 frames'), flags.join(' | '));
check(results, 'the wrong number of frames is flagged', mentions(flags, 'not the 4 frames asked for'), flags.join(' | '));

// ---------------------------------------------------------------- what may become an asset

const forged = await post('/api/accept-art', { ...strip('suite-bad-walk.png', 'suite-bad-walk', 4), staged: bad.body.staged, flags: [] });
is(results, 'a flagged asset is refused even when the request says it has no flags', forged.status, 409);
check(results, 'the refusal says what was wrong with it', String(forged.body.error).includes('no alpha channel'), forged.body.error);
check(results, 'and nothing was written', !(await exists('public/assets/sheets/suite-bad-walk.png')));

const taken = await post('/api/repack-art', strip('suite-good-walk.png', 'spider-mite-walk', 4));
is(results, 'a key that is already an asset is refused', taken.status, 409);
check(results, 'the refusal names the file in the way', String(taken.body.error).includes('assets/sheets/spider-mite-walk.png'), taken.body.error);

// ---------------------------------------------------------------- packing the same raw again

// The point of .art-raw: the frame count was wrong, and fixing it costs nothing but a repack.
const again = await post('/api/repack-art', strip('suite-good-walk.png', 'suite-good-walk', 2));
is(results, 'the same raw repacks at a different frame count', again.body.entry?.frames, 2);
check(results, 'and the audit says it is not really two frames', mentions(again.body.audit?.flags ?? [], 'not the 2 frames asked for'), (again.body.audit?.flags ?? []).join(' | '));

// ---------------------------------------------------------------- the panel, in the editor

const browser = await launch();
const page = await browser.newPage();
const noise = watchConsole(page);
await page.goto(new URL('editor.html', BASE_URL).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__editor && document.getElementById('art-run'));

const offer = (packed) => page.evaluate((argument) => window.__editor.offerArt(argument), packed);

const cleanVerdict = await offer(good.body);
check(results, 'a clean asset may be accepted', cleanVerdict.ok && cleanVerdict.canAccept, JSON.stringify(cleanVerdict));

const flaggedVerdict = await offer(bad.body);
is(results, 'a flagged asset may not', flaggedVerdict.ok, false);
check(results, 'and the panel does not offer the button', !flaggedVerdict.canAccept);

const shown = await page.evaluate(() => [...document.querySelectorAll('table.audit tr')].map((row) => row.textContent));
check(results, 'the audit table shows the alpha channel it measured', shown.some((row) => row.includes('alpha channelNO')), shown.join(' | '));
check(results, 'and the frames it found against the frames expected', shown.some((row) => row.includes('1 of 4 expected')), shown.join(' | '));

// Switching kind swaps the parameters, so a tileset is never asked for a frame count.
await page.evaluate(() => window.__editor.artKind('tileset'));
const tilesetRequest = await page.evaluate(() => window.__editor.artRequest());
is(results, 'a tileset is described by its tile size', Object.keys(tilesetRequest).sort().join(','), 'description,key,kind,tile');
await page.evaluate(() => window.__editor.artKind('parallax'));
const parallaxRequest = await page.evaluate(() => window.__editor.artRequest());
is(results, 'a parallax layer by its scroll factor', Object.keys(parallaxRequest).sort().join(','), 'description,factor,key,kind');

is(results, 'the editor logged nothing', noise, []);

await browser.close();
for (const name of Object.keys(fixtures)) await rm(join(RAW_DIR, name), { force: true });
report(results);
