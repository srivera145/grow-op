import Enemy from './Enemy.js';
import { ENEMIES, TEXTURES } from '../../config/constants.js';

const CFG = ENEMIES.FUNGUS_GNAT;
const ART = { move: 'fungus-gnat-fly', death: 'fungus-gnat-death', body: CFG.BODY, anchor: 'center' };
const OMEGA = (2 * Math.PI) / CFG.PERIOD_MS; // radians per ms
const STEPS_PER_SECOND = 60; // Arcade's fixed physics rate

/**
 * Flyer. Drifts back and forth around its spawn point on a sine wave, ignores the ground,
 * and cannot be stomped: touching it from any side hurts. A leaf slash or an invincible player kills it.
 */
export default class FungusGnat extends Enemy {
  constructor(scene, x, y, options) {
    super(scene, x, y, TEXTURES.FUNGUS_GNAT, ART, options);

    this.stompable = false;
    this.slashable = true;
    this.collidesWithGround = false;
    this.body.setAllowGravity(false);
    this.setCollideWorldBounds(false);

    this.flightTime = 0; // homeX and homeY, the centre of its flight, are set by Enemy
  }

  act(time, delta) {
    this.flightTime += delta;

    if (this.x < this.homeX - CFG.RANGE) {
      this.direction = 1;
    } else if (this.x > this.homeX + CFG.RANGE) {
      this.direction = -1;
    }

    // Steer toward the exact point on the wave each step, so the path never drifts.
    const targetY = this.homeY + CFG.AMPLITUDE * Math.sin(OMEGA * this.flightTime);
    this.setVelocity(CFG.SPEED * this.direction, (targetY - this.y) * STEPS_PER_SECOND);
    this.faceDirection();
  }
}
