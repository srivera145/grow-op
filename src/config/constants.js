// Every tuning value lives here.
// Units: pixels, pixels/second, pixels/second^2, milliseconds.

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;
export const GRAVITY_Y = 900;
export const TILE_SIZE = 32;

// Placeholder texture keys. BootScene always generates these, and every sprite is created with one.
// Real art arrives as animations (see config/animations.js); when an animation's sheet is missing
// the sprite simply keeps showing its placeholder.
export const TEXTURES = {
  PLAYER: 'player',
  PLAYER_BIG: 'player-big',
  TILE_SOIL: 'tile-soil',
  WATER_DROP: 'water-drop',
  LIGHT_ORB: 'light-orb',
  NUTRIENT: 'nutrient',
  GOAL_JAR: 'goal-jar',
  SPIDER_MITE: 'spider-mite',
  FUNGUS_GNAT: 'fungus-gnat',
  ROOT_ROT: 'root-rot',
  ROOT_ROT_MINI: 'root-rot-mini',
};

// Levels are Tiled JSON maps served from public/levels. `tileset` is the tileset name
// inside the map file; it is drawn with the texture that has the same key. `next` is the
// level the grade screen's Next button opens; with one level it loops back to itself.
export const LEVELS = {
  'world1-1': { key: 'world1-1', name: 'World 1-1', file: 'levels/world1-1.json', tileset: 'tile-soil', next: 'world1-1' },
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

  // Physics bodies. The art is drawn with its feet on the bottom edge of the frame, so each body is
  // centred horizontally and pinned to the bottom of whatever frame is showing.
  BODY: { small: { width: 22, height: 30 }, big: { width: 22, height: 44 } },

  // Animation switching
  IDLE_SPEED: 12, // below this horizontal speed the player counts as standing still
  RUN_ANIM_THRESHOLD: 0.6, // walk animation below this fraction of RUN_SPEED, run animation above it
  LAND_ANIM_MS: 120, // the landing animation holds for this long after touchdown
  GROW_ANIM_MS: 400,
  HURT_ANIM_MS: 400,

  // Status effects
  NUTRIENT_DURATION_MS: 8000, // invincibility granted by a nutrient
  HIT_MERCY_MS: 1500, // flickering invulnerability after taking damage or respawning
  STOMP_BOUNCE_VELOCITY: -300, // bounce off a stomped enemy; holding jump gives a full JUMP_VELOCITY bounce
  DEATH_HOP_VELOCITY: -380, // the little hop the player does when an enemy costs them a life
  FLASH_INTERVAL_MS: 80, // how fast the invincibility tint and the mercy blink alternate
  INVINCIBLE_TINTS: [0xc77dff, 0xffffff, 0xffe66d, 0xffffff],
};

// Leaf slash attack (X or J). Frames are zero-based and FRAME_MS long, matching the attack animation.
export const ATTACK = {
  COOLDOWN_MS: 350,
  FRAME_MS: 60,
  FRAMES: 4,
  SLASH_ON_FRAME: 2, // the leaf-slash effect appears when this frame starts
  ACTIVE_FROM_FRAME: 2, // the hitbox exists only from this frame...
  ACTIVE_TO_FRAME: 3, // ...through this one
  WIDTH: 28, // hitbox size, placed directly in front of the player's body
  HEIGHT: 20,
  SCORE: 100,
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

export const ENEMIES = {
  ACTIVATION_SCREENS: 1, // enemies sleep until they are within this many screen widths of the camera view
  STOMP_SCORE: 100,
  STOMP_TOLERANCE: 8, // how far below an enemy's head the player's feet may have been last frame and still stomp
  SPAWN_GRACE_MS: 350, // freshly split blobs cannot touch the player for this long
  DESPAWN_MARGIN: 96, // enemies that fall this far below the map are removed
  SPIDER_MITE: { SPEED: 60, BODY: { width: 32, height: 24 } },
  FUNGUS_GNAT: { SPEED: 70, AMPLITUDE: 40, PERIOD_MS: 1600, RANGE: 96, BODY: { width: 24, height: 24 } }, // sine flight, patrolling RANGE px either side of its spawn point
  ROOT_ROT: { SPEED: 28, SMALL_SPEED: 55, SPLIT_HOP_VELOCITY: -220, SPLIT_OFFSET: 10, BODY: { width: 32, height: 32 }, SMALL_BODY: { width: 20, height: 20 } },
};

// Harvest grades, best first. A score earns the first grade whose minimum it reaches.
export const GRADES = [
  { minScore: 4000, name: 'Exotic', color: '#c77dff' },
  { minScore: 2500, name: 'Top Shelf', color: '#ffd60a' },
  { minScore: 1000, name: 'Mids', color: '#4cd137' },
  { minScore: 0, name: 'Shake', color: '#b08968' },
];

// Parallax layers, back to front. factor is how far the layer moves relative to the camera.
export const PARALLAX = [
  { key: 'bg-far-mylar', factor: 0.1 }, // grow tent back wall
  { key: 'bg-mid-lights', factor: 0.3 }, // light rigs
  { key: 'bg-near-leaves', factor: 0.6 }, // leaves, still behind the gameplay layer
];

export const RULES = {
  START_LIVES: 3,
  FALL_DEATH_MARGIN: 48, // how far below the map the player must fall before losing a life
  RESPAWN_DELAY_MS: 1200,
  GAME_OVER_DELAY_MS: 2500,
  JARRING_HOLD_MS: 500, // pause on the sealed jar before the grade screen opens
};
