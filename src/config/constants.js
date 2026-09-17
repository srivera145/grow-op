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
  TILE_SOIL: 'tile-soil',
};

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
};
