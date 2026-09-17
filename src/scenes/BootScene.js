import Phaser from 'phaser';
import { PARALLAX, TEXTURES, TILE_SIZE } from '../config/constants.js';
import { ANIMATIONS, SHEET_PATH, createAnimations } from '../config/animations.js';

/**
 * Loads the art and prepares everything that depends on it.
 *
 * Placeholder textures are always generated, and every sprite in the game is created with one. Real art
 * comes in as animation strips; a strip that is missing or fails to load just means that animation does
 * not exist, so the sprite keeps its placeholder. Nothing downstream needs to know which case it is in.
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    this.failed = [];
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => this.failed.push(file.key));

    for (const [key, def] of Object.entries(ANIMATIONS)) {
      if (!def.pending) {
        this.load.image(key, `${SHEET_PATH}/${key}.png`);
      }
    }
    for (const layer of PARALLAX) {
      this.load.image(layer.key, `assets/bg/${layer.key}.png`);
    }
  }

  create() {
    this.makePlaceholders();
    this.sliceStrips();
    createAnimations(this);
    this.reportArt();

    this.scene.start('TitleScene');
  }

  makePlaceholders() {
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
    this.makePlaceholder(T.ROOT_ROT_MINI, 20, 20, 0x31572c, 0x1b3318, { shape: 'circle' });
  }

  /**
   * Cuts each loaded strip into numbered frames. The frame width comes from the image itself
   * (width / frame count), so the animation table never has to state pixel sizes.
   */
  sliceStrips() {
    for (const [key, def] of Object.entries(ANIMATIONS)) {
      if (!this.textures.exists(key)) continue;

      const texture = this.textures.get(key);
      const image = texture.getSourceImage();
      const frameWidth = image.width / def.frames;
      if (!Number.isInteger(frameWidth)) {
        console.warn(`[boot] ${key}.png is ${image.width}px wide, which does not divide into ${def.frames} frames`);
      }
      for (let i = 0; i < def.frames; i++) {
        texture.add(i, 0, Math.floor(i * frameWidth), 0, Math.floor(frameWidth), image.height);
      }
    }
  }

  reportArt() {
    const sheets = Object.entries(ANIMATIONS);
    const pending = sheets.filter(([, def]) => def.pending).map(([key]) => key);
    const loaded = sheets.filter(([key]) => this.textures.exists(key)).length;
    console.info(`[boot] art: ${loaded} of ${sheets.length} animation sheets loaded, ${pending.length} marked pending`);
    if (this.failed.length > 0) {
      console.warn(`[boot] missing art, placeholders will be used instead: ${this.failed.join(', ')}`);
    }
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
