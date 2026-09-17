import Phaser from 'phaser';
import { PICKUPS, TEXTURES } from '../config/constants.js';
import { alignBodyToFrame } from './bodyAlign.js';
import Sfx from '../audio/Sfx.js';

// Pickup kinds are named after the objects in the Tiled "objects" layer.
// texture: placeholder shown when the art is missing. idle: looping animation. body: fixed hitbox size,
// from PICKUPS.BODY. anchor: where that hitbox sits in the art frame ('bottom' also means it stands on the ground).
export const PICKUP_KINDS = {
  'water-drop': { texture: TEXTURES.WATER_DROP, idle: 'water-drop-idle', body: PICKUPS.BODY['water-drop'], anchor: 'center', sound: 'water-drop' },
  'light-orb': { texture: TEXTURES.LIGHT_ORB, idle: 'light-orb-idle', body: PICKUPS.BODY['light-orb'], anchor: 'center', sound: 'light-orb' },
  nutrient: { texture: TEXTURES.NUTRIENT, idle: 'nutrient-idle', body: PICKUPS.BODY.nutrient, anchor: 'center', sound: 'nutrient' },
  'goal-jar': { texture: TEXTURES.GOAL_JAR, idle: 'goal-jar-idle', close: 'goal-jar-close', closeSound: 'jar-close', body: PICKUPS.BODY['goal-jar'], anchor: 'bottom', still: true },
};

/**
 * Something the player touches to trigger an effect. The pickup only knows what kind it
 * is and how to disappear; the scene decides what each kind does to the score and player.
 */
export default class Pickup extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, kind) {
    const def = PICKUP_KINDS[kind];
    if (!def) {
      throw new Error(`Unknown pickup kind "${kind}"`);
    }
    super(scene, x, y, def.texture);

    this.kind = kind;
    this.def = def;
    this.collected = false;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false); // pickups hang where the level put them
    this.body.setImmovable(true);

    const animated = this.showAnimation(def.idle);
    if (!animated && !def.still) {
      // Placeholders get a gentle bob so they still read as pickups. The art has its own idle motion.
      this.bobTween = scene.tweens.add({ targets: this, y: y - 3, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  /** Plays an animation if its sheet loaded, then fits the hitbox to the frame now showing. */
  showAnimation(key) {
    const available = Boolean(key) && this.scene.anims.exists(key);
    if (available) {
      this.play(key);
    }
    alignBodyToFrame(this, this.def.body, this.def.anchor);
    return available;
  }

  /** Goal jar only: plays the lid closing. Returns false when that animation is not available. */
  close() {
    Sfx.play(this.def.closeSound);
    return this.showAnimation(this.def.close);
  }

  /** Plays the vanish effect and removes the pickup. Returns false if it was already taken. */
  collect() {
    if (this.collected) return false;
    this.collected = true;
    this.body.enable = false;
    Sfx.play(this.def.sound);

    if (this.bobTween) {
      this.bobTween.stop();
    }
    this.scene.tweens.add({
      targets: this,
      scale: 1.6,
      alpha: 0,
      duration: 150,
      onComplete: () => this.destroy(),
    });
    return true;
  }
}
