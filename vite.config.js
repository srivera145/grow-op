import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { GAME_HEIGHT, GAME_WIDTH } from './src/config/constants.js';
import { buildPrompt } from './tools/generate/prompt.mjs';
import { ALIGNMENTS, ART_KINDS, ART_KIND_NAMES, buildArtPrompt } from './tools/generate/art-prompt.mjs';
import { clampSize } from './tools/generate/parse.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const LEVEL_DIR = resolve(root, 'public/levels');
const INDEX_FILE = join(LEVEL_DIR, 'index.json');
const NAME_PATTERN = /^[a-z0-9-]+$/;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
// A 200x24 layout is about 5k characters, so the layout itself is small. The ceiling is high because a
// model that thinks before it draws spends that budget on the thinking, and a run that spends three
// minutes reasoning and then gets cut off mid-layout has cost the money for nothing. The request is
// streamed, which is what makes a ceiling this high safe to ask for.
const MAX_TOKENS = 64000;

/**
 * Lets the level editor write to public/levels while the dev server is running.
 *
 * `apply: 'serve'` keeps this out of a production build, and a built game is static files with no server
 * behind them in any case, so there is nothing here for a deployed site to expose. The editor still has
 * its Download button for when this is not available.
 */
function levelSaver() {
  return {
    name: 'growop-level-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/level', async (request, response, next) => {
        const reply = replier(response);

        // DELETE /api/level/<key> - removes a level and its entry. Mounted on the same path as the save,
        // so the key arrives as the remainder of the URL.
        if (request.method === 'DELETE') {
          const key = decodeURIComponent((request.url ?? '').split('?')[0].replace(/^\//, ''));

          try {
            return reply(...(await deleteLevel(key, server)));
          } catch (error) {
            return reply(500, { error: error.message });
          }
        }

        if (request.method !== 'POST') return next();

        try {
          const body = await readBody(request);
          const { name, json, entry } = JSON.parse(body);

          // The name becomes a file path, so it is checked against a list of safe characters rather than
          // scrubbed: anything with a slash, a dot or a backslash in it is refused outright.
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            return reply(400, { error: 'a level name may only use a-z, 0-9 and dashes' });
          }

          // Accept the text the editor produced, so what lands on disk is byte for byte what it showed;
          // an object is allowed too, and simply written as pretty JSON.
          const text = typeof json === 'string' ? json : `${JSON.stringify(json, null, 2)}\n`;
          try {
            JSON.parse(text);
          } catch {
            return reply(400, { error: 'that is not valid JSON' });
          }

          const file = join(LEVEL_DIR, `${name}.json`);
          await mkdir(LEVEL_DIR, { recursive: true });
          await writeFile(file, text, 'utf8');

          // Registering on save is what stops a new level meaning a source edit. An entry is only ever
          // appended: a key already in the index keeps the position and the fields it has.
          let registered = false;
          if (entry) {
            const index = await readIndex();
            if (!index.some((existing) => existing.key === name)) {
              const added = { key: name };
              for (const field of ['name', 'label', 'tileset', 'next']) {
                if (typeof entry[field] === 'string' && entry[field]) added[field] = entry[field];
              }
              index.push(added);
              await writeIndex(index);
              registered = true;
            }
          }

          server.config.logger.info(`  level saved  public/levels/${name}.json  (${text.length} bytes)${registered ? ' + registered' : ''}`);
          reply(200, { ok: true, path: `public/levels/${name}.json`, bytes: text.length, registered });
        } catch (error) {
          reply(error.statusCode ?? 500, { error: error.message });
        }
      });

      /**
       * Rewrites the whole level index: reordering, renaming, or changing where a level leads. Separate
       * from saving a level on purpose, because it rewrites entries the caller did not necessarily make.
       */
      server.middlewares.use('/api/level-index', async (request, response, next) => {
        if (request.method !== 'POST') return next();

        const reply = replier(response);

        try {
          const { index } = JSON.parse(await readBody(request));
          if (!Array.isArray(index) || index.length === 0) {
            return reply(400, { error: 'the level index must be a non-empty array' });
          }

          const seen = new Set();
          for (const entry of index) {
            if (!entry || typeof entry.key !== 'string' || !NAME_PATTERN.test(entry.key)) {
              return reply(400, { error: `"${entry?.key}" is not a usable level key: only a-z, 0-9 and dashes` });
            }
            if (seen.has(entry.key)) return reply(400, { error: `"${entry.key}" is listed twice` });
            seen.add(entry.key);

            // An index entry with no level file behind it is a black screen waiting to happen.
            try {
              await access(join(LEVEL_DIR, `${entry.key}.json`));
            } catch {
              return reply(400, { error: `there is no public/levels/${entry.key}.json to go with that entry` });
            }
          }

          await writeIndex(index);
          server.config.logger.info(`  level index written  ${index.length} level(s)`);
          reply(200, { ok: true, levels: index.length });
        } catch (error) {
          reply(error.statusCode ?? 500, { error: error.message });
        }
      });
    },
  };
}

