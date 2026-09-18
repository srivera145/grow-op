import { TILE, centreOf, groundYOf } from './format.js';

/**
 * Level sanity checks, run after every change.
 *
 * These describe what GameScene needs to be able to play a level, judged the same way it judges things:
 * an object's position is the middle of its rectangle, and where it meets the ground is the bottom of
 * that rectangle, or the bottom of the cell a point sits in.
 *
 * Nothing here blocks a save. A level part-way through being built is expected to be broken.
 */

const problem = (severity, message) => ({ severity, message });

export function validate(grid, objects) {
  const found = [];

  const starts = objects.list.filter((object) => object.name === 'player-start');
  if (starts.length === 0) found.push(problem('error', 'No player-start: the level has nowhere to begin.'));
  if (starts.length > 1) found.push(problem('error', `${starts.length} player-starts: there can only be one.`));

  if (objects.count('goal-jar') === 0) {
    found.push(problem('error', 'No goal-jar: the level cannot be finished.'));
  }

  for (const object of objects.list) {
    const { x, y } = centreOf(object);
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    const where = `${object.name} at ${Math.round(x)},${Math.round(y)}`;

    if (grid.get(col, row)) {
      found.push(problem('error', `${where} is inside a solid tile.`));
    }
    if (y > grid.height * TILE) {
      found.push(problem('error', `${where} is below the bottom of the map.`));
    } else if (x < 0 || y < 0 || x > grid.width * TILE) {
      found.push(problem('warn', `${where} is outside the map.`));
    }
  }

  // Standing on ground: the cell directly under the line the player's feet start on has to be solid.
  for (const start of starts) {
    const groundRow = groundYOf(start) / TILE;
    const col = Math.floor(centreOf(start).x / TILE);
    if (!grid.get(col, groundRow)) {
      found.push(problem('error', 'player-start is not standing on solid ground: it will fall on the first frame.'));
    }
  }

  return found;
}

/** A one-line summary for the header, so the state of the level is visible without reading the list. */
export function summarise(found) {
  const errors = found.filter((entry) => entry.severity === 'error').length;
  const warnings = found.length - errors;
  if (errors === 0 && warnings === 0) return { text: 'Level looks playable', severity: 'ok' };
  const parts = [];
  if (errors) parts.push(`${errors} problem${errors === 1 ? '' : 's'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return { text: parts.join(', '), severity: errors ? 'error' : 'warn' };
}
