/**
 * Plays a one-shot effect animation (dust-puff, leaf-slash) at a point and cleans it up afterwards.
 * Does nothing when the effect's sheet did not load. Pass bottom: true to stand the effect on the point.
 */
export function spawnEffect(scene, x, y, animKey, { flipX = false, bottom = false, depth = 5 } = {}) {
  if (!scene.anims.exists(animKey)) return null;

  const effect = scene.add.sprite(x, y, animKey, 0);
  effect.setOrigin(0.5, bottom ? 1 : 0.5).setFlipX(flipX).setDepth(depth);
  effect.play(animKey);
  effect.once('animationcomplete', () => effect.destroy());
  return effect;
}
