import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromePath } from './harness.js';

/**
 * Runs every smoke suite against the real game in a real browser. `npm run smoke`.
 *
 *   npm run smoke                 headless, all suites
 *   npm run smoke -- --headed     a visible browser, one suite at a time, for watching a failure
 *   npm run smoke -- save         only suites whose name contains "save"
 *   npm run smoke -- --jobs 1     run them one at a time
 *
 * A dev server is started if one is not already answering, and stopped again only if we started it:
 * a server that was already up is left exactly as it was found.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const DEFAULT_URL = 'http://localhost:5173/';
const SUITE_TIMEOUT_MS = 240000;
const RESULT_MARKER = '__SMOKE_RESULT__';

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const jobsArg = argv.indexOf('--jobs');
const jobsValue = jobsArg >= 0 ? argv[jobsArg + 1] : undefined;
const filters = argv.filter((arg, index) => !arg.startsWith('--') && !(jobsArg >= 0 && index === jobsArg + 1));
// Suites are independent, so they run in parallel; headed mode goes one at a time so there is one
// window to watch rather than several fighting for the screen. Two is deliberate: each suite drives its
// own Chrome, and past two they slow each other down more than the parallelism wins back (four made the
// whole run five times slower on the machine this was written on, and pushed two suites past their cap).
const DEFAULT_JOBS = 2;
const jobs = headed ? 1 : Math.max(1, Number(jobsValue ?? DEFAULT_JOBS) || DEFAULT_JOBS);

const suites = readdirSync(here)
  .filter((name) => name.endsWith('.js') && !['harness.js', 'run.js'].includes(name))
  .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)))
  .sort();

if (suites.length === 0) {
  console.error(filters.length ? `No suite matches ${filters.join(', ')}` : 'No suites found in tests/');
  process.exit(1);
}

// Fail on a missing browser before spending time on a dev server, and with advice rather than a stack.
try {
  chromePath();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- dev server

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

async function answering(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Starts Vite directly with node rather than through `npm run dev`: that leaves one process to stop
 * instead of an npm wrapper holding a child that outlives it on Windows.
 */
function startServer() {
  const child = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += stripAnsi(String(chunk));
      const match = output.match(/Local:\s+(http:\/\/\S+)/);
      if (match) resolve(match[1].trim());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`the dev server exited with code ${code}:\n${output.trim()}`)));
    setTimeout(() => reject(new Error(`the dev server did not report a URL within 30s:\n${output.trim()}`)), 30000);
  });

  return { child, url };
}

/** Stops a child and anything it started. Killing the node process alone would orphan its Chrome. */
function stopTree(child) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// ---------------------------------------------------------------- running a suite

function runSuite(name, url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(here, name)], {
      cwd: root,
      env: { ...process.env, GROWOP_URL: url, GROWOP_HEADED: headed ? '1' : '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (headed) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      stderr += `\nthe suite was still running after ${SUITE_TIMEOUT_MS / 1000}s and was stopped`;
      stopTree(child); // the tree, so a wedged suite does not leave a headless Chrome behind
    }, SUITE_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((text) => text.startsWith(RESULT_MARKER));
      let summary = null;
      try {
        summary = line ? JSON.parse(line.slice(RESULT_MARKER.length)) : null;
      } catch {
        summary = null;
      }
      resolve({ name, code, summary, stdout, stderr, seconds: (Date.now() - started) / 1000 });
    });
  });
}

/** Keeps `jobs` suites in flight at once. */
async function runAll(url) {
  const queue = [...suites];
  const done = [];
  const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length > 0) {
      const name = queue.shift();
      const result = await runSuite(name, url);
      const failed = result.code !== 0 || !result.summary;
      const counts = result.summary ? `${result.summary.total - result.summary.failures.length}/${result.summary.total}` : 'crashed';
      console.log(`${failed ? 'FAIL' : 'ok  '}  ${name.padEnd(24)} ${counts.padStart(7)}  ${result.seconds.toFixed(1)}s`);
      done.push(result);
    }
  });
  await Promise.all(workers);
  return done;
}

// ---------------------------------------------------------------- go

const existing = await answering(DEFAULT_URL);
let server = null;
let url = DEFAULT_URL;

if (existing) {
  console.log(`Using the dev server already running at ${DEFAULT_URL}`);
} else {
  process.stdout.write('Starting a dev server... ');
  server = startServer();
  try {
    url = await server.url;
  } catch (error) {
    console.error(`\nCould not start a dev server: ${error.message}`);
    stopTree(server.child);
    process.exit(1);
  }
  console.log(url);
}

console.log(`Running ${suites.length} suite(s)${headed ? ' headed' : ''}, ${jobs} at a time\n`);
const startedAt = Date.now();
let results = [];
try {
  results = await runAll(url);
} finally {
  if (server) {
    stopTree(server.child);
    console.log('\nStopped the dev server it started.');
  } else {
    console.log('\nLeft the dev server running, since it was already up.');
  }
}

const elapsed = (Date.now() - startedAt) / 1000;
const failed = results.filter((result) => result.code !== 0 || !result.summary);
const checks = results.reduce((total, result) => total + (result.summary?.total ?? 0), 0);

if (failed.length > 0) {
  console.error(`\n${'='.repeat(70)}`);
  for (const result of failed.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`\nFAILED  ${result.name}`);
    for (const failure of result.summary?.failures ?? []) {
      console.error(`  ${failure.name}`);
      if (failure.expected !== undefined) {
        console.error(`    expected: ${failure.expected}`);
        console.error(`    actual:   ${failure.actual}`);
      } else if (failure.actual) {
        console.error(`    actual:   ${failure.actual}`);
      }
    }
    if (!result.summary) {
      console.error('  the suite did not finish. Its output:');
      for (const line of `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-25)) {
        console.error(`    ${line}`);
      }
    }
    console.error(`  rerun on its own with:  node tests/${result.name}`);
  }
  console.error(`\n${failed.length} of ${results.length} suite(s) failed  (${checks} checks, ${elapsed.toFixed(1)}s)`);
  process.exit(1);
}

console.log(`\nAll ${results.length} suites passed: ${checks} checks in ${elapsed.toFixed(1)}s`);
