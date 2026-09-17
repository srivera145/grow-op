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
    const T = TEXTURES;
    this.makePlaceholder(T.PLAYER, 32, 32, 0x4cd137, 0x2f8f22);
    this.makePlaceholder(T.PLAYER_BIG, 32, 48, 0x4cd137, 0x2f8f22);
    this.makePlaceholder(T.TILE_SOIL, TILE_SIZE, TILE_SIZE, 0x6b4226, 0x4a2c18);
    this.makePlaceholder(T.WATER_DROP, 16, 16, 0x4cc9f0, 0x2a7fb8, { shape: 'circle' });
    this.makePlaceholder(T.LIGHT_ORB, 24, 24, 0xffd60a, 0xc79a00, { shape: 'circle' });
    this.makePlaceholder(T.NUTRIENT, 24, 24, 0x9d4edd, 0x6a2ba8, { shape: 'circle' });
    this.makePlaceholder(T.GOAL_JAR, 32, 64, 0xa8dadc, 0x457b9d, { lidColor: 0x6d4c41 });
    this.makePlaceholder(T.SPIDER_MITE, 32, 24, 0xd62828, 0x8d1a1a);
    this.makePlaceholder(T.FUNGUS_GNAT, 24, 24, 0x9aa0a6, 0x5f6368, { shape: 'circle' });
    this.makePlaceholder(T.ROOT_ROT, 32, 32, 0x31572c, 0x1b3318, { shape: 'circle' });

    this.scene.start('TitleScene');
  }

  /**
   * Bakes a bordered shape into a texture. Rectangles by default; `shape: 'circle'` draws a
   * disc, and `lidColor` paints a band across the top (used for the jar).
   */
  makePlaceholder(key, width, height, fillColor, borderColor, options = {}) {
    const g = this.make.graphics({ add: false });

    if (options.shape === 'circle') {
      const radius = Math.min(width, height) / 2;
      g.fillStyle(borderColor, 1);
      g.fillCircle(width / 2, height / 2, radius);
      g.fillStyle(fillColor, 1);
      g.fillCircle(width / 2, height / 2, radius - 1.5);
    } else {
      g.fillStyle(borderColor, 1);
      g.fillRect(0, 0, width, height);
      g.fillStyle(fillColor, 1);
      g.fillRect(1, 1, width - 2, height - 2);
    }

    if (options.lidColor !== undefined) {
      g.fillStyle(options.lidColor, 1);
      g.fillRect(0, 0, width, 10);
    }

    g.generateTexture(key, width, height);
    g.destroy();
  }
}
