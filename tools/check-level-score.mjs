/**
 * Checks what every level is worth. Run with `npm run check-levels`.
 *
 * Grades are a share of a level's maximum obtainable score, so that maximum has to be right and has to
 * mean the same thing however the level is played. This catches the half of that which can be checked
 * without running the game:
 *
 *  - every object placed in a level is either scored or deliberately worth nothing, so a new enemy
 *    added to a level but not to levelScore's table fails here instead of quietly lowering every grade;
 *  - the total does not depend on the order the objects appear in;
 *  - the breakdown is printed, so the figure can be checked against a hand count.
 *
 * The other half - that the total does not depend on the order a player collects things in, which is a
 * property of the kill and pickup rules rather than of the level file - needs the game running, and is
 * covered by the browser harness. Both halves exist because they have both been wrong.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLevels } from '../src/config/levels.js';
import { describeObjects, maxScoreForObjects, objectsFromMapJson } from '../src/state/levelScore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHUFFLES = 50;

// The index is read straight off disk and put through the same buildLevels() the game uses. Importing
// LEVELS would give an empty table here, because the browser fills it by fetching that same file.
const INDEX = join(root, 'public/levels/index.json');
let LEVELS;
try {
  LEVELS = buildLevels(JSON.parse(readFileSync(INDEX, 'utf8')));
} catch (error) {
  console.error(`Could not read public/levels/index.json: ${error.message}`);
  process.exit(1);
}

/** Fisher-Yates, on a copy. */
function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const problems = [];

for (const level of Object.values(LEVELS)) {
  const path = join(root, 'public', level.file);
  let objects;
  try {
    objects = objectsFromMapJson(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    problems.push(`${level.key}: could not read ${level.file} (${error.message})`);
    continue;
  }

  const { total, byName, unknown } = describeObjects(objects);
  const counts = {};
  for (const object of objects ?? []) counts[object.name] = (counts[object.name] ?? 0) + 1;

  console.log(`\n${level.key}  (${level.name})  maximum ${total}`);
  for (const name of Object.keys(counts).sort()) {
    const worth = byName[name];
    const line = worth === undefined ? 'not scored' : `${String(worth).padStart(5)}`;
    console.log(`  ${name.padEnd(14)} x${String(counts[name]).padStart(2)}   ${line}`);
  }

  if (unknown.length > 0) {
    problems.push(`${level.key}: no score defined for ${unknown.join(', ')} - add it to objectValues() in src/state/levelScore.js`);
  }
  if (total <= 0) {
    problems.push(`${level.key}: nothing scoreable, so every grade in it falls back to absolute scores`);
  }
  for (let i = 0; i < SHUFFLES; i += 1) {
    const again = maxScoreForObjects(shuffled(objects ?? []));
    if (again !== total) {
      problems.push(`${level.key}: maximum depends on the order the objects are listed in (${total} vs ${again})`);
      break;
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nAll ${Object.keys(LEVELS).length} level(s) check out.`);
