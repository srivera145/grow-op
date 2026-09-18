import Enemy from './Enemy.js';
import { ENEMIES, TEXTURES } from '../../config/constants.js';

const CFG = ENEMIES.ROOT_ROT;
// A full-size blob has no death animation of its own: a stomp plays its split, anything else knocks it out.
const ART = { move: 'root-rot-crawl', death: null, body: CFG.BODY, anchor: 'bottom' };
const MINI_ART = { move: 'root-rot-mini-crawl', death: 'root-rot-mini-death', body: CFG.SMALL_BODY, anchor: 'bottom' };

/**
 * Slow blob. Killing a full-size one splits it into two mini blobs that hop apart, whether it was
 * stomped or walked through under a nutrient; the minis are faster and die without splitting again.
 * The leaf slash does nothing to either size.
 * Both sizes patrol a range around where they appeared: a mini's centre is the spot it split off at,
 * not the place its parent was first put.
 */
export default class RootRot extends Enemy {
  constructor(scene, x, y, options = {}) {
    const small = options.small === true;
    super(scene, x, y, small ? TEXTURES.ROOT_ROT_MINI : TEXTURES.ROOT_ROT, small ? MINI_ART : ART, options);
    this.isSmall = small;
  }

  act() {
    this.patrol(this.isSmall ? CFG.SMALL_SPEED : CFG.SPEED, this.isSmall ? CFG.SMALL_RANGE : CFG.RANGE);
  }

  stomp() {
    if (this.isSmall) {
      this.defeat('squash');
      return;
    }
    this.burst();
  }

  /**
   * Walking through a blob under a nutrient splits it exactly as a stomp does. Anything less would leave
   * a level worth fewer points to a player carrying a nutrient, so the order pickups were taken in would
   * decide the level's maximum score, and grades are a share of that maximum (see state/levelScore.js).
   * Minis still go outright: there is nothing left for them to split into.
   */
  knockout() {
    if (this.isSmall) {
      this.defeat('knockout');
      return;
    }
    this.burst();
  }

  /** Leaves one mini per split direction and goes, with the split animation and its sound. */
  burst() {
    this.split();
    this.defeat('squash', 'root-rot-split', 'root-rot-split');
  }

  split() {
    const y = this.body.bottom - CFG.SMALL_BODY.height / 2 - 1;

    for (const direction of CFG.SPLIT_DIRECTIONS) {
      const blob = this.scene.spawnEnemy('root-rot', this.x + direction * CFG.SPLIT_OFFSET, y, { small: true, direction });
      blob.activate();
      blob.harmlessUntil = this.scene.time.now + ENEMIES.SPAWN_GRACE_MS; // the stomping player is still on top of them
      blob.setVelocityY(CFG.SPLIT_HOP_VELOCITY);
    }
  }
}
