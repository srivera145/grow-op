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

// Two 3x3 tilesets, identical but for one thing: the first draws each tile with a semi-transparent
// outer ring. That ring is above repack's ALPHA_CUT so the blob finder keeps it, and below
// clean_alpha's threshold so the resize zeroes it - which is exactly how a real generation ends up
// see-through at its cell boundaries, and why tiles-soil has needed a backing since the day it was drawn.
const SEAMY_TILES = 'iVBORw0KGgoAAAANSUhEUgAAAKgAAACoCAYAAAB0S6W0AAACwElEQVR42u3dMU4bURQF0AvKOihSsABqVxQRa0g/q5rea0AUVKmzABcu2Ai0o2giIZjxf//7nJIoFte6fthI75EAAAAAfbj53z/c/bx/X/v64fFputQ39+f1eV77+tv5dPPdx5avj3y3XqNU9uML/2ce/DmRrxATFAUFBeW63oMuPu01e89yeHz690tTkhzPpy0eW74O8pmgDPcpPkny9+W42zf18Ot38ydGvhr5TFDGnKB7vFr2fFXL12c+E5T4NRMoKAoKCgoKioKCgqKgoKCgoCgoKCgKCgoKCoqCgoISKx8ZY40hnSyXyWeCcq0TtMLqbDpZJpPPBCUO2CZZPWeSHQ+gpsGBV/kK5TNB8SMeFBSf4rM4oZdxz1XLVyifCQoAAAAAAAAAAAAAQKwd53Nrq9MF11bnBmu58hXKZ+WDjLY0Nw/+nMgXa8egoCgotHkPuvi01+w9y8qhqylJjufTFo8tXwf5TFDGPGC75+noCsdV5auRzwRl7D+isOWrpeJBf/na5jNBiV8zgYKioKCgoKAoKCgoCgoKCgqKgoKCoqCgoKCgKCgoKLHykTHWGNLJcpl8JijXOkErrM6mk2Uy+UxQ4oBtktVzJtnxAGoaHHiVr1A+ExQ/4kFB8Sk+ixN6GfdctXyF8pmgAAAAAAAAAAAAAADE2nE+t7Y6XXBtdW6wlitfoXxWPshoS3Pz4M+JfLF2DAqKgkKb96CLT3vN3rOsHLqakuR4Pm3x2PJ1kM8EZcwDtnuejq5wXFW+GvlMUMb+IwpbvloqHvSXr20+E5T4NRMoKAoKCgoKioKCgqKgoKCgoCgoKCgKCgoKCoqCgoISKx8ZY40hnSyXyWeCcq0TtMLqbDpZJpPPBCUO2CZZPWeSHQ+gpsGBV/kK5TNB8SMeFBSf4rM4oZdxz1XLVyifCQoAAAAAAAAA2/oADLcXWMiJFX8AAAAASUVORK5CYII=';
const SOLID_TILES = 'iVBORw0KGgoAAAANSUhEUgAAAKgAAACoCAYAAAB0S6W0AAAB9klEQVR42u3dwW2DQBBA0dnI5aQIlApSAmVQAmVQQiqIKML9kAo4OBgxs7x3tWIx0WclDoMjAAAAgBra3gfTOGxZL3pe1nb0O8xXY74P9yiZCRSBgkARKAgUBEoVj//+4c/v87SL+v76vPwfY74c8zlB6fMEPeNuOfOuNl/N+ZygeEgCgSJQECgIFIGCQBEoCBQEikBBoAgUBAoCRaAgUMLKR3SyxhBFlsvM5wTlridohtXZKLJMZj4nKB6SQKAgUAQKAkWgAAAAAAAAAAAAAADQp7b3wTQOW9aLnpe1Hf0O89WYz8oHYScJBIpAQaAgUAQKcd0LbM98dXSGl6uaL8d8TlD6/hGFd94tGV/ob75r53OC4iEJBIpAQaAgUAQKAkWgIFAQKAIFgSJQECgIFIGCQAkrH9HJGkMUWS4znxOUu56gGVZno8gymfmcoHhIAoGCQBEoCBSBAgAAAAAAAAAAAABAn9reB9M4bFkvel7WdvQ7zFdjPisfhJ0kECgCBYGCQBEoxHUvsD3z1dEZXq5qvhzzOUHp+0cU3nm3ZHyhv/munc8JiockECgCBYGCQBEoCBSBgkBBoAgUBIpAQaAgUAQKAiWsfEQnawxRZLnMfE5Q7nqCZlidjSLLZOZzguIhCQQKAkWgIFAECgAAAAAAAAC85g8ziXYADcUJJQAAAABJRU5ErkJggg==';

const RAW_DIR = join(process.cwd(), '.art-raw');
const fixtures = {
  'suite-good-walk.png': GOOD,
  'suite-bad-walk.png': BAD,
  'suite-seamy-tiles.png': SEAMY_TILES,
  'suite-solid-tiles.png': SOLID_TILES,
};

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

// ---------------------------------------------------------------- tilesets, and see-through joins

const tileset = (raw, key) => ({ raw, key, kind: 'tileset', description: 'a fixture, not a real asset', tile: 32 });

const seamy = await post('/api/repack-art', tileset('suite-seamy-tiles.png', 'suite-seamy-tiles'));
is(results, 'a tileset whose cells are see-through at the joins still packs', seamy.status, 200);
// The whole point: this is reported, never refused. Refusing it would refuse tiles-soil.
is(results, 'and is NOT blocked from acceptance', seamy.body.audit?.flags, []);
const seamAt = (axis) => (seamy.body.audit?.seams ?? []).filter((s) => s.axis === axis).map((s) => s.at);
is(results, 'every see-through column is named', seamAt('column'), [31, 32, 63, 64]);
is(results, 'every see-through row is named', seamAt('row'), [31, 32, 63, 64]);
check(results, 'a backing is derived from the sheet', Boolean(seamy.body.audit?.backing), JSON.stringify(seamy.body.audit?.backing));
is(results, 'its colour is the tile outline, not a copy of soil 0x220e0c', seamy.body.audit?.backing?.color, 0x1e2226);
check(results, 'its inset and seamInset are measured, not soil 14 and 4',
  seamy.body.audit?.backing?.inset === 1 && seamy.body.audit?.backing?.seamInset === 1,
  JSON.stringify(seamy.body.audit?.backing));

const solid = await post('/api/repack-art', tileset('suite-solid-tiles.png', 'suite-solid-tiles'));
is(results, 'a tileset drawn to its cell edges reports no seams', solid.body.audit?.seams, []);
is(results, 'and gets no backing it does not need', solid.body.audit?.backing, null);

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

const seamVerdict = await offer(seamy.body);
check(results, 'a tileset with seams may still be accepted', seamVerdict.ok && seamVerdict.canAccept, JSON.stringify(seamVerdict));
is(results, 'and the panel counts the seams it found', seamVerdict.seams, 8);
const tilesetRows = await page.evaluate(() => [...document.querySelectorAll('table.audit tr')].map((row) => row.textContent));
check(results, 'the audit table names the see-through boundaries',
  tilesetRows.some((row) => row.includes('cell joins') && row.includes('columns 31, 32, 63, 64; rows 31, 32, 63, 64')),
  tilesetRows.join(' | '));
check(results, 'and the finding says what accepting will do about it',
  await page.evaluate(() => [...document.querySelectorAll('.problems li.seam')].some((li) => li.textContent.includes('inset 1, seamInset 1'))),
  await page.evaluate(() => [...document.querySelectorAll('.problems li')].map((li) => li.className).join(',')));

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
