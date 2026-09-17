import Enemy from './Enemy.js';
import { ENEMIES, TEXTURES } from '../../config/constants.js';

const CFG = ENEMIES.ROOT_ROT;
// A full-size blob has no death animation of its own: a stomp plays its split, anything else knocks it out.
const ART = { move: 'root-rot-crawl', death: null, body: CFG.BODY, anchor: 'bottom' };
const MINI_ART = { move: 'root-rot-mini-crawl', death: 'root-rot-mini-death', body: CFG.SMALL_BODY, anchor: 'bottom' };

/**
 * Slow blob. Stomping a full-size one splits it into two mini blobs that hop apart;
 * the minis are faster and die to a stomp without splitting again. The leaf slash does nothing to either.
 */
export default class RootRot extends Enemy {
  constructor(scene, x, y, options = {}) {
    const small = options.small === true;
    super(scene, x, y, small ? TEXTURES.ROOT_ROT_MINI : TEXTURES.ROOT_ROT, small ? MINI_ART : ART, options);
    this.isSmall = small;
  }

  act() {
    this.patrol(this.isSmall ? CFG.SMALL_SPEED : CFG.SPEED);
  }

  stomp() {
    if (this.isSmall) {
      this.defeat('squash');
      return;
    }
    this.split();
    this.defeat('squash', 'root-rot-split');
  }

  split() {
    const y = this.body.bottom - CFG.SMALL_BODY.height / 2 - 1;

    for (const direction of [-1, 1]) {
      const blob = this.scene.spawnEnemy('root-rot', this.x + direction * CFG.SPLIT_OFFSET, y, { small: true, direction });
      blob.activate();
      blob.harmlessUntil = this.scene.time.now + ENEMIES.SPAWN_GRACE_MS; // the stomping player is still on top of them
      blob.setVelocityY(CFG.SPLIT_HOP_VELOCITY);
    }
  }
}
