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

// The big-form strips (little-bud-big-*.png) had not been exported when this was written. Pending sheets
// are not requested at all, which keeps the console free of 404s; the big form shows its placeholder
// until they exist. Set this to false once the files are in public/assets/sheets.
const BIG_FORM_PENDING = true;

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

function playerForm(form, extra = {}) {
  return Object.fromEntries(Object.entries(PLAYER_STATES).map(([state, def]) => [playerAnim(form, state), { ...def, ...extra }]));
}

/** Animation key for a player form ('small' | 'big') and state ('idle', 'run', ...). */
export function playerAnim(form, state) {
  return `little-bud-${form}-${state}`;
}

export const ANIMATIONS = {
  // Player
  ...playerForm('small'),
  ...playerForm('big', { pending: BIG_FORM_PENDING }),
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

/** Registers an animation for every sheet that actually loaded. Called once from BootScene. */
export function createAnimations(scene) {
  for (const [key, def] of Object.entries(ANIMATIONS)) {
    if (!scene.textures.exists(key) || scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: Array.from({ length: def.frames }, (_, frame) => ({ key, frame })),
      frameRate: def.frameRate,
      repeat: def.repeat,
    });
  }
}
