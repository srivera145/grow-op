import { ENEMIES, GRAVITY_Y, PICKUPS, PLAYER, RULES, TILE_SIZE } from '../config/constants.js';
import { OBJECT_TYPES, centreOf, groundYOf } from './format.js';

/**
 * Can a player actually get to everything in this level?
 *
 * A breadth-first search over the places the player can stand, with a real jump arc simulated out of
 * each one. Pure: it is given a grid and a list of objects and returns what it found, so the editor and
 * `npm run check-levels -- --reach` run the same solver over the same data.
 *
 * Every modelling choice here is made the conservative way, because the two mistakes cost different
 * amounts. A false "unreachable" costs somebody an edit they did not need to make. A false "reachable"
 * ships a level with a jar nobody can touch. So:
 *
 *  - the small body is used throughout. It is the form the player is always in at the start and always
 *    falls back to, and it is the shorter one, so it reaches the least far upward. (A tile grid makes the
 *    two forms equivalent for squeezing through gaps: 36 and 46 both need two clear cells.)
 *  - a jump arc is flown at a fixed horizontal speed with a fixed air acceleration, chosen from a spread
 *    that the player can actually produce. Real air control is finer than that, so the arcs found here
 *    are a subset of the ones a player can fly, never a superset.
 *  - an enemy is treated as sitting still where it was placed. They patrol, which can only bring them
 *    closer; and the leaf slash reaches further than the body, which is ignored.
 *  - touching is body-on-body overlap, using the hitboxes the scene gives each thing, not tile overlap.
 *
 * What it does not model: bouncing off an enemy's head (a real route in places, so a level relying on
 * one reads as unreachable here), moving platforms (there are none), and dying on purpose to respawn.
 */

const BODY = PLAYER.BODY.small;
const STEP_SECONDS = 1 / 240; // ~0.9px of run, ~2.9px of fall per step: far too fine to tunnel a tile
const MAX_FLIGHT_SECONDS = 4; // a full jump is about a second, the longest fall on a tall map under two
const WALK_SAMPLE_PX = 4; // how finely a walk between two stances is checked for things it brushes past

/** The bodies the scene actually gives each enemy, which are not the Tiled rectangles. */
const ENEMY_BODY = {
  'spider-mite': ENEMIES.SPIDER_MITE.BODY,
  'fungus-gnat': ENEMIES.FUNGUS_GNAT.BODY,
  'root-rot': ENEMIES.ROOT_ROT.BODY,
};

/**
 * What the player's jump is worth, worked out from the live constants rather than written down.
 *
 * `stepBudget` and `gapBudget` are what a level should be built to, not what the physics permit: the
 * step budget drops the fractional part of the peak, and the gap budget gives up two tiles of the full
 * running reach - one for leaving the last solid tile, one for landing on the far one with something to
 * spare. Retune the jump and these move with it.
 */
export function jumpEnvelope() {
  const rise = PLAYER.JUMP_VELOCITY ** 2 / (2 * GRAVITY_Y);
  const airtime = (2 * Math.abs(PLAYER.JUMP_VELOCITY)) / GRAVITY_Y;
  const reach = PLAYER.RUN_SPEED * airtime;
  return {
    rise,
    riseTiles: rise / TILE_SIZE,
    airtime,
    reach,
    reachTiles: reach / TILE_SIZE,
    stepBudget: Math.max(1, Math.floor(rise / TILE_SIZE)),
    gapBudget: Math.max(1, Math.floor(reach / TILE_SIZE) - 2),
  };
}

/** The rectangle a thing is touched by, placed the way GameScene places it. */
export function hitBox(object) {
  const def = OBJECT_TYPES[object.name];
  const body = PICKUPS.BODY[object.name] ?? ENEMY_BODY[object.name];
  const centre = centreOf(object);

  // Anything with no body of its own (a point, or a name the game has no rule for) is judged on the
  // rectangle it was placed with.
  if (!body) {
    return { left: object.x, top: object.y, right: object.x + (object.width || 0), bottom: object.y + (object.height || 0) };
  }

  const bottom = def?.anchor === 'bottom' ? groundYOf(object) : centre.y + body.height / 2;
  return { left: centre.x - body.width / 2, top: bottom - body.height, right: centre.x + body.width / 2, bottom };
}

/**
 * The tiles, with the world's own walls around them.
 *
 * GameScene bounds the world on the left, the right and the top but leaves the bottom open, so those
 * three read as solid here and anything below the last row reads as empty: that is the hole a player
 * falls out of, and it has to stay a hole or the solver would think they could stand on thin air.
 */
