import Phaser from 'phaser';
import { TEXTURES, TILE_SIZE } from '../config/constants.js';

/**
 * Generates placeholder textures so the game runs with no art files.
 * Each texture is registered under the key the final sprite will use, so swapping in
 * real art later is a matter of loading a file under the same key.
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    this.makePlaceholder(TEXTURES.PLAYER, TILE_SIZE, TILE_SIZE, 0x4cd137, 0x2f8f22);
    this.makePlaceholder(TEXTURES.TILE_SOIL, TILE_SIZE, TILE_SIZE, 0x6b4226, 0x4a2c18);
    this.scene.start('GameScene');
  }

  /**
   * Draws a filled rectangle with a 1px darker border and bakes it into a texture.
   * The border keeps neighbouring tiles readable as separate blocks.
   */
  makePlaceholder(key, width, height, fillColor, borderColor) {
    const g = this.make.graphics({ add: false });
    g.fillStyle(borderColor, 1);
    g.fillRect(0, 0, width, height);
    g.fillStyle(fillColor, 1);
    g.fillRect(1, 1, width - 2, height - 2);
    g.generateTexture(key, width, height);
    g.destroy();
  }
}