/**
 * Asks a model for a level, while the dev server is running.
 *
 * The API key lives on this side of the wire and nowhere else. It is read from .env by Vite's own
 * loadEnv, which is not the same thing as exposing it: only VITE_ prefixed variables reach the browser,
 * and this one is never put into `define`, never sent in a response and never written to the log. The
 * editor posts a description here and gets an ASCII layout back; it never sees a key or a model call.
 *
 * `apply: 'serve'` keeps the whole route out of a build, the same way the level saver is kept out. A
 * built game has no generate route, and editor.html is not built at all, so it has no generate UI either.
 */
function levelGenerator(env) {
  let inFlight = false; // one at a time: these cost money and a queue of them is nobody's intention

  return {
    name: 'growop-level-generator',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/generate-level', async (request, response, next) => {
        if (request.method !== 'POST') return next();
        const reply = replier(response);

        if (inFlight) {
          return reply(429, { error: 'a level is already being generated. Wait for that one to come back.' });
        }

        // Named, never printed. The model is not guessed at: a wrong model is a bill for a reply that
        // does not fit, and a default here would be the wrong one the moment the good one changes.
        const apiKey = env.ANTHROPIC_API_KEY;
        const model = env.ANTHROPIC_MODEL;
        if (!apiKey) {
          return reply(500, { error: 'ANTHROPIC_API_KEY is not set. Put it in .env (see .env.example) and restart the dev server.' });
        }
        if (!model) {
          return reply(500, { error: 'ANTHROPIC_MODEL is not set. Put the model name in .env (see .env.example) and restart the dev server.' });
        }

        inFlight = true;
        const startedAt = Date.now();
        try {
          const { description, width, height, previous } = JSON.parse(await readBody(request));
          if (typeof description !== 'string' || description.trim().length < 3) {
            return reply(400, { error: 'describe the level you want in a sentence or two' });
          }

          const size = clampSize({ width, height });
          const prompt = buildPrompt({ description, ...size, previous });

          const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
            throw new Error('@anthropic-ai/sdk is not installed. Run: npm install');
          });

          // Neither thinking nor effort is set: which of those a model takes depends on the model, and
          // this one comes out of .env. Every current model does the right thing by default.
          const client = new Anthropic({ apiKey });
          const message = await client.messages
            .stream({ model, max_tokens: MAX_TOKENS, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] })
            .finalMessage();

          if (message.stop_reason === 'refusal') {
            return reply(502, { error: `the model declined to answer (${message.stop_details?.category ?? 'no reason given'})` });
          }
          if (message.stop_reason === 'max_tokens') {
            return reply(502, {
              error: `the reply was cut off at ${MAX_TOKENS} tokens (${message.usage.output_tokens} written), so the layout is incomplete`,
            });
          }

          const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
          const usage = { input: message.usage.input_tokens, output: message.usage.output_tokens };
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          server.config.logger.info(`  level generated  ${model}  ${size.width}x${size.height}  ${usage.input} in / ${usage.output} out tokens  ${seconds}s`);
          reply(200, { reply: text, model, usage, size, seconds: Number(seconds) });
        } catch (error) {
          // Whatever went wrong, only the message goes back. SDK errors carry the request, not the key.
          reply(error.status ?? error.statusCode ?? 502, { error: error.message });
        } finally {
          inFlight = false;
        }
      });
    },
  };
}

