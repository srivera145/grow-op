import Phaser from 'phaser';
import { ATTACK, PLAYER, TEXTURES } from '../config/constants.js';
import { playerAnim } from '../config/animations.js';
import { alignBodyToFrame } from './bodyAlign.js';
import { spawnEffect } from './effects.js';
import { touchSource } from '../input/TouchSource.js';

const { KeyCodes, JustDown } = Phaser.Input.Keyboard;
const NO_INPUT = Object.freeze({ left: false, right: false, jumpHeld: false, jumpPressed: false, attackPressed: false });
const MIN_AIR_MS_FOR_LANDING = 100; // shorter hops (spawning, stepping off a 1px lip) get no landing animation

/**
 * The seedling. An Arcade sprite driven by acceleration and drag rather than
 * instant velocity, with variable jump height, coyote time and a jump buffer.
 * It also owns its growth state (small or big), its protective status effects, the leaf slash
 * attack, and the choice of which animation shows for what it is currently doing.
 *
 * The sprite's position is always the centre of its physics body (see bodyAlign.js), so none of
 * the movement code cares whether it is showing 64px art or a 32px placeholder.
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
      x: KeyCodes.X,
      j: KeyCodes.J,
    });

    // Countdown timers in ms. A jump fires on any frame where both are above zero.
    this.coyoteTimer = 0; // > 0 while a jump is still allowed after leaving the ground
    this.jumpBufferTimer = 0; // > 0 while a recent jump press is waiting to be used
    this.isJumping = false; // true while rising from a jump we started; enables the early-release cut

    this.controlsEnabled = true; // the scene turns this off for stage clear and game over
    this.isBig = false;
    this.invincibleUntil = 0; // scene clock time until which nutrient invincibility lasts
    this.mercyUntil = 0; // scene clock time until which post-hit protection lasts

    // Leaf slash. The zone is the attack's hitbox; its body is only enabled during the active frames.
    this.attackStartedAt = -Infinity;
    this.slashSpawned = false;
    this.attackZone = scene.add.zone(x, y, ATTACK.WIDTH, ATTACK.HEIGHT);
    scene.physics.add.existing(this.attackZone);
    this.attackZone.body.setAllowGravity(false);
    this.attackZone.body.enable = false;

    // Animation state. The *Until fields are scene clock times that hold a one-shot animation on screen.
    this.animState = null;
    this.animForm = null;
    this.isDead = false;
    this.isCelebrating = false;
    this.growUntil = 0;
    this.hurtUntil = 0;
    this.landUntil = 0;
    this.airTime = 0;

    this.showState('idle', true);
  }

  get form() {
    return this.isBig ? 'big' : 'small';
  }

  /** Called by the owning scene once per frame. */
  update(time, delta) {
    // Always read the keys so just-pressed flags are consumed even while controls are off.
    const pressed = this.readInput();
    const input = this.controlsEnabled ? pressed : NO_INPUT;
    const onGround = this.isOnGround();

    this.updateHorizontal(input, onGround);
    this.updateJump(input, onGround, delta);
    this.updateAttack(input);
    this.updateEffects();
    this.updateAnimation(onGround, delta);
  }

  readInput() {
    const k = this.keys;
    // Call JustDown on every key. Short-circuiting with || would leave a stale
    // just-down flag on the keys it skipped, which would then fire on a later frame.
    const spaceJust = JustDown(k.space);
    const upJust = JustDown(k.up);
    const wJust = JustDown(k.w);
    const xJust = JustDown(k.x);
    const jJust = JustDown(k.j);

    // The on-screen buttons are merged in, never substituted: either source can drive any input, and with
    // no finger on the screen every touch value is false, so this is exactly the keyboard result.
    // Reading consumes touch's pressed flags, once per frame, the same way JustDown consumed the keys above.
    const touch = touchSource.read();

    return {
      left: k.left.isDown || k.a.isDown || touch.left,
      right: k.right.isDown || k.d.isDown || touch.right,
      jumpHeld: k.space.isDown || k.up.isDown || k.w.isDown || touch.jumpHeld,
      jumpPressed: spaceJust || upJust || wJust || touch.jumpPressed,
      attackPressed: xJust || jJust || touch.attackPressed,
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
      this.setFlipX(true); // the art faces right
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

  /** Rebound off a stomped enemy. Holding jump turns it into a full-height, cuttable jump. */
  bounce() {
    const k = this.keys;
    const held = this.controlsEnabled && (k.space.isDown || k.up.isDown || k.w.isDown || touchSource.isHeld('jump'));
    this.setVelocityY(held ? PLAYER.JUMP_VELOCITY : PLAYER.STOMP_BOUNCE_VELOCITY);
    this.isJumping = held;
    this.coyoteTimer = 0;
  }

  // ---------- leaf slash ----------

  /**
   * Runs the attack on a timer that mirrors the attack animation's frames, so the hitbox and the
   * slash effect stay in step with the art and still work when the art is missing.
   */
  updateAttack(input) {
    const now = this.scene.time.now;
    if (input.attackPressed && now - this.attackStartedAt >= ATTACK.COOLDOWN_MS) {
      this.attackStartedAt = now;
      this.slashSpawned = false;
      this.animState = null; // lets a new attack restart the animation
    }

    const frame = Math.floor((now - this.attackStartedAt) / ATTACK.FRAME_MS);
    const active = !this.isDead && frame >= ATTACK.ACTIVE_FROM_FRAME && frame <= ATTACK.ACTIVE_TO_FRAME;
    const facing = this.flipX ? -1 : 1;
    const reach = PLAYER.BODY[this.form].width / 2 + ATTACK.WIDTH / 2; // hitbox starts at the front of the body

    this.attackZone.setPosition(this.x + facing * reach, this.y);
    this.attackZone.body.enable = active;

    if (active && !this.slashSpawned && frame >= ATTACK.SLASH_ON_FRAME) {
      this.slashSpawned = true;
      spawnEffect(this.scene, this.x + facing * reach, this.y, 'leaf-slash', { flipX: facing < 0 });
    }
  }

  isAttacking() {
    return this.scene.time.now - this.attackStartedAt < ATTACK.FRAME_MS * ATTACK.FRAMES;
  }

  // ---------- growth ----------

  grow() {
    if (this.isBig) return;
    this.setBig(true);
    this.growUntil = this.scene.time.now + PLAYER.GROW_ANIM_MS;
  }

  /** Swaps between the small and big forms while keeping the feet where they are. */
  setBig(big) {
    if (big === this.isBig) return;

    const oldHeight = PLAYER.BODY[this.form].height;
    this.isBig = big;
    const newHeight = PLAYER.BODY[this.form].height;

    // The sprite's position is the centre of its body, so half the height change pins the feet.
    this.y += (oldHeight - newHeight) / 2;
    this.showState(this.animState ?? 'idle', true);
  }

  // ---------- damage and protection ----------

  /**
   * Applies one hit from an enemy or hazard. Returns true when the hit is fatal, which
   * the scene turns into a lost life. A big player shrinks instead and gets a short
   * mercy window; invincible or mercy-protected players ignore the hit entirely.
   */
  takeHit() {
    if (this.isInvincible() || this.hasMercy()) return false;

    if (this.isBig) {
      this.setBig(false);
      this.mercyUntil = this.scene.time.now + PLAYER.HIT_MERCY_MS;
      this.hurtUntil = this.scene.time.now + PLAYER.HURT_ANIM_MS;
      this.growUntil = 0;
      return false;
    }
    return true;
  }

  makeInvincible(duration = PLAYER.NUTRIENT_DURATION_MS) {
    this.invincibleUntil = this.scene.time.now + duration;
  }

  isInvincible() {
    return this.scene.time.now < this.invincibleUntil;
  }

  hasMercy() {
    return this.scene.time.now < this.mercyUntil;
  }

  /** Death animation for a fatal hit: a short hop, then a fall through the floor and off the map. */
  die() {
    this.isDead = true;
    this.controlsEnabled = false;
    this.attackZone.body.enable = false;
    this.body.checkCollision.none = true;
    this.setCollideWorldBounds(false);
    this.setAcceleration(0, 0);
    this.setVelocity(0, PLAYER.DEATH_HOP_VELOCITY);
  }

  /** Level cleared: hold the victory animation until the scene changes. */
  celebrate() {
    this.isCelebrating = true;
    this.clearTint();
    this.setAlpha(1); // from here on the scene's jarring tween owns the sprite's alpha
  }

  /** Puts a fresh small player at the given point, briefly protected, with every other effect cleared. */
  respawn(x, y) {
    this.setBig(false);
    this.body.checkCollision.none = false;
    this.setCollideWorldBounds(true);
    this.invincibleUntil = 0;
    this.mercyUntil = this.scene.time.now + PLAYER.HIT_MERCY_MS;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.isJumping = false;
    this.controlsEnabled = true;
    this.isDead = false;
    this.isCelebrating = false;
    this.growUntil = 0;
    this.hurtUntil = 0;
    this.landUntil = 0;
    this.airTime = 0;
    this.attackStartedAt = -Infinity;
    this.clearTint();
    this.setAlpha(1);
    this.setAcceleration(0, 0);
    this.body.reset(x, y);
  }

  updateEffects() {
    if (this.isCelebrating) return;
    const phase = Math.floor(this.scene.time.now / PLAYER.FLASH_INTERVAL_MS);

    // Nutrient invincibility cycles through a set of tints.
    if (this.isInvincible()) {
      this.setTint(PLAYER.INVINCIBLE_TINTS[phase % PLAYER.INVINCIBLE_TINTS.length]);
    } else if (this.isTinted) {
      this.clearTint();
    }

    // Post-hit mercy blinks the sprite.
    if (this.hasMercy()) {
      this.setAlpha(phase % 2 === 0 ? 1 : 0.35);
    } else if (this.alpha !== 1) {
      this.setAlpha(1);
    }
  }

  // ---------- animation ----------

  /** Picks the animation for what the player is doing right now. One-shot states outrank movement. */
  updateAnimation(onGround, delta) {
    const now = this.scene.time.now;

    if (onGround) {
      if (this.airTime >= MIN_AIR_MS_FOR_LANDING && !this.isDead) {
        this.landUntil = now + PLAYER.LAND_ANIM_MS;
        spawnEffect(this.scene, this.x, this.body.bottom, 'dust-puff', { bottom: true });
      }
      this.airTime = 0;
    } else {
      this.airTime += delta;
    }

    let state;
    if (this.isDead) {
      state = 'die';
    } else if (this.isCelebrating) {
      state = 'victory';
    } else if (now < this.growUntil) {
      state = 'grow';
    } else if (now < this.hurtUntil) {
      state = 'hurt';
    } else if (this.isAttacking()) {
      state = 'attack';
    } else if (!onGround) {
      state = this.body.velocity.y > 0 ? 'fall' : 'jump'; // jump plays once on takeoff, fall takes over at the apex
    } else if (now < this.landUntil) {
      state = 'land';
    } else {
      const speed = Math.abs(this.body.velocity.x);
      if (speed < PLAYER.IDLE_SPEED) state = 'idle';
      else state = speed < PLAYER.RUN_SPEED * PLAYER.RUN_ANIM_THRESHOLD ? 'walk' : 'run';
    }
    this.showState(state);
  }

  /**
   * Shows the animation for a state in the current form, or the form's placeholder when that
   * animation's sheet is not available, then fits the body to whatever frame is now on screen.
   */
  showState(state, force = false) {
    if (!force && state === this.animState && this.form === this.animForm) return;
    this.animState = state;
    this.animForm = this.form;

    const key = state === 'grow' ? 'little-bud-grow' : playerAnim(this.form, state);
    if (this.scene.anims.exists(key)) {
      this.play(key);
    } else {
      this.anims.stop();
      this.setTexture(this.isBig ? TEXTURES.PLAYER_BIG : TEXTURES.PLAYER);
    }
    // The first fit (from the constructor) places the body from the sprite; later ones keep the feet planted.
    alignBodyToFrame(this, PLAYER.BODY[this.form], 'bottom', this.bodyFitted === true);
    this.bodyFitted = true;
  }
}