class World {
  constructor(width, height, cells) {
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  solid(col, row) {
    if (col < 0 || col >= this.width || row < 0) return true;
    if (row >= this.height) return false;
    return this.cells[row * this.width + col] !== 0;
  }

  /** Somewhere the player can be standing: solid underfoot, and two clear cells to stand up in. */
  standable(col, row) {
    return this.solid(col, row) && !this.solid(col, row - 1) && !this.solid(col, row - 2);
  }

  /** Whether a body rectangle is inside anything solid. */
  blocked(left, top) {
    const firstCol = Math.floor(left / TILE_SIZE);
    const lastCol = Math.floor((left + BODY.width - 0.001) / TILE_SIZE);
    const firstRow = Math.floor(top / TILE_SIZE);
    const lastRow = Math.floor((top + BODY.height - 0.001) / TILE_SIZE);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        if (this.solid(col, row)) return true;
      }
    }
    return false;
  }
}

/** Where a stance puts the player's body: centred in its column, feet on the tile below. */
const stanceAt = (col, row) => ({ left: col * TILE_SIZE + (TILE_SIZE - BODY.width) / 2, top: row * TILE_SIZE - BODY.height });

/**
 * The take-offs tried from every stance.
 *
 * Each is a horizontal speed to leave at and an acceleration to hold in the air, and each one is a jump
 * a player can really fly. Leaving at a standstill and holding a direction is a standing jump, which
 * needs no run-up at all; leaving at full speed needs about 13px of floor to build up, which any stance
 * has. Holding the opposite direction is how a jump is cut short to land on something near.
 */
function takeOffs() {
  const speeds = [0, PLAYER.RUN_SPEED / 2, PLAYER.RUN_SPEED];
  const accelerations = [0, PLAYER.AIR_ACCELERATION, -PLAYER.AIR_ACCELERATION];
  const list = [];
  for (const speed of speeds) {
    for (const direction of speed === 0 ? [1] : [1, -1]) {
      for (const acceleration of accelerations) {
        list.push({ vx: speed * direction, ax: acceleration });
      }
    }
  }
  return list;
}

const TAKE_OFFS = takeOffs();
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

/**
 * Flies one arc and says where it ended up.
 *
 * Positions are integrated in small steps and resolved one axis at a time, which is how Arcade moves a
 * body, so an arc that grazes a corner here grazes it in the game. `touch` is called with every body
 * position along the way, because what the player brushes past mid-flight counts as collected.
 *
 * @returns { col, row } where it landed, or null if it fell out of the world or never came down
 */
function fly(world, start, { vx, vy, ax }, touch) {
  let { left, top } = start;
  let velocityX = vx;
  let velocityY = vy;
  const floor = world.height * TILE_SIZE + RULES.FALL_DEATH_MARGIN;

  if (world.blocked(left, top)) return null; // launched from inside something: not a real position

  for (let elapsed = 0; elapsed < MAX_FLIGHT_SECONDS; elapsed += STEP_SECONDS) {
    velocityY = Math.min(velocityY + GRAVITY_Y * STEP_SECONDS, PLAYER.MAX_FALL_SPEED);
    velocityX = clamp(velocityX + ax * STEP_SECONDS, PLAYER.RUN_SPEED);

    left += velocityX * STEP_SECONDS;
    if (world.blocked(left, top)) {
      left = velocityX > 0
        ? Math.floor((left + BODY.width - 0.001) / TILE_SIZE) * TILE_SIZE - BODY.width
        : (Math.floor(left / TILE_SIZE) + 1) * TILE_SIZE;
      velocityX = 0;
    }

    top += velocityY * STEP_SECONDS;
    if (world.blocked(left, top)) {
      if (velocityY > 0) {
        top = Math.floor((top + BODY.height - 0.001) / TILE_SIZE) * TILE_SIZE - BODY.height;
        touch(left, top);
        return landing(world, left, top);
      }
      top = (Math.floor(top / TILE_SIZE) + 1) * TILE_SIZE;
      velocityY = 0;
    }

    touch(left, top);
    if (top > floor) return null; // fell out of the level: that is a lost life, not a route
  }
  return null;
}

/**
 * The stance a landing body settles into.
 *
 * Landing half off a ledge is a real place to be, but it is not one of the search's nodes, so it snaps
 * to whichever column under the body can be stood in - the player only has to walk the few pixels to the
 * middle of it. A landing with no such column (a ledge under a low ceiling, say) is dropped rather than
 * guessed at.
 */
function landing(world, left, top) {
  const row = Math.floor((top + BODY.height) / TILE_SIZE);
  const middle = Math.floor((left + BODY.width / 2) / TILE_SIZE);
  const candidates = [middle, Math.floor(left / TILE_SIZE), Math.floor((left + BODY.width - 0.001) / TILE_SIZE)];
  for (const col of candidates) {
    if (world.standable(col, row)) return { col, row };
  }
  return null;
}

/**
 * Everything the player can get to, starting from player-start.
 *
 * @param level { width, height, cells, objects } - cells being one 0 or 1 per tile, row by row
 */
