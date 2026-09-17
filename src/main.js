import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import TitleScene from './scenes/TitleScene.js';
import GameScene from './scenes/GameScene.js';
import HUDScene from './scenes/HUDScene.js';
import LevelCompleteScene from './scenes/LevelCompleteScene.js';
import TouchScene from './scenes/TouchScene.js';
import RotateScene from './scenes/RotateScene.js';
import { GAME_WIDTH, GAME_HEIGHT, GRAVITY_Y } from './config/constants.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1b2a1f',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: GRAVITY_Y },
      debug: false,
    },
  },
  input: {
    // Multi-touch: one finger steers while another jumps and a third slashes. Phaser's default of a single
    // pointer would drop every finger after the first. The mouse is always available on top of these.
    activePointers: 4,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    fullscreenTarget: 'game', // fullscreen the existing container, so FIT and centring carry on working
  },
  // TouchScene and RotateScene are registered for every device but only ever started on touch devices.
  scene: [BootScene, TitleScene, GameScene, HUDScene, LevelCompleteScene, TouchScene, RotateScene],
};

const game = new Phaser.Game(config);

// Workaround for Phaser 3.90 refitting the canvas one rotation late. When a phone is turned, Phaser's
// orientation listener refreshes at once, still working from the old container size; that same refresh then
// re-measures the container and stores the new size without acting on it, so the check that follows the
// resize event sees "no change" and never refits. The result is a cropped canvas in portrait and a tiny one
// after turning back. Measuring and refreshing again, once the browser has laid the page out, fixes both.
// Orientation events do not fire on desktop, so this never runs there.
function refitAfterRotation() {
  for (const delay of [50, 250, 600]) {
    setTimeout(() => {
      game.scale.getParentBounds();
      game.scale.refresh();
    }, delay);
  }
}
if (window.screen.orientation && window.screen.orientation.addEventListener) {
  window.screen.orientation.addEventListener('change', refitAfterRotation);
} else {
  window.addEventListener('orientationchange', refitAfterRotation);
}

// Dev-only handle for console debugging and automated smoke tests. Stripped from production builds.
if (import.meta.env.DEV) {
  window.__growop = game;
}
