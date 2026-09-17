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
  WATER_DROP: 'water-drop',
  LIGHT_ORB: 'light-orb',
  NUTRIENT: 'nutrient',
  GOAL_JAR: 'goal-jar',
  SPIDER_MITE: 'spider-mite',
  FUNGUS_GNAT: 'fungus-gnat',
  ROOT_ROT: 'root-rot',
  ROOT_ROT_MINI: 'root-rot-mini',
};

// Tilesets, keyed by the name used inside the Tiled maps. The texture key is the same string.
// firstGid and tileCount give the gid range the tileset owns; the ground collides on that whole range,
// never on one specific gid. 'edges3x3' is a 3x3 edge set laid out top-left, top, top-right / left, centre,
// right / bottom-left, bottom, bottom-right, which is what tools/autotile.mjs writes into the ground layer.
export const TILESETS = {
  // backing: tiles-soil.png is drawn slightly short of its 32px cells (the last two pixel rows and the
  // corners of every tile are transparent), so the background shows through between tiles. GameScene paints
  // this colour, the tile's own outline, behind the ground, keeping `inset` px clear of any side that faces
  // open air so the grass edge stays see-through. The joins between two soil tiles get a thin strip that only
  // keeps `seamInset` px clear, because the gap runs right out under the grass there.
  // Delete `backing` once the tiles are re-exported to fill their cells.
  'tiles-soil': { file: 'assets/tiles/tiles-soil.png', firstGid: 1, tileCount: 9, columns: 3, layout: 'edges3x3', backing: { color: 0x220e0c, inset: 14, seamInset: 4 } },
  // Loaded and ready, but no level uses these yet.
  'tiles-pot': { file: 'assets/tiles/tiles-pot.png', tileCount: 3, columns: 3 },
  'tiles-stone': { file: 'assets/tiles/tiles-stone.png', tileCount: 3, columns: 3 },
  'tiles-tent-floor': { file: 'assets/tiles/tiles-tent-floor.png', tileCount: 3, columns: 3 },
};

// Interface images. hud-icons is one row of icons; FRAME names which icon, counted from the left, shows what.
export const UI = {
  LOGO: {
    key: 'logo-growop',
    file: 'assets/ui/logo-growop.png',
    maxWidthFraction: 0.7,
    // Title animation: the logo pops in from a little smaller, then drifts up and back down forever.
    INTRO_MS: 450,
    INTRO_START_SCALE: 0.85, // fraction of its resting size that it grows from
    FLOAT_PIXELS: 8, // how far it rises above its resting spot; it never dips below, so it cannot reach the prompt
    FLOAT_MS: 1800, // one rise, and the same again to settle back
  },
  HUD_ICONS: {
    key: 'hud-icons',
    file: 'assets/sheets/hud-icons.png',
    // The icons are different sizes and do not sit on an even grid (Little Bud's head is wider than a fifth of
    // the sheet), so BootScene finds each icon's own bounds in the image instead of cutting equal cells.
    // In the HUD every icon is scaled, keeping its proportions, to fit a SLOT x SLOT box and centred in it.
    COUNT: 5,
    SLOT: 32,
    FRAME: { DROPS: 0, LIVES: 1, SCORE: 2, TIME: 3, WORLD: 4 },
  },
};

// On-screen touch controls, in game units on the 960x540 canvas. Only used when the device reports touch
// support (or the page is opened with ?touch=1).
//  - Buttons are BUTTON_SIZE square. The bottom row sits exactly over the 64px band of floor at the bottom of
//    the view, so it never covers the player; slash sits just above and inboard of jump.
//  - x, y is the centre of the drawn button. `hit` is the touch-sensitive area: larger than the drawing,
//    reaching the screen edges, and the left and right areas meet so a sliding thumb never crosses a dead strip.
//  - Buttons rest at ALPHA_REST so the level shows through, and go to ALPHA_HELD while pressed.
export const TOUCH = {
  ALPHA_REST: 0.35,
  ALPHA_HELD: 1,
  BUTTON_SIZE: 64,
  BUTTONS: {
    left: { x: 48, y: 508, icon: 'left', hit: { x: 0, y: 452, width: 88, height: 88 } },
    right: { x: 128, y: 508, icon: 'right', hit: { x: 88, y: 452, width: 96, height: 88 } },
    jump: { x: 904, y: 508, icon: 'jump', label: 'JUMP', hit: { x: 860, y: 468, width: 100, height: 72 } },
    attack: { x: 828, y: 436, icon: 'slash', label: 'SLASH', hit: { x: 788, y: 396, width: 80, height: 72 } },
  },
  HELP: { x: 480, y: 528, text: 'Move: arrow buttons    Jump: JUMP    Slash: SLASH' }, // bottom centre, between the two clusters
  START_PROMPT: 'Tap to start',
  ROTATE: { title: 'Rotate your device', subtitle: 'Grow Op plays in landscape', backdropAlpha: 0.94 },
};

// Levels are Tiled JSON maps served from public/levels. `tileset` names an entry in TILESETS and the
// tileset block inside the map. `label` is the short form shown beside the HUD's world icon. `next` is
// the level the grade screen's Next button opens; with one level it loops back to itself.
export const LEVELS = {
  'world1-1': { key: 'world1-1', name: 'World 1-1', label: '1-1', file: 'levels/world1-1.json', tileset: 'tiles-soil', next: 'world1-1' },
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

  // Physics bodies, measured off the art: from the feet up to the top of the head, not counting the
  // sprout. The art is drawn with its feet on the bottom edge of the frame, so each body is centred
  // horizontally and pinned to the bottom of whatever frame is showing.
  BODY: { small: { width: 26, height: 36 }, big: { width: 26, height: 46 } },

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
  // Hitboxes. The goal jar's is measured off its art and stands on the ground; the rest are centred.
  BODY: {
    'water-drop': { width: 16, height: 16 },
    'light-orb': { width: 24, height: 24 },
    nutrient: { width: 24, height: 24 },
    'goal-jar': { width: 44, height: 74 },
  },
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
  STOMP_TOLERANCE: 12, // how far below an enemy's head the player's feet may have been last frame and still stomp
  SPAWN_GRACE_MS: 350, // freshly split blobs cannot touch the player for this long
  DESPAWN_MARGIN: 96, // enemies that fall this far below the map are removed
  // RANGE: every enemy patrols this many px either side of the x it was placed at (a split blob: where it
  // split). Walkers still turn sooner at a wall or a ledge, whichever comes first.
  SPIDER_MITE: { SPEED: 60, RANGE: 120, BODY: { width: 34, height: 26 } },
  FUNGUS_GNAT: { SPEED: 70, AMPLITUDE: 40, PERIOD_MS: 1600, RANGE: 96, BODY: { width: 28, height: 24 } }, // sine flight, patrolling RANGE px either side of its spawn point
  ROOT_ROT: { SPEED: 28, SMALL_SPEED: 55, RANGE: 96, SMALL_RANGE: 64, SPLIT_HOP_VELOCITY: -220, SPLIT_OFFSET: 10, BODY: { width: 36, height: 28 }, SMALL_BODY: { width: 22, height: 18 } },
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