export function analyseReachability(level) {
  const world = new World(level.width, level.height, level.cells);
  const start = level.objects.find((object) => object.name === 'player-start');
  const targets = level.objects
    .filter((object) => object.name !== 'player-start')
    .map((object) => ({ object, box: hitBox(object), reached: false }));

  // Bucketed by column, so a body position only ever tests the handful of things beside it.
  const buckets = Array.from({ length: level.width }, () => []);
  for (const target of targets) {
    const firstCol = Math.max(0, Math.floor(target.box.left / TILE_SIZE));
    const lastCol = Math.min(level.width - 1, Math.floor((target.box.right - 0.001) / TILE_SIZE));
    for (let col = firstCol; col <= lastCol; col += 1) buckets[col].push(target);
  }

  const touch = (left, top) => {
    const right = left + BODY.width;
    const bottom = top + BODY.height;
    const firstCol = Math.max(0, Math.floor(left / TILE_SIZE));
    const lastCol = Math.min(level.width - 1, Math.floor((right - 0.001) / TILE_SIZE));
    for (let col = firstCol; col <= lastCol; col += 1) {
      for (const target of buckets[col]) {
        if (target.reached) continue;
        const box = target.box;
        if (left < box.right && right > box.left && top < box.bottom && bottom > box.top) target.reached = true;
      }
    }
  };

  const result = {
    start: null,
    stances: 0,
    objects: targets.map(({ object }) => ({ id: object.id, name: object.name, x: object.x, y: object.y, reachable: false })),
    stranded: [],
    goal: { present: targets.some(({ object }) => object.name === 'goal-jar'), reachable: false },
    ok: false,
  };

  if (!start) {
    result.reason = 'there is no player-start to search from';
    return result;
  }

  const startCol = Math.floor(centreOf(start).x / TILE_SIZE);
  const startRow = groundYOf(start) / TILE_SIZE;
  result.start = { col: startCol, row: startRow };

  if (!world.standable(startCol, startRow)) {
    result.reason = `player-start at tile ${startCol},${startRow} is not somewhere the player can stand`;
    return result;
  }

  // A breadth-first flood over stances. The queue is walked with an index rather than shifted off the
  // front, so a level with thousands of stances does not spend its time moving an array around.
  const seen = new Uint8Array(level.width * level.height);
  const queue = [[startCol, startRow]];
  seen[startRow * level.width + startCol] = 1;

  for (let head = 0; head < queue.length; head += 1) {
    const [col, row] = queue[head];
    result.stances += 1;
    const stance = stanceAt(col, row);
    touch(stance.left, stance.top);

    const reach = (landed) => {
      if (!landed) return;
      const index = landed.row * level.width + landed.col;
      if (seen[index]) return;
      seen[index] = 1;
      queue.push([landed.col, landed.row]);
    };

    for (const side of [-1, 1]) {
      const neighbour = col + side;

      if (world.standable(neighbour, row)) {
        // Walking. Sampled along the way, because something small can hang between two stances.
        const to = stanceAt(neighbour, row);
        for (let x = Math.min(stance.left, to.left); x <= Math.max(stance.left, to.left); x += WALK_SAMPLE_PX) touch(x, to.top);
        reach({ col: neighbour, row });
      } else if (!world.solid(neighbour, row)) {
        // A ledge. The fall starts where the body stops overlapping the tile it was standing on.
        const edge = side > 0 ? (col + 1) * TILE_SIZE : col * TILE_SIZE - BODY.width;
        for (const { vx, ax } of TAKE_OFFS) {
          if (Math.sign(vx) !== side) continue; // you cannot walk off a ledge you are not walking towards
          reach(fly(world, { left: edge, top: stance.top }, { vx, vy: 0, ax }, touch));
        }
      }
    }

    for (const { vx, ax } of TAKE_OFFS) {
      reach(fly(world, stance, { vx, vy: PLAYER.JUMP_VELOCITY, ax }, touch));
    }
  }

  for (let i = 0; i < targets.length; i += 1) result.objects[i].reachable = targets[i].reached;
  result.stranded = result.objects.filter((object) => !object.reachable);
  result.goal.reachable = result.objects.some((object) => object.name === 'goal-jar' && object.reachable);
  result.ok = result.goal.present && result.goal.reachable && result.stranded.length === 0;
  return result;
}

/**
 * The same finding in the shape the editor's checks panel speaks, so a stranded object reads like any
 * other problem with the level. A missing goal is left to validate.js, which already says it better.
 */
export function describeReachability(result) {
  if (result.reason) return [{ severity: 'error', message: `Cannot check reachability: ${result.reason}.` }];
  const found = [];

  if (result.goal.present && !result.goal.reachable) {
    found.push({ severity: 'error', message: 'The goal-jar cannot be reached from player-start: the level cannot be finished.' });
  }

  const stranded = result.stranded.filter((object) => object.name !== 'goal-jar');
  if (stranded.length > 0) {
    const where = stranded
      .slice(0, 6)
      .map((object) => `${object.name} at tile ${Math.floor(object.x / TILE_SIZE)},${Math.floor(object.y / TILE_SIZE)}`);
    if (stranded.length > where.length) where.push(`and ${stranded.length - where.length} more`);
    found.push({
      severity: 'error',
      message: `${stranded.length} object${stranded.length === 1 ? '' : 's'} cannot be reached: ${where.join(', ')}.`,
    });
  }
  return found;
}
