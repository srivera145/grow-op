import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TOUCH } from '../config/constants.js';
import { rotateGuardWanted } from '../input/TouchSource.js';

// Scenes that are held still while the overlay is up.
const GUARDED = ['TitleScene', 'GameScene', 'HUDScene', 'TouchScene', 'LevelCompleteScene'];
const FONT = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 6 };

/** Starts the portrait guard if this device wants one. Safe to call from any scene, any number of times. */
export function ensureRotateGuard(scene) {
  if (rotateGuardWanted()) {
    scene.scene.run('RotateScene');
  }
}

/**
 * "Rotate your device". While the window is taller than it is wide, this scene covers everything and
 * pauses whatever is running underneath; when the device is turned back it hides and resumes them.
 * It is a scene of its own, kept on top, because an overlay drawn inside GameScene would sit underneath
 * the HUD and the touch buttons, which are separate scenes above it.
 */
export default class RotateScene extends Phaser.Scene {
  constructor() {
    super('RotateScene');
  }

  create() {
    this.showing = false;
    this.pausedByMe = [];

    const centreX = GAME_WIDTH / 2;
    const backdrop = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, TOUCH.ROTATE.backdropAlpha).setOrigin(0, 0);
    const phone = this.add.graphics();
    phone.lineStyle(8, 0xffffff, 1);
    phone.strokeRoundedRect(-36, -64, 72, 128, 12);
    phone.fillStyle(0xffffff, 1);
    phone.fillCircle(0, 50, 5);
    phone.setPosition(centreX, 190);
    this.tweens.add({ targets: phone, angle: -90, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1, hold: 500, repeatDelay: 500 });

    // The canvas is tiny in portrait, so the text is large.
    const title = this.add.text(centreX, 340, TOUCH.ROTATE.title, { ...FONT, fontSize: '64px' }).setOrigin(0.5);
    const subtitle = this.add.text(centreX, 420, TOUCH.ROTATE.subtitle, { ...FONT, fontSize: '34px', color: '#d8f3dc' }).setOrigin(0.5);
    this.overlay = this.add.container(0, 0, [backdrop, phone, title, subtitle]).setScrollFactor(0).setVisible(false);

    this.onWindowChange = () => this.sync();
    window.addEventListener('resize', this.onWindowChange);
    window.addEventListener('orientationchange', this.onWindowChange);
    this.events.once('shutdown', () => {
      window.removeEventListener('resize', this.onWindowChange);
      window.removeEventListener('orientationchange', this.onWindowChange);
    });

    this.sync();
  }

  update() {
    // A scene can start while the overlay is already up (the game booting in portrait); catch it here.
    if (this.showing) this.holdScenes();
  }

  isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  sync() {
    const portrait = this.isPortrait();
    if (portrait === this.showing) return;
    this.showing = portrait;
    this.overlay.setVisible(portrait);

    if (portrait) {
      this.scene.bringToTop();
      this.holdScenes();
    } else {
      for (const key of this.pausedByMe) {
        if (this.scene.isPaused(key)) this.scene.resume(key);
      }
      this.pausedByMe = [];
    }
  }

  holdScenes() {
    for (const key of GUARDED) {
      if (this.scene.isActive(key)) {
        this.scene.pause(key);
        this.pausedByMe.push(key);
      }
    }
  }
}
