import Enemy from './Enemy.js';
import { ENEMIES, TEXTURES } from '../../config/constants.js';

const CFG = ENEMIES.ROOT_ROT;

/**
 * Slow blob. Stomping a full-size one splits it into two small blobs that hop apart;
 * the small ones are faster and die to a stomp without splitting again.
 */
export default class RootRot extends Enemy {
  constructor(scene, x, y, options = {}) {
    super(scene, x, y, TEXTURES.ROOT_ROT, options);

    this.isSmall = options.small === true;
    if (this.isSmall) {
      this.setScale(CFG.SMALL_SCALE);
      this.body.updateBounds(); // size the hitbox to the scaled sprite now, not on the next physics step
    }
  }

  act() {
    this.patrol(this.isSmall ? CFG.SMALL_SPEED : CFG.SPEED);
  }

  stomp() {
    if (!this.isSmall) {
      this.split();
    }
    this.defeat('squash');
  }

  split() {
    const smallHeight = this.height * CFG.SMALL_SCALE;
    const y = this.body.bottom - smallHeight / 2 - 1;

    for (const direction of [-1, 1]) {
      const blob = this.scene.spawnEnemy('root-rot', this.x + direction * CFG.SPLIT_OFFSET, y, { small: true, direction });
      blob.activate();
      blob.harmlessUntil = this.scene.time.now + ENEMIES.SPAWN_GRACE_MS; // the stomping player is still on top of them
      blob.setVelocityY(CFG.SPLIT_HOP_VELOCITY);
    }
  }
}
