import Enemy from './Enemy.js';
import { ENEMIES, TEXTURES } from '../../config/constants.js';

/** Ground walker. Turns around at walls and ledges, and dies to a single stomp. */
export default class SpiderMite extends Enemy {
  constructor(scene, x, y, options) {
    super(scene, x, y, TEXTURES.SPIDER_MITE, options);
  }

  act() {
    this.patrol(ENEMIES.SPIDER_MITE.SPEED);
  }
}
