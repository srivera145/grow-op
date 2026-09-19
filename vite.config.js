import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { buildPrompt } from './tools/generate/prompt.mjs';
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
export default defineConfig(({ mode }) => ({
  plugins: [levelSaver(), levelGenerator(loadEnv(mode, root, ''))],
  build: {
    // Only the game is built. editor.html is deliberately not an entry: it is a development tool, it
    // talks to a dev-server route that does not exist in production, and shipping it would put a level
    // editor on the live site. Vite serves it at /editor.html in dev without being asked.
    rollupOptions: { input: resolve(root, 'index.html') },
  },
}));
