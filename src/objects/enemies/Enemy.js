import Phaser from 'phaser';
import { ENEMIES } from '../../config/constants.js';
import { alignBodyToFrame } from '../bodyAlign.js';
import { spawnEffect } from '../effects.js';
import Sfx from '../../audio/Sfx.js';

/**
 * Shared enemy behaviour: sleeping until the camera gets close, the touch/stomp/defeat
 * interface the scene relies on, a ground patrol that turns at walls and ledges, and the art hookup.
 * Subclasses implement act() and may override stomp().
 *
 * `art` describes how the enemy looks: { move, death, body, anchor }. move and death are animation
 * keys (death may be null); body is the fixed physics body size; anchor says whether that body sits
 * at the bottom of the frame (walkers) or in its centre (flyers). Without the animations the enemy
 * shows the placeholder texture it was created with.
 */
export default class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture, art, options = {}) {
    super(scene, x, y, texture);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.art = art;
    this.stompable = true; // false: landing on it hurts like any other touch
    this.slashable = false; // true: the player's leaf slash kills it
    this.collidesWithGround = true; // flyers turn this off
    this.direction = options.direction ?? -1; // -1 heads left, toward a player coming from the start
    this.homeX = x; // centre of its patrol: where the level (or a splitting parent) put it
    this.homeY = y;
    this.activated = false;
    this.defeated = false;
    this.harmlessUntil = 0; // scene clock time before which the enemy cannot touch the player

    this.setCollideWorldBounds(true);
    this.showAnimation(art.move);
    this.faceDirection();
    this.body.enable = false; // asleep: no gravity, no movement, no contact
  }

  preUpdate(time, delta) {
    super.preUpdate(time, delta);

    // A death animation that finishes during the line above destroys this enemy, leaving no scene.
    if (!this.scene) return;

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

  /** Plays an animation if its sheet loaded, then fits the body to the frame now showing. */
  showAnimation(key) {
    const available = Boolean(key) && this.scene.anims.exists(key);
    if (available) {
      this.play(key);
    }
    alignBodyToFrame(this, this.art.body, this.art.anchor ?? 'bottom');
    return available;
  }

  /** The art faces right, so moving left means flipping it. */
  faceDirection() {
    this.setFlipX(this.direction < 0);
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

  /**
   * Removes the enemy. With art: plays the death animation on the spot with a puff of dust.
   * Without it, 'squash' flattens the placeholder and 'knockout' flips it and drops it off the map.
   * `sound` is what it says as it goes.
   */
  defeat(style = 'squash', animKey = this.art.death, sound = 'enemy-death') {
    if (this.defeated) return;
    this.defeated = true;
    Sfx.play(sound);

    if (animKey && this.scene.anims.exists(animKey)) {
      this.body.enable = false;
      spawnEffect(this.scene, this.x, this.body.bottom, 'dust-puff', { bottom: true });
      this.showAnimation(animKey);
      this.once('animationcomplete', () => this.destroy());
      return;
    }

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
      y: this.y + this.body.height * 0.375, // keep the flattened sprite sitting on the ground
      duration: 90,
      onComplete: () => this.scene.time.delayedCall(220, () => this.destroy()),
    });
  }

  /**
   * Walks back and forth along the ground. It turns around at a wall or world edge, at a ledge, and at
   * `range` px either side of homeX, whichever comes first, so a walker stays where the level put it.
   */
  patrol(speed, range = Infinity, turnAtLedges = true) {
    const body = this.body;

    // Past the end of its range it heads for home. Inside the range this is 0 and changes nothing.
    const homeward = this.x < this.homeX - range ? 1 : this.x > this.homeX + range ? -1 : 0;
    if (homeward !== 0) {
      this.direction = homeward;
    }

    const wallAhead = this.direction < 0 ? body.blocked.left : body.blocked.right;
    const ledgeAhead = turnAtLedges && body.blocked.down && !this.hasGroundAhead();
    if (wallAhead || ledgeAhead) {
      if (homeward !== 0) {
        // Out of range with the way home cut off (only possible if something moved it there):
        // wait, facing home, rather than flip back and forth every frame.
        this.setVelocityX(0);
        this.faceDirection();
        return;
      }
      this.direction *= -1;
    }

    this.setVelocityX(speed * this.direction);
    this.faceDirection();
  }

  hasGroundAhead() {
    const body = this.body;
    const aheadX = this.direction > 0 ? body.right + 2 : body.left - 2;
    const tile = this.scene.groundLayer.getTileAtWorldXY(aheadX, body.bottom + 4);
    return Boolean(tile && tile.collides);
  }
}
