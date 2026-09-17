import Enemy from './Enemy.js';
import { ENEMIES, TEXTURES } from '../../config/constants.js';

const ART = { move: 'spider-mite-walk', death: 'spider-mite-death', body: ENEMIES.SPIDER_MITE.BODY, anchor: 'bottom' };

/** Ground walker. Turns around at walls, ledges and the ends of its patrol range, and dies to a single stomp or a leaf slash. */
export default class SpiderMite extends Enemy {
  constructor(scene, x, y, options) {
    super(scene, x, y, TEXTURES.SPIDER_MITE, ART, options);
    this.slashable = true;
  }

  act() {
    this.patrol(ENEMIES.SPIDER_MITE.SPEED, ENEMIES.SPIDER_MITE.RANGE);
  }
}