/**
 * Generates art, repacks it, audits it, and - for the kinds that are only data - registers it.
 *
 * The shape is the same as the level generator above, for the same reasons: the key is read from .env
 * on this side of the wire and never sent anywhere but the image API, and `apply: 'serve'` keeps the
 * whole thing out of a build. A built game has no art routes, no key and no editor.
 *
 * Three things are worth knowing about the flow.
 *
 * Nothing is repacked in JavaScript. tools/repack.py is the repacker, the same one that packed every
 * asset already in public/assets, and it is shelled out to rather than reimplemented - exactly as the
 * editor shells out to nothing and imports autotile-core.mjs instead of keeping a second autotiler.
 * Two implementations of how a frame is found would disagree eventually, and the day they disagree is
 * the day generated art stops matching the art it is standing next to.
 *
 * Raw generations are kept. Every image the API returns is written to .art-raw, named with its key and
 * the minute it arrived, before anything is done to it. Getting the frame count wrong is the ordinary
 * mistake here, and without the raw strip the only way to fix it is to pay for the picture again.
 *
 * Nothing reaches public/assets until it is accepted. Generating writes to .art-raw; accepting is a
 * separate request that copies the packed file into place. An asset the audit has flagged is refused
 * at that step by the server, not only greyed out in the panel.
 */
