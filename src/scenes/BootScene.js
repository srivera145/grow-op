import Phaser from 'phaser';
import { PARALLAX, TEXTURES, TILESETS, TILE_SIZE, UI } from '../config/constants.js';
import { ANIMATIONS, SHEET_PATH, createAnimations } from '../config/animations.js';

/**
 * Loads the art and prepares everything that depends on it.
 *
 * Placeholder textures are always generated, and every sprite in the game is created with one. Real art
 * comes in as animation strips; a strip that is missing or fails to load just means that animation does
 * not exist, so the sprite keeps its placeholder. Nothing downstream needs to know which case it is in.
 *
 * Still images follow the same idea in the way that suits each: a missing edge tileset gets a generated
 * stand-in under the same key, a missing background layer is skipped, and the HUD and title screen fall
 * back to plain text when their images are not there.
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Every key asked for here. Afterwards, whichever of them has no texture is missing art. That covers a
    // plain 404 as well as a dev server that answers a missing file with an HTML page, which Phaser reports
    // as a processing error rather than a load error.
    this.requested = [];
    const request = (key) => this.requested.push(key);

    for (const [key, def] of Object.entries(ANIMATIONS)) {
      if (!def.pending) {
        this.load.image(key, `${SHEET_PATH}/${key}.png`);
        request(key);
      }
    }
    for (const layer of PARALLAX) {
      this.load.image(layer.key, `assets/bg/${layer.key}.png`);
      request(layer.key);
    }
    for (const [key, def] of Object.entries(TILESETS)) {
      this.load.image(key, def.file);
      request(key);
    }
    this.load.image(UI.LOGO.key, UI.LOGO.file);
    request(UI.LOGO.key);
    this.load.image(UI.HUD_ICONS.key, UI.HUD_ICONS.file); // cut into one frame per icon in sliceHudIcons()
    request(UI.HUD_ICONS.key);
  }

  create() {
    // Checked before the placeholders are made, because a stand-in tileset takes the missing file's key.
    this.missing = this.requested.filter((key) => !this.textures.exists(key));

    this.makePlaceholders();
    this.sliceStrips();
    this.sliceHudIcons();
    createAnimations(this);
    this.reportArt();

    this.scene.start('TitleScene');
  }

  makePlaceholders() {
    const T = TEXTURES;
    this.makePlaceholder(T.PLAYER, 32, 32, 0x4cd137, 0x2f8f22);
    this.makePlaceholder(T.PLAYER_BIG, 32, 48, 0x4cd137, 0x2f8f22);
    this.makePlaceholder(T.WATER_DROP, 16, 16, 0x4cc9f0, 0x2a7fb8, { shape: 'circle' });
    this.makePlaceholder(T.LIGHT_ORB, 24, 24, 0xffd60a, 0xc79a00, { shape: 'circle' });
    this.makePlaceholder(T.NUTRIENT, 24, 24, 0x9d4edd, 0x6a2ba8, { shape: 'circle' });
    this.makePlaceholder(T.GOAL_JAR, 32, 64, 0xa8dadc, 0x457b9d, { lidColor: 0x6d4c41 });
    this.makePlaceholder(T.SPIDER_MITE, 32, 24, 0xd62828, 0x8d1a1a);
    this.makePlaceholder(T.FUNGUS_GNAT, 24, 24, 0x9aa0a6, 0x5f6368, { shape: 'circle' });
    this.makePlaceholder(T.ROOT_ROT, 32, 32, 0x31572c, 0x1b3318, { shape: 'circle' });
    this.makePlaceholder(T.ROOT_ROT_MINI, 20, 20, 0x31572c, 0x1b3318, { shape: 'circle' });

    for (const [key, def] of Object.entries(TILESETS)) {
      if (def.layout === 'edges3x3' && !this.textures.exists(key)) {
        this.makeEdgeTilesetPlaceholder(key);
      }
    }
  }

  /**
   * Stand-in for a missing 3x3 edge tileset, in the same layout as the real one: plain soil tiles with a
   * green strip on whichever sides face outward, so autotiled corners and edges still read correctly.
   */
  makeEdgeTilesetPlaceholder(key) {
    const size = TILE_SIZE;
    const strip = 5;
    const g = this.make.graphics({ add: false });

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = col * size;
        const y = row * size;
        g.fillStyle(0x4a2c18, 1);
        g.fillRect(x, y, size, size);
        g.fillStyle(0x6b4226, 1);
        g.fillRect(x + 1, y + 1, size - 2, size - 2);

        g.fillStyle(0x4c9a2a, 1);
        if (row === 0) g.fillRect(x, y, size, strip);
        if (row === 2) g.fillRect(x, y + size - strip, size, strip);
        if (col === 0) g.fillRect(x, y, strip, size);
        if (col === 2) g.fillRect(x + size - strip, y, strip, size);
      }
    }
    g.generateTexture(key, size * 3, size * 3);
    g.destroy();
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

  /**
   * Cuts the HUD icon sheet into one frame per icon, numbered from the left. The icons are found by looking
   * for the empty columns between them, and each frame is the tight box around its icon, so icons of
   * different sizes, or ones that stray over an even grid line, still come out whole and unmixed.
   * If that does not find the expected number of icons, it falls back to equal cells.
   */
  sliceHudIcons() {
    const { key, COUNT } = UI.HUD_ICONS;
    if (!this.textures.exists(key)) return;

    const texture = this.textures.get(key);
    const image = texture.getSourceImage();
    const { width, height } = image;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const inked = (x, y) => pixels[(y * width + x) * 4 + 3] > 8;

    // Runs of columns that contain anything at all.
    const runs = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      let columnInked = false;
      for (let y = 0; x < width && y < height && !columnInked; y++) columnInked = inked(x, y);
      if (columnInked && start < 0) start = x;
      if (!columnInked && start >= 0) {
        runs.push([start, x - 1]);
        start = -1;
      }
    }

    if (runs.length === COUNT) {
      runs.forEach(([left, right], index) => {
        let top = height;
        let bottom = -1;
        for (let y = 0; y < height; y++) {
          for (let x = left; x <= right; x++) {
            if (inked(x, y)) {
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
              break;
            }
          }
        }
        texture.add(index, 0, left, top, right - left + 1, bottom - top + 1);
      });
    } else {
      console.warn(`[boot] ${key}.png: expected ${COUNT} separate icons but found ${runs.length}; cutting it into ${COUNT} equal cells instead`);
      const cell = Math.floor(width / COUNT);
      for (let index = 0; index < COUNT; index++) texture.add(index, 0, index * cell, 0, cell, height);
    }

    // The icons are smooth, anti-aliased art shown smaller than they are drawn. The game's hard-pixel
    // filtering would make that jagged, so this one texture is filtered smoothly.
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  reportArt() {
    const sheets = Object.entries(ANIMATIONS);
    const pending = sheets.filter(([, def]) => def.pending).map(([key]) => key);
    const loaded = sheets.filter(([key]) => this.textures.exists(key)).length;
    console.info(`[boot] art: ${loaded} of ${sheets.length} animation sheets loaded, ${pending.length} marked pending`);
    if (this.missing.length > 0) {
      console.warn(`[boot] missing art, placeholders will be used instead: ${this.missing.join(', ')}`);
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
