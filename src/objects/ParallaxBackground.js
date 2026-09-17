import { GAME_HEIGHT, GAME_WIDTH, PARALLAX } from '../config/constants.js';

/**
 * Screen-sized, horizontally tiling layers pinned to the camera. Each one slides by a fraction of the
 * camera's scroll, so far layers drift slowly and near ones faster. All layers draw behind the level.
 * A layer whose image did not load is skipped, leaving the camera's background colour.
 */
export default class ParallaxBackground {
  constructor(scene) {
    this.scene = scene;
    this.layers = PARALLAX.filter((layer) => scene.textures.exists(layer.key)).map((layer, index) => ({
      key: layer.key,
      factor: layer.factor,
      sprite: scene.add
        .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, layer.key)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(-100 + index),
    }));
  }

  /** Call once per frame after the camera has moved. */
  update() {
    const scrollX = this.scene.cameras.main.scrollX;
    for (const layer of this.layers) {
      layer.sprite.tilePositionX = Math.round(scrollX * layer.factor);
    }
  }
}