function artGenerator(env) {
  let inFlight = false; // one at a time: these cost money, and a queue of them is nobody's intention

  return {
    name: 'growop-art-generator',
    apply: 'serve',
    configureServer(server) {
      const log = (message) => server.config.logger.info(`  ${message}`);

      // POST /api/generate-art - one picture, from a description. The only route here that costs money.
      server.middlewares.use('/api/generate-art', async (request, response, next) => {
        if (request.method !== 'POST') return next();
        const reply = replier(response);

        if (inFlight) {
          return reply(429, { error: 'an asset is already being generated. Wait for that one to come back.' });
        }

        // Named, never printed, never returned. An unset model is an error that names the variable
        // rather than a guess, for the same reason ANTHROPIC_MODEL has no default: a guessed image
        // model is a bill for a picture in the wrong shape.
        const apiKey = env.OPENAI_API_KEY;
        const model = env.OPENAI_IMAGE_MODEL;
        if (!apiKey) {
          return reply(500, { error: 'OPENAI_API_KEY is not set. Put it in .env (see .env.example) and restart the dev server.' });
        }
        if (!model) {
          return reply(500, {
            error: env.OPENAI_IMAGE_MODAL
              ? 'OPENAI_IMAGE_MODEL is not set, but OPENAI_IMAGE_MODAL is. That is the same name misspelled - rename it in .env and restart the dev server.'
              : 'OPENAI_IMAGE_MODEL is not set. Put the image model name in .env (see .env.example) and restart the dev server.',
          });
        }

        inFlight = true;
        const startedAt = Date.now();
        try {
          const wanted = readArtRequest(JSON.parse(await readBody(request)));
          await refuseTakenKey(wanted);

          const { prompt, size } = buildArtPrompt(wanted);
          const png = await generateImage({ apiKey, model, prompt, size, kind: wanted.kind });

          const raw = `${wanted.key}-${stamp()}.png`;
          await mkdir(RAW_DIR, { recursive: true });
          await writeFile(join(RAW_DIR, raw), png);

          const packed = await repack(raw, wanted);
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          log(`art generated  ${model}  ${wanted.kind}/${wanted.key}  ${size}  ${(png.length / 1024).toFixed(0)}kB raw  ${seconds}s  -> .art-raw/${raw}`);
          reply(200, { ...packed, raw, model, size, seconds: Number(seconds) });
        } catch (error) {
          // Only the message goes back. A fetch error carries the request it made, never the header.
          reply(error.statusCode ?? 502, { error: error.message });
        } finally {
          inFlight = false;
        }
      });

      // POST /api/repack-art - the same raw strip, packed again with different parameters. This is the
      // route that makes a wrong frame count cost nothing, so it deliberately takes no API key at all.
      server.middlewares.use('/api/repack-art', async (request, response, next) => {
        if (request.method !== 'POST') return next();
        const reply = replier(response);

        try {
          const body = JSON.parse(await readBody(request));
          const wanted = readArtRequest(body);
          const raw = String(body.raw ?? '');
          if (!RAW_PATTERN.test(raw)) {
            return reply(400, { error: `"${raw}" is not a file in .art-raw` });
          }
          try {
            await access(join(RAW_DIR, raw));
          } catch {
            return reply(404, { error: `there is no .art-raw/${raw} to repack` });
          }

          await refuseTakenKey(wanted);
          const packed = await repack(raw, wanted);
          log(`art repacked  ${wanted.kind}/${wanted.key}  from .art-raw/${raw}  (no API call)`);
          reply(200, { ...packed, raw });
        } catch (error) {
          reply(error.statusCode ?? 500, { error: error.message });
        }
      });

      // GET /api/art-raw - what is in .art-raw, so a strip can be found and packed again.
      server.middlewares.use('/api/art-raw', async (request, response, next) => {
        if (request.method !== 'GET') return next();
        const reply = replier(response);

        try {
          const names = await readdir(RAW_DIR).catch(() => []);
          const files = await Promise.all(
            names.filter((name) => RAW_PATTERN.test(name)).map(async (name) => {
              const info = await stat(join(RAW_DIR, name));
              return { name, bytes: info.size, at: info.mtime.toISOString() };
            }),
          );
          files.sort((a, b) => b.at.localeCompare(a.at)); // newest first: the one just generated
          reply(200, { files });
        } catch (error) {
          reply(500, { error: error.message });
        }
      });

      // POST /api/accept-art - the packed file becomes an asset, and is registered if it can be.
      server.middlewares.use('/api/accept-art', async (request, response, next) => {
        if (request.method !== 'POST') return next();
        const reply = replier(response);

        try {
          reply(...(await acceptArt(JSON.parse(await readBody(request)), log)));
        } catch (error) {
          reply(error.statusCode ?? 500, { error: error.message });
        }
      });
    },
  };
}

// ---------------------------------------------------------------- the art routes' working parts

const RAW_DIR = resolve(root, '.art-raw');
const STAGE_DIR = join(RAW_DIR, 'repacked');
const ASSET_DIR = resolve(root, 'public/assets');
const CONSTANTS_FILE = resolve(root, 'src/config/constants.js');
const RAW_PATTERN = /^[a-z0-9-]+\.png$/;
const IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/generations';
// A picture takes a good deal longer than a chat reply, and a run that is cut off at 60s has cost the
// money for nothing. Long, but not unbounded: a request that is never going to answer must still end.
const IMAGE_TIMEOUT_MS = 300000;

/**
 * Where a packed file's audit is kept: written next to it, under .art-raw, by the server that ran it.
 *
 * Accepting has to know whether an asset was flagged, and the one place it must not read that from is
 * the request asking for the accept. The panel does not offer Accept on a flagged asset, but the panel
 * is a page - reloadable, editable, drivable from a console - and "flagged, not silently accepted" is
 * only true if the thing writing the file is the thing refusing.
 *
 * On disk rather than in memory, because accepting a tileset or a background edits constants.js, which
 * the config imports, which restarts this server. A verdict that a successful accept wipes out is a
 * verdict that is not there for the second one.
 */
const AUDIT_FILE = 'audit.json';

const fail = (status, message) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

/** Minute resolution: enough to tell two generations apart, short enough to read in a file listing. */
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

