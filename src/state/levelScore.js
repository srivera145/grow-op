import { ATTACK, ENEMIES, GRADES, PICKUPS } from '../config/constants.js';

/**
 * What a level is worth, and the grade a score earns on it.
 *
 * Grades are a percentage of the level's own maximum, so "Top Shelf" means the same thing on every
 * level and a new level needs no thresholds of its own. The maximum is read from the level's Tiled
 * object layer, never hardcoded, using the same constants the scene awards at run time - so a tuning
 * change cannot leave this table behind.
 *
 * When a level's maximum cannot be worked out (no object layer, or nothing in it worth points), grading
 * falls back to the absolute thresholds in GRADES and says so once, rather than dividing by zero.
 */

/** Every point one object in the "objects" layer can be turned into. Anything absent is worth nothing. */
function objectValues() {
  // An enemy pays once however it dies: stomped, slashed, or walked through while invincible.
  const kill = Math.max(ENEMIES.STOMP_SCORE, ATTACK.SCORE);
  return {
    'water-drop': PICKUPS.WATER_DROP_SCORE,
    'light-orb': PICKUPS.LIGHT_ORB_SCORE,
    nutrient: PICKUPS.NUTRIENT_SCORE,
    'goal-jar': PICKUPS.GOAL_SCORE,
    'spider-mite': kill,
    'fungus-gnat': kill,
    // A stomped root rot pays for itself and leaves a mini per split direction, each worth another kill.
    // That is the reachable total, and it is more than knocking the blob out whole, which pays just once.
    'root-rot': kill * (1 + ENEMIES.ROOT_ROT.SPLIT_DIRECTIONS.length),
  };
}

/** The "objects" layer of a raw Tiled map, as loaded from JSON. */
export function objectsFromMapJson(json) {
  const layer = json?.layers?.find((entry) => entry.type === 'objectgroup' && entry.name === 'objects');
  return layer?.objects;
}

/** Object names that are deliberately worth nothing, so an unknown one can be told from a free one. */
const UNSCORED = new Set(['player-start']);

/**
 * Totals a level's objects and names any it does not recognise. An unrecognised name is how a level's
 * maximum silently goes wrong: a new enemy gets placed in a level and nobody adds it to the table above,
 * so every score is measured against a maximum that is too low. Callers are expected to complain about it.
 */
export function describeObjects(objects) {
  const values = objectValues();
  const byName = {};
  const unknown = [];
  let total = 0;

  for (const object of Array.isArray(objects) ? objects : []) {
    const name = object?.name;
    const value = values[name];
    if (value === undefined) {
      if (!UNSCORED.has(name) && !unknown.includes(name)) unknown.push(name);
      continue;
    }
    byName[name] = (byName[name] ?? 0) + value;
    total += value;
  }
  return { total, byName, unknown };
}

/** Every point obtainable in a level, from the objects placed in it. */
export function maxScoreForObjects(objects) {
  return describeObjects(objects).total;
}

const maxByLevel = new Map();
const warned = new Set();

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * Works a level's maximum out and remembers it, so screens outside the level (the title, the grade
 * screen) can grade against it without loading the map again. Safe to call more than once per level.
 */
export function learnLevelMax(levelKey, objects) {
  const { total, unknown } = describeObjects(objects);
  if (unknown.length > 0) {
    // Worth saying out loud even though the level still plays: every grade in it is now measured
    // against a maximum that is too low. `npm run check-levels` fails on the same thing.
    warnOnce(`[levelScore] ${levelKey}: nothing in the score table for ${unknown.join(', ')}, so its maximum is too low.`);
  }
  if (total <= 0) {
    warnOnce(`[levelScore] ${levelKey}: nothing scoreable in the object layer, so grades fall back to absolute scores.`);
  }
  maxByLevel.set(levelKey, total);
  return total;
}

/** A level's maximum, or 0 when it has not been worked out. */
export function maxScoreForLevel(levelKey) {
  return maxByLevel.get(levelKey) ?? 0;
}

/** How much of a level's maximum a score is, as a whole percentage. 0 when the maximum is unknown. */
export function percentOf(score, maxScore) {
  // Floored, not rounded, so the number shown and the grade awarded can never disagree at a boundary.
  return maxScore > 0 ? Math.floor((score / maxScore) * 100) : 0;
}

/**
 * The grade a score earns on a level. Graded on percentage of that level's maximum; with no maximum
 * to work from, on the absolute thresholds instead. GRADES is ordered best first.
 */
export function gradeFor(score, maxScore) {
  const lowest = GRADES[GRADES.length - 1];
  if (maxScore > 0) {
    const percent = percentOf(score, maxScore);
    return GRADES.find((grade) => percent >= grade.minPercent) ?? lowest;
  }
  return GRADES.find((grade) => score >= grade.minScore) ?? lowest;
}
