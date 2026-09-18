import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const LEVEL_DIR = resolve(root, 'public/levels');
const NAME_PATTERN = /^[a-z0-9-]+$/;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

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
        if (request.method !== 'POST') return next();

        const reply = (status, body) => {
          response.statusCode = status;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(body));
        };

        try {
          const body = await readBody(request);
          const { name, json } = JSON.parse(body);

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
          server.config.logger.info(`  level saved  public/levels/${name}.json  (${text.length} bytes)`);
          reply(200, { ok: true, path: `public/levels/${name}.json`, bytes: text.length });
        } catch (error) {
          reply(error.statusCode ?? 500, { error: error.message });
        }
      });
    },
  };
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

export default defineConfig({
  plugins: [levelSaver()],
  build: {
    // Only the game is built. editor.html is deliberately not an entry: it is a development tool, it
    // talks to a dev-server route that does not exist in production, and shipping it would put a level
    // editor on the live site. Vite serves it at /editor.html in dev without being asked.
    rollupOptions: { input: resolve(root, 'index.html') },
  },
});
