import Phaser from 'phaser';
import { PLAYER, TEXTURES } from '../config/constants.js';

const { KeyCodes, JustDown } = Phaser.Input.Keyboard;

/**
 * The seedling. An Arcade sprite driven by acceleration and drag rather than
 * instant velocity, with variable jump height, coyote time and a jump buffer.
 */
export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, TEXTURES.PLAYER);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.setMaxVelocity(PLAYER.RUN_SPEED, PLAYER.MAX_FALL_SPEED);
    this.setDragX(PLAYER.DRAG);

    this.keys = scene.input.keyboard.addKeys({
      left: KeyCodes.LEFT,
      right: KeyCodes.RIGHT,
      up: KeyCodes.UP,
      a: KeyCodes.A,
      d: KeyCodes.D,
      w: KeyCodes.W,
      space: KeyCodes.SPACE,
    });

    // Countdown timers in ms. A jump fires on any frame where both are above zero.
    this.coyoteTimer = 0; // > 0 while a jump is still allowed after leaving the ground
    this.jumpBufferTimer = 0; // > 0 while a recent jump press is waiting to be used
    this.isJumping = false; // true while rising from a jump we started; enables the early-release cut
  }

  /** Called by the owning scene once per frame. */
  update(time, delta) {
    const input = this.readInput();
    const onGround = this.isOnGround();

    this.updateHorizontal(input, onGround);
    this.updateJump(input, onGround, delta);
  }

  readInput() {
    const k = this.keys;
    // Call JustDown on every jump key. Short-circuiting with || would leave a stale
    // just-down flag on the keys it skipped, which would then fire on a later frame.
    const spaceJust = JustDown(k.space);
    const upJust = JustDown(k.up);
    const wJust = JustDown(k.w);

    return {
      left: k.left.isDown || k.a.isDown,
      right: k.right.isDown || k.d.isDown,
      jumpHeld: k.space.isDown || k.up.isDown || k.w.isDown,
      jumpPressed: spaceJust || upJust || wJust,
    };
  }

  isOnGround() {
    const body = this.body;
    // The velocity check covers frames where no physics step ran (high refresh-rate displays),
    // so a jump launched last frame is not mistaken for standing on the ground.
    return (body.blocked.down || body.touching.down) && body.velocity.y >= 0;
  }

  updateHorizontal(input, onGround) {
    const accel = onGround ? PLAYER.ACCELERATION : PLAYER.AIR_ACCELERATION;
    this.setDragX(onGround ? PLAYER.DRAG : PLAYER.AIR_DRAG);

    if (input.left && !input.right) {
      this.setAccelerationX(-accel);
      this.setFlipX(true);
    } else if (input.right && !input.left) {
      this.setAccelerationX(accel);
      this.setFlipX(false);
    } else {
      // No input: zero acceleration lets drag ease the player to a stop.
      this.setAccelerationX(0);
    }
  }

  updateJump(input, onGround, delta) {
    // Refill the windows: coyote time while grounded, jump buffer on a fresh press.
    if (onGround) {
      this.coyoteTimer = PLAYER.COYOTE_TIME_MS;
    }
    if (input.jumpPressed) {
      this.jumpBufferTimer = PLAYER.JUMP_BUFFER_MS;
    }

    // A jump fires when a recent press meets recent ground contact. Both windows are
    // consumed so neither the same press nor the same ledge can produce a second jump.
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.setVelocityY(PLAYER.JUMP_VELOCITY);
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.isJumping = true;
    }

    // Count down after the check, so the first airborne frame still counts in full
    // toward the coyote window instead of losing a frame before it can be used.
    if (!onGround) {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - delta);

    // Variable height: releasing jump while still rising trims the upward velocity.
    if (this.isJumping && !input.jumpHeld && this.body.velocity.y < 0) {
      this.setVelocityY(this.body.velocity.y * PLAYER.JUMP_CUT_MULTIPLIER);
      this.isJumping = false;
    }

    // Past the apex, or once landed, the cut no longer applies.
    if (this.body.velocity.y >= 0) {
      this.isJumping = false;
    }
  }
}