/**
 * The request, checked. Everything the panel can send is bounded here rather than trusted, because
 * these numbers become a command line and a file path.
 */
function readArtRequest(body) {
  const kind = String(body?.kind ?? '');
  const def = ART_KINDS[kind];
  if (!def) throw fail(400, `"${kind}" is not an asset kind. Try one of: ${ART_KIND_NAMES.join(', ')}`);

  const key = String(body?.key ?? '').trim();
  if (!NAME_PATTERN.test(key)) throw fail(400, 'an asset key may only use a-z, 0-9 and dashes');
  if (kind === 'parallax' && !key.startsWith('bg-')) {
    throw fail(400, `a parallax layer's key has to start with "bg-", so "${key}" would not be filed with the other backgrounds`);
  }

  const number = (value, fallback, low, high) => {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed < low || parsed > high) {
      throw fail(400, `${parsed} is outside the range ${low} to ${high}`);
    }
    return parsed;
  };

  const wanted = { kind, key, description: String(body?.description ?? ''), def };
  if (def.mode === 'strip') {
    wanted.frames = Math.round(number(body.frames, def.defaults.frames, 1, 16));
    wanted.frameWidth = Math.round(number(body.frameWidth, def.defaults.frameWidth, 8, 256));
    wanted.frameHeight = Math.round(number(body.frameHeight, def.defaults.frameHeight, 8, 256));
    wanted.align = String(body.align ?? def.defaults.align);
    if (!ALIGNMENTS.includes(wanted.align)) {
      throw fail(400, `align has to be one of ${ALIGNMENTS.join(', ')}, not "${wanted.align}"`);
    }
  } else if (def.mode === 'tileset') {
    wanted.tile = Math.round(number(body.tile, def.defaults.tile, 8, 128));
  } else {
    wanted.factor = number(body.factor, def.defaults.factor, 0, 1);
  }
  return wanted;
}

/** Where an accepted asset of this kind, under this key, would land. */
const assetPath = (wanted) => join(ASSET_DIR, wanted.def.dir.replace('assets/', ''), `${wanted.key}.png`);

/**
 * Refuses a key that is already something.
 *
 * Checked before the picture is paid for as well as before it is accepted, because finding out that a
 * name was taken after spending the money on it is the wrong order. Existing art is never overwritten:
 * a re-export is a thing somebody does on purpose with the manifest run, not something a panel does by
 * accident while somebody is trying out names.
 */
async function refuseTakenKey(wanted) {
  const path = assetPath(wanted);
  try {
    await access(path);
    throw fail(409, `"${wanted.key}" already exists: ${relative(root, path).replace(/\\/g, '/')}. Nothing is ever overwritten, so pick another key.`);
  } catch (error) {
    if (error.statusCode) throw error; // our own refusal, not a missing file
  }

  if (wanted.def.registers) {
    const source = await readFile(CONSTANTS_FILE, 'utf8');
    if (new RegExp(`['"]?${wanted.key}['"]?\\s*:`).test(source) || source.includes(`key: '${wanted.key}'`)) {
      throw fail(409, `"${wanted.key}" is already registered in src/config/constants.js. Pick another key.`);
    }
  }
}

/**
 * Runs tools/repack.py over one raw file, into a staging directory of its own.
 *
 * The staging directory is per repack rather than per key, so packing the same raw strip three ways
 * leaves three results to compare instead of three overwrites of one.
 */
