import Phaser from 'phaser';
import { TOUCH } from '../config/constants.js';
import { touchSource } from '../input/TouchSource.js';

const LABEL_STYLE = { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#ffffff' };

/**
 * The on-screen buttons. Runs in parallel above HUDScene while a level is being played, and only on
 * devices with a touchscreen (GameScene decides). The buttons are sprites on the game canvas, pinned with
 * setScrollFactor(0), so they stay lined up however the canvas is letterboxed.
 *
 * Buttons are not individually interactive. Instead every active pointer is tested against every button's
 * hit area, on each pointer event and again every frame. That one rule covers everything touch needs:
 * several fingers at once, a thumb sliding from one arrow onto the other without lifting (it leaves the
 * first area, which releases it, and enters the second), and a finger that slides off the canvas or is
 * cancelled by the browser. The result goes to touchSource, where the player reads it.
 */
export default class TouchScene extends Phaser.Scene {
  constructor() {
    super('TouchScene');
  }

  create() {
    this.scene.bringToTop();
    this.makeTextures();

    this.buttons = Object.entries(TOUCH.BUTTONS).map(([name, def]) => {
      const sprite = this.add.sprite(def.x, def.y, `touch-${def.icon}`).setScrollFactor(0).setAlpha(TOUCH.ALPHA_REST);
      const label = def.label
        ? this.add.text(def.x, def.y + TOUCH.BUTTON_SIZE / 2 - 12, def.label, LABEL_STYLE).setOrigin(0.5).setScrollFactor(0).setAlpha(TOUCH.ALPHA_REST)
        : null;
      return { name, sprite, label, hit: new Phaser.Geom.Rectangle(def.hit.x, def.hit.y, def.hit.width, def.hit.height) };
    });

    // A finger already resting on a button when the controls appear (after a respawn, say) counts as held,
    // but not as a new press, just as a key held across a respawn does not jump again.
    this.refresh(true);

    const onPointer = () => this.refresh();
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'gameout']) {
      this.input.on(event, onPointer);
    }

    // Paused (the rotate overlay) or stopped (death, stage clear): let go of everything.
    this.events.on('pause', () => this.release());
    this.events.once('shutdown', () => {
      this.events.off('pause');
      this.release();
    });
  }

  update() {
    this.refresh();
  }

  /** Works out which buttons have a finger on them right now and reports it. */
  refresh(silent = false) {
    const pointers = this.input.manager.pointers;
    for (const button of this.buttons) {
      const down = pointers.some((pointer) => pointer.isDown && button.hit.contains(pointer.x, pointer.y));
      touchSource.setButton(button.name, down, silent);
      const alpha = down ? TOUCH.ALPHA_HELD : TOUCH.ALPHA_REST;
      button.sprite.setAlpha(alpha);
      if (button.label) button.label.setAlpha(alpha);
    }
  }

  release() {
    touchSource.reset();
  }

  /** Draws the four button faces once. There is no art for these, so they are generated. */
  makeTextures() {
    const size = TOUCH.BUTTON_SIZE;
    const icons = {
      left: (g) => g.fillTriangle(42, 16, 42, 48, 18, 32),
      right: (g) => g.fillTriangle(22, 16, 22, 48, 46, 32),
      jump: (g) => g.fillTriangle(32, 10, 50, 34, 14, 34), // leaves room for the label underneath
      slash: (g) => {
        g.lineStyle(6, 0xffffff, 1);
        g.beginPath();
        g.arc(14, 38, 30, Phaser.Math.DegToRad(-80), Phaser.Math.DegToRad(-5));
        g.strokePath();
      },
    };

    for (const [name, drawIcon] of Object.entries(icons)) {
      const key = `touch-${name}`;
      if (this.textures.exists(key)) continue;

      const g = this.make.graphics({ add: false });
      g.fillStyle(0x0b1410, 0.8);
      g.fillRoundedRect(1, 1, size - 2, size - 2, 12);
      g.lineStyle(3, 0xffffff, 0.95);
      g.strokeRoundedRect(2, 2, size - 4, size - 4, 12);
      g.fillStyle(0xffffff, 1);
      drawIcon(g);
      g.generateTexture(key, size, size);
      g.destroy();
    }
  }
}
