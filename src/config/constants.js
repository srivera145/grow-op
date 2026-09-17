// Every tuning value lives here.
// Units: pixels, pixels/second, pixels/second^2, milliseconds.

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const GRAVITY_Y = 900;
export const TILE_SIZE = 32;

// Texture keys. These are the names the final sprites will use, so real art can be
// loaded under the same keys later without touching gameplay code.
export const TEXTURES = {
  PLAYER: 'player',
  PLAYER_BIG: 'player-big',
  TILE_SOIL: 'tile-soil',
  WATER_DROP: 'water-drop',
  LIGHT_ORB: 'light-orb',
  NUTRIENT: 'nutrient',
  GOAL_JAR: 'goal-jar',
};

// Levels are Tiled JSON maps served from public/levels. `tileset` is the tileset name
// inside the map file; it is drawn with the texture that has the same key.
export const LEVELS = {
  'world1-1': { key: 'world1-1', name: 'World 1-1', file: 'levels/world1-1.json', tileset: 'tile-soil' },
};
export const FIRST_LEVEL = 'world1-1';

export const PLAYER = {
  // Horizontal movement
  RUN_SPEED: 220, // max horizontal speed
  ACCELERATION: 1800, // ground acceleration while a direction is held
  DRAG: 1800, // ground deceleration once the direction is released
  AIR_ACCELERATION: 1200, // acceleration while airborne
  AIR_DRAG: 300, // deceleration while airborne with no direction held

  // Jumping
  JUMP_VELOCITY: -460, // initial upward velocity (negative is up). Peak ~= v^2 / (2 * gravity) ~= 118 px
  JUMP_CUT_MULTIPLIER: 0.45, // upward velocity is scaled by this when jump is released early
  MAX_FALL_SPEED: 700, // terminal velocity. Keep >= |JUMP_VELOCITY|: Arcade clamps both directions

  // Forgiveness windows
  COYOTE_TIME_MS: 100, // a jump is still allowed this long after walking off a ledge
  JUMP_BUFFER_MS: 120, // a jump pressed this long before landing fires on landing

  // Status effects
  NUTRIENT_DURATION_MS: 8000, // invincibility granted by a nutrient
  HIT_MERCY_MS: 1500, // protection after a hit shrinks the player
  FLASH_INTERVAL_MS: 80, // how fast the invincibility tint and the mercy blink alternate
  INVINCIBLE_TINTS: [0xc77dff, 0xffffff, 0xffe66d, 0xffffff],
};

export const PICKUPS = {
  WATER_DROP_SCORE: 10,
  DROPS_PER_LIFE: 100, // every 100 drops is traded for an extra life
  LIGHT_ORB_SCORE: 100,
  NUTRIENT_SCORE: 100,
  GOAL_SCORE: 500,
};

export const CAMERA = {
  LERP: 0.12, // how quickly the camera catches up once the player leaves the deadzone
  DEADZONE_WIDTH: 200, // the player can move this far around screen centre without scrolling
  DEADZONE_HEIGHT: 140,
};

export const RULES = {
  START_LIVES: 3,
  FALL_DEATH_MARGIN: 48, // how far below the map the player must fall before losing a life
  RESPAWN_DELAY_MS: 800,
  GAME_OVER_DELAY_MS: 2500,
  STAGE_CLEAR_DELAY_MS: 3000,
};