async function repack(raw, wanted) {
  const stage = join(STAGE_DIR, `${wanted.key}-${stamp()}-${Math.random().toString(36).slice(2, 6)}`);
  await mkdir(stage, { recursive: true });

  const source = join(RAW_DIR, raw);
  const args = wanted.def.mode === 'strip'
    ? ['--strip', source, wanted.key, String(wanted.frames), String(wanted.frameWidth), String(wanted.frameHeight), wanted.align]
    : wanted.def.mode === 'tileset'
      ? ['--tileset', source, wanted.key, String(wanted.tile)]
      : ['--single', source, wanted.key, String(GAME_WIDTH), String(GAME_HEIGHT)];

  const result = await runRepack([...args, '--out', stage, '--json']);
  if (!result.ok) throw fail(422, `${wanted.key} could not be repacked: ${result.report.join('; ') || 'nothing was found in the image'}`);

  const staged = relative(STAGE_DIR, result.written).replace(/\\/g, '/');
  await writeFile(join(dirname(result.written), AUDIT_FILE), JSON.stringify(result.audit), 'utf8');
  return {
    kind: wanted.kind,
    key: wanted.key,
    staged,
    entry: result.entry,
    audit: result.audit,
    report: result.report,
    // The packed sheet itself, inline. It is a few kB, it is the thing the panel has to show, and
    // sending it this way means .art-raw never has to be served as static files.
    png: `data:image/png;base64,${(await readFile(result.written)).toString('base64')}`,
  };
}

/**
 * Shells out to the repacker and parses its --json line.
 *
 * `python3` first, then `python`, and the answer is remembered. Both exist on a normal Linux or macOS
 * box; on Windows `python3` is usually a stub that opens the Microsoft Store, so the interpreter is
 * not named but found - and found by whether it can import what repack.py needs, which also turns
 * "ModuleNotFoundError: numpy" three minutes later into a sentence up front.
 */
let pythonCommand = null;

async function findPython() {
  if (pythonCommand) return pythonCommand;
  const tried = [];
  for (const candidate of ['python3', 'python', 'py']) {
    const check = await run(candidate, ['-c', 'import numpy, PIL']);
    if (check.code === 0) {
      pythonCommand = candidate;
      return candidate;
    }
    tried.push(`${candidate}: ${(check.stderr || check.error || 'not found').trim().split('\n').pop()}`);
  }
  throw fail(500, `tools/repack.py needs Python with numpy and Pillow, and none of these could run it.\n  ${tried.join('\n  ')}\nInstall them with: pip install numpy pillow`);
}

async function runRepack(args) {
  const python = await findPython();
  const script = resolve(root, 'tools/repack.py');
  const { code, stdout, stderr } = await run(python, [script, ...args]);
  if (code !== 0) throw fail(500, `repack.py failed: ${(stderr || stdout).trim().split('\n').slice(-3).join(' ')}`);
  try {
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch {
    throw fail(500, `repack.py did not answer with JSON: ${stdout.trim().slice(-200)}`);
  }
}

function run(command, args) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: root, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => done({ code: -1, stdout, stderr, error: error.message }));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

/**
 * Asks the image API for one picture and hands back the PNG bytes.
 *
 * `background: 'transparent'` is asked for on everything except a parallax layer, which is the back
 * wall of the room and is meant to be opaque. The instruction is in the prompt as well; this is the
 * part of it the API can enforce, and asking twice costs nothing.
 */
async function generateImage({ apiKey, model, prompt, size, kind }) {
  const body = { model, prompt, size, n: 1, output_format: 'png' };
  if (kind !== 'parallax') body.background = 'transparent';

  let response;
  try {
    response = await fetch(IMAGE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError';
    throw fail(504, timedOut ? `the image API did not answer within ${IMAGE_TIMEOUT_MS / 1000}s` : `could not reach the image API: ${error.message}`);
  }

  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw fail(response.status, answer?.error?.message ?? `the image API answered ${response.status}`);
  }

  const encoded = answer?.data?.[0]?.b64_json;
  if (!encoded) throw fail(502, 'the image API answered without an image in it');
  return Buffer.from(encoded, 'base64');
}

/**
 * Accepting: the packed file becomes an asset, and for the two kinds that are only data, an entry.
 *
 * The audit is checked again here. The panel already refuses to offer Accept on a flagged asset, but
 * the panel is a page that can be reloaded, edited and driven from a console, and "never silently
 * accepted" has to be true of the thing that writes the file rather than of the thing that asks it to.
 *
 * @returns [statusCode, body] for the caller to send
 */
