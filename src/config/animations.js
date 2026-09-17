import { ATTACK, PLAYER } from './constants.js';

// Every animation in the game, in one place.
//
// The art ships as one PNG strip per animation in public/assets/sheets: a single row of equal-sized
// frames. The file name (without .png), the texture key and the animation key are all the same string,
// so 'spider-mite-walk' is spider-mite-walk.png, the texture it loads into, and the animation that plays it.
// Frame size is deliberately not listed: BootScene derives it from the image (width / frames), so
// re-exporting a strip at a different frame size needs no change here.
//
// A sheet that fails to load simply has no animation, and sprites keep showing their placeholder texture.

export const SHEET_PATH = 'assets/sheets';

const LOOP = -1;
const ONCE = 0;

// Pending sheets are not requested at all, which keeps the console free of failed loads while art is still
// being made; the form shows its stopgap or placeholder instead. The big-form strips (little-bud-big-*.png)
// were pending until they were exported; they are in public/assets/sheets now, so this is false.
const BIG_FORM_PENDING = false;

// Stopgap for the big form while its strips are pending: every big-form state shows one still image, the
// last frame of little-bud-grow.png, which is the big Little Bud standing. He looks right at rest and
// simply does not animate while moving. It only ever applies while BIG_FORM_PENDING is also true, so once the
// real strips are in and BIG_FORM_PENDING is set to false this does nothing, with no other edit needed.
// If the grow strip itself is missing, the big form falls through to its green placeholder as before.
const BIG_FORM_STOPGAP = true;
const BIG_FORM_STAND_IN = { key: 'little-bud-grow', frame: 3 };

// Player states shared by both forms. Keys become little-bud-<form>-<state>.
const PLAYER_STATES = {
  idle: { frames: 4, frameRate: 6, repeat: LOOP },
  walk: { frames: 6, frameRate: 10, repeat: LOOP },
  run: { frames: 6, frameRate: 14, repeat: LOOP },
  jump: { frames: 4, frameRate: 16, repeat: ONCE }, // plays once on takeoff and holds its last frame
  fall: { frames: 4, frameRate: 12, repeat: LOOP }, // loops, so a long drop keeps moving instead of freezing on its last frame
  land: { frames: 4, frameRate: 4000 / PLAYER.LAND_ANIM_MS, repeat: ONCE }, // all four frames inside the landing window
  attack: { frames: ATTACK.FRAMES, frameRate: 1000 / ATTACK.FRAME_MS, repeat: ONCE }, // frame timing drives the hitbox
  hurt: { frames: 4, frameRate: 4000 / PLAYER.HURT_ANIM_MS, repeat: ONCE },
  die: { frames: 4, frameRate: 8, repeat: ONCE },
  victory: { frames: 4, frameRate: 8, repeat: LOOP },
};

/**
 * The animation table entries for one player form. `shared` is merged into every state (flags such as
 * pending). `perState` overrides individual states where a form's art differs from PLAYER_STATES,
 * for example { walk: { frames: 5 } }.
 */
function playerForm(form, shared = {}, perState = {}) {
  return Object.fromEntries(
    Object.entries(PLAYER_STATES).map(([state, def]) => [playerAnim(form, state), { ...def, ...shared, ...perState[state] }]),
  );
}

/** Animation key for a player form ('small' | 'big') and state ('idle', 'run', ...). */
export function playerAnim(form, state) {
  return `little-bud-${form}-${state}`;
}

export const ANIMATIONS = {
  // Player
  ...playerForm('small'),
  // The big walk cycle is drawn in 5 frames (its strip is 320x88). At the shared 10 fps it cycles a little
  // faster than the small form's 6, which suits the heavier form, so the rate is deliberately left alone.
  ...playerForm(
    'big',
    { pending: BIG_FORM_PENDING, standIn: BIG_FORM_PENDING && BIG_FORM_STOPGAP ? BIG_FORM_STAND_IN : undefined },
    { walk: { frames: 5 } },
  ),
  'little-bud-grow': { frames: 4, frameRate: 4000 / PLAYER.GROW_ANIM_MS, repeat: ONCE }, // small to big, in big-form frames

  // Enemies
  'spider-mite-walk': { frames: 4, frameRate: 8, repeat: LOOP },
  'spider-mite-death': { frames: 3, frameRate: 10, repeat: ONCE },
  'fungus-gnat-fly': { frames: 4, frameRate: 14, repeat: LOOP },
  'fungus-gnat-death': { frames: 3, frameRate: 10, repeat: ONCE },
  'root-rot-crawl': { frames: 4, frameRate: 6, repeat: LOOP },
  'root-rot-split': { frames: 3, frameRate: 10, repeat: ONCE },
  'root-rot-mini-crawl': { frames: 4, frameRate: 8, repeat: LOOP },
  'root-rot-mini-death': { frames: 3, frameRate: 10, repeat: ONCE },

  // Pickups and the goal
  'water-drop-idle': { frames: 4, frameRate: 6, repeat: LOOP },
  'light-orb-idle': { frames: 4, frameRate: 6, repeat: LOOP },
  'nutrient-idle': { frames: 4, frameRate: 6, repeat: LOOP },
  'goal-jar-idle': { frames: 4, frameRate: 4, repeat: LOOP },
  'goal-jar-close': { frames: 4, frameRate: 10, repeat: ONCE },

  // Effects
  'leaf-slash': { frames: 3, frameRate: 25, repeat: ONCE }, // spans the attack's two active frames
  'dust-puff': { frames: 4, frameRate: 14, repeat: ONCE },
};

/** Registers an animation for every sheet that actually loaded, and any configured stand-ins. Called once from BootScene. */
export function createAnimations(scene) {
  const standIns = [];

  for (const [key, def] of Object.entries(ANIMATIONS)) {
    if (scene.anims.exists(key)) continue;

    if (scene.textures.exists(key)) {
      scene.anims.create({
        key,
        frames: Array.from({ length: def.frames }, (_, frame) => ({ key, frame })),
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    } else if (def.standIn && scene.textures.exists(def.standIn.key)) {
      // No sheet of its own, but a stand-in is configured: a one-frame "animation" under the same key,
      // so whatever plays this state shows that still image and needs no special case.
      scene.anims.create({ key, frames: [def.standIn], frameRate: 1, repeat: 0 });
      standIns.push(key);
    }
  }

  if (standIns.length > 0) {
    const { key, frame } = BIG_FORM_STAND_IN;
    console.info(`[boot] big-form stopgap active: ${standIns.length} big-form states show frame ${frame} of ${key}.png as a still image, so big Little Bud does not animate. It switches itself off when BIG_FORM_PENDING is set to false in config/animations.js.`);
  }
}
