import Phaser from 'phaser';
import { TEXTURES } from '../config/constants.js';

// Pickup kinds are named after the objects in the Tiled "objects" layer.
export const PICKUP_KINDS = {
  'water-drop': { texture: TEXTURES.WATER_DROP, bob: true },
  'light-orb': { texture: TEXTURES.LIGHT_ORB, bob: true },
  nutrient: { texture: TEXTURES.NUTRIENT, bob: true },
  'goal-jar': { texture: TEXTURES.GOAL_JAR, bob: false },
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
    this.collected = false;

    scene.add.existing(this);
    scene.physics.add.existing(this, true); // static body: pickups ignore gravity and never move

    if (def.bob) {
      // Visual only. The static body stays put, which is fine for a 3px drift.
      this.bobTween = scene.tweens.add({
        targets: this,
        y: y - 3,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** Plays the vanish effect and removes the pickup. Returns false if it was already taken. */
  collect() {
    if (this.collected) return false;
    this.collected = true;
    this.body.enable = false;

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