async function acceptArt(body, log) {
  const wanted = readArtRequest(body);
  const staged = resolve(STAGE_DIR, String(body?.staged ?? ''));
  if (!staged.startsWith(STAGE_DIR + sep)) {
    return [400, { error: 'that is not a file this server packed' }];
  }
  try {
    await access(staged);
  } catch {
    return [404, { error: 'that packed file is gone. Repack it from .art-raw and accept again.' }];
  }

  // The verdict this server wrote when it packed the file, never the caller's account of it.
  let audit;
  try {
    audit = JSON.parse(await readFile(join(dirname(staged), AUDIT_FILE), 'utf8'));
  } catch {
    return [409, { error: 'there is no audit beside that packed file, so there is nothing saying it is fit to accept. Repack it from .art-raw - that costs nothing - and accept the result.' }];
  }
  if (audit.flags.length > 0) {
    return [409, {
      error: `the audit flagged this asset, so it cannot be accepted:\n  ${audit.flags.join('\n  ')}\nRepack it from .art-raw with different parameters, or generate it again.`,
    }];
  }

  const path = assetPath(wanted);
  await refuseTakenKey(wanted); // again, because time passed between the preview and this click
  await mkdir(dirname(path), { recursive: true });
  await copyFile(staged, path);

  const written = relative(root, path).replace(/\\/g, '/');
  const registered = wanted.def.registers ? await register(wanted, audit) : null;
  log(`art accepted  ${written}${registered ? `  + registered in ${registered.where}` : ''}`);

  return [200, {
    ok: true,
    key: wanted.key,
    written,
    registered,
    // What is still needed in code, named file by file. Empty for a tileset or a background, which
    // are data all the way down; never empty for an enemy, which art alone does not make.
    needs: wanted.def.needs,
  }];
}

/**
 * Appends a tileset or a parallax layer to constants.js.
 *
 * Text, not a parse. Both are hand-written literals full of comments that explain why each number is
 * what it is, and rewriting the file through a parser would cost every one of those comments to save
 * a regular expression. So the line goes in above the brace that closes the block, and everything
 * around it is left exactly as somebody wrote it.
 */
async function register(wanted, audit) {
  const source = await readFile(CONSTANTS_FILE, 'utf8');
  const where = 'src/config/constants.js';

  if (wanted.kind === 'tileset') {
    // A tileset whose art stops short of its cells shows a hairline gap at every join. The audit has
    // already measured which boundaries are see-through and what would hide them, so the entry is
    // written with that backing rather than without one - the alternative is a level that looks
    // broken and a person who has to find out why. Nothing is copied from tiles-soil.
    const backing = audit?.seams?.length && audit.backing
      ? `, backing: { color: 0x${audit.backing.color.toString(16).padStart(6, '0')}, inset: ${audit.backing.inset}, seamInset: ${audit.backing.seamInset} }`
      : '';
    const line = `  '${wanted.key}': { file: '${wanted.def.dir}/${wanted.key}.png', firstGid: 1, tileCount: 9, columns: 3, layout: 'edges3x3'${backing} },`;
    await writeFile(CONSTANTS_FILE, insertBefore(source, 'export const TILESETS = {', '};', line), 'utf8');
    return {
      where,
      what: 'TILESETS',
      line: line.trim(),
      note: backing
        ? `${audit.seams.length} cell boundaries of this sheet are see-through, so it was registered with a backing measured off the sheet. Without one the ground would show a hairline gap at every join.`
        : undefined,
    };
  }

  const line = `  { key: '${wanted.key}', factor: ${wanted.factor} },`;
  await writeFile(CONSTANTS_FILE, insertBefore(source, 'export const PARALLAX = [', '];', line), 'utf8');
  return {
    where,
    what: 'PARALLAX',
    line: line.trim(),
    // PARALLAX is ordered back to front, and appending puts the new layer in front of every other
    // one. That is right for a near layer and wrong for a far one, and it is a one-line move either
    // way, so it is said rather than guessed at.
    note: 'PARALLAX is ordered back to front, so this went in as the nearest layer. Move the line up in constants.js if it belongs further back.',
  };
}

