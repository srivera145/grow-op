import Phaser from 'phaser';
import { ENEMIES } from '../../config/constants.js';

/**
 * Shared enemy behaviour: sleeping until the camera gets close, the touch/stomp/defeat
 * interface the scene relies on, and a ground patrol that turns at walls and ledges.
 * Subclasses implement act() and may override stomp().
 */
export default class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture, options = {}) {
    super(scene, x, y, texture);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.stompable = true; // false: landing on it hurts like any other touch
    this.collidesWithGround = true; // flyers turn this off
    this.direction = options.direction ?? -1; // -1 heads left, toward a player coming from the start
    this.activated = false;
    this.defeated = false;
    this.harmlessUntil = 0; // scene clock time before which the enemy cannot touch the player

    this.setCollideWorldBounds(true);
    this.body.enable = false; // asleep: no gravity, no movement, no contact
  }

  preUpdate(time, delta) {
    super.preUpdate(time, delta);

    if (this.y > this.scene.map.heightInPixels + ENEMIES.DESPAWN_MARGIN) {
      this.destroy();
      return;
    }
    if (this.defeated) return;

    if (!this.activated) {
      if (this.isNearCamera()) this.activate();
      return;
    }
    this.act(time, delta);
  }

  /** True once the enemy is within the activation range of what the camera currently shows. */
  isNearCamera() {
    const camera = this.scene.cameras.main;
    const range = camera.width * ENEMIES.ACTIVATION_SCREENS;
    return this.x >= camera.scrollX - range && this.x <= camera.scrollX + camera.width + range;
  }

  /** Wakes the enemy up. It never goes back to sleep. */
  activate() {
    this.activated = true;
    this.body.enable = true;
  }

  /** Per-frame behaviour while awake. */
  act() {}

  /** Whether touching this enemy means anything right now. */
  canTouch() {
    return this.activated && !this.defeated && this.scene.time.now >= this.harmlessUntil;
  }

  /** Called by the scene when the player lands on a stompable enemy. */
  stomp() {
    this.defeat('squash');
  }

  /** Removes the enemy: 'squash' flattens it in place, 'knockout' flips it and drops it off the map. */
  defeat(style = 'squash') {
    if (this.defeated) return;
    this.defeated = true;

    if (style === 'knockout') {
      this.body.checkCollision.none = true;
      this.body.setAllowGravity(true);
      this.setCollideWorldBounds(false);
      this.setFlipY(true);
      this.setVelocity(60 * this.direction, -260);
      return; // preUpdate destroys it once it has fallen below the map
    }

    this.body.enable = false;
    this.scene.tweens.add({
      targets: this,
      scaleY: this.scaleY * 0.25,
      y: this.y + this.displayHeight * 0.375, // keep the flattened sprite sitting on the ground
      duration: 90,
      onComplete: () => this.scene.time.delayedCall(220, () => this.destroy()),
    });
  }

  /** Walks along the ground, reversing at walls, world edges and (optionally) ledges. */
  patrol(speed, turnAtLedges = true) {
    const body = this.body;
    if (body.blocked.left) {
      this.direction = 1;
    } else if (body.blocked.right) {
      this.direction = -1;
    } else if (turnAtLedges && body.blocked.down && !this.hasGroundAhead()) {
      this.direction *= -1;
    }
    this.setVelocityX(speed * this.direction);
    this.setFlipX(this.direction > 0);
  }

  hasGroundAhead() {
    const body = this.body;
    const aheadX = this.direction > 0 ? body.right + 2 : body.left - 2;
    const tile = this.scene.groundLayer.getTileAtWorldXY(aheadX, body.bottom + 4);
    return Boolean(tile && tile.collides);
  }
}