/** Puts `line` immediately before the line that closes a block, found from the line that opens it. */
function insertBefore(source, opener, closer, line) {
  const lines = source.split('\n');
  const start = lines.findIndex((text) => text.trim().startsWith(opener));
  if (start < 0) throw fail(500, `could not find "${opener}" in src/config/constants.js`);

  const end = lines.findIndex((text, index) => index > start && text.trim() === closer);
  if (end < 0) throw fail(500, `could not find the "${closer}" that closes "${opener}" in src/config/constants.js`);

  lines.splice(end, 0, line);
  return lines.join('\n');
}

/**
 * Removes a level: its index entry first, then its file.
 *
 * That order is the point. A dangling entry - one naming a file that is not there - is the failure this
 * exists to stop causing, so if the file delete fails the index is already consistent with a level that
 * simply is not registered any more, and the worst case is an orphan map nobody reads. The other way
 * round leaves the game refusing to start.
 *
 * An entry whose next is implicit needs no repair: it means "the one after me", which the shortened list
 * re-derives on its own. An entry that explicitly names this level is refused rather than rewritten,
 * because quietly repointing somebody's deliberate ordering is worse than making them look at it.
 *
 * @returns [statusCode, body] for the caller to send
 */
async function deleteLevel(key, server) {
  if (!NAME_PATTERN.test(key)) {
    return [400, { error: 'a level name may only use a-z, 0-9 and dashes' }];
  }

  const index = await readIndex();
  if (!index.some((entry) => entry.key === key)) {
    return [404, { error: `"${key}" is not in the level index` }];
  }

  if (index.length <= 1) {
    return [409, { error: `"${key}" is the only level there is. A game with no levels cannot start.` }];
  }

  const pointedAtBy = index.find((entry) => entry.key !== key && entry.next === key);
  if (pointedAtBy) {
    return [409, {
      error: `"${pointedAtBy.key}" explicitly leads to "${key}". Change that entry's next in Level order first.`,
    }];
  }

  await writeIndex(index.filter((entry) => entry.key !== key));

  let fileRemoved = true;
  try {
    await rm(join(LEVEL_DIR, `${key}.json`));
  } catch {
    fileRemoved = false; // the entry is already gone, so nothing dangles; this is just an orphan file
  }

  server.config.logger.info(`  level deleted  ${key}${fileRemoved ? '' : '  (entry only: its file was already gone)'}`);
  return [200, { ok: true, key, fileRemoved, levels: index.length - 1 }];
}

const replier = (response) => (status, body) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
};

async function readIndex() {
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** One entry per line: short, ordered, and readable in a diff. */
async function writeIndex(index) {
  const lines = index.map((entry) => `  ${JSON.stringify(entry)}`);
  await mkdir(LEVEL_DIR, { recursive: true });
  await writeFile(INDEX_FILE, ['[', lines.join(',\n'), ']', ''].join('\n'), 'utf8');
}

function readBody(request) {
  return new Promise((resolvePromise, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        const error = new Error('level is too large');
        error.statusCode = 413;
        request.destroy();
        reject(error);
      }
    });
    request.on('end', () => resolvePromise(body));
    request.on('error', reject);
  });
}

// A function, so Vite hands over the mode and .env can be read for it. loadEnv with an empty prefix
// reads every variable, not just the VITE_ ones - which is the point: these must not be VITE_ ones.
// Nothing here is passed to `define`, so none of it can reach the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');

  return {
    plugins: [levelSaver(), levelGenerator(env), artGenerator(env)],
    build: {
      // Only the game is built. editor.html is deliberately not an entry: it is a development tool, it
      // talks to dev-server routes that do not exist in production, and shipping it would put a level
      // editor on the live site. Vite serves it at /editor.html in dev without being asked.
      rollupOptions: { input: resolve(root, 'index.html') },
    },
  };
});
