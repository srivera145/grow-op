import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import TitleScene from './scenes/TitleScene.js';
import GameScene from './scenes/GameScene.js';
import HUDScene from './scenes/HUDScene.js';
import LevelCompleteScene from './scenes/LevelCompleteScene.js';
import TouchScene from './scenes/TouchScene.js';
import RotateScene from './scenes/RotateScene.js';
import { GAME_WIDTH, GAME_HEIGHT, GRAVITY_Y } from './config/constants.js';
import { LEVELS, loadLevels } from './config/levels.js';

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

/**
 * The level list is data, so it has to be in hand before anything asks for a level: BootScene preloads
 * every entry the moment the game is created. A game with no levels in it is not worth starting, so a
 * failure here says so on the page instead of leaving a black canvas and a console message.
 */
try {
  await loadLevels();
} catch (error) {
  document.getElementById('game').innerHTML =
    `<div style="font:14px/1.6 ui-monospace,monospace;color:#e8443a;padding:24px">
       <strong>Grow Op could not start.</strong><br />${error.message}
     </div>`;
  throw error;
}

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
if (import.meta.env?.DEV) {
  window.__growop = game;
}

/**
 * Dev-only: ?level=<key> starts that level instead of FIRST_LEVEL. This is what the level editor's Play
 * button opens. A key that is not in LEVELS yet - a level being written right now - gets an entry made
 * for it on the spot, pointing at the file the editor saves to, so a new level is playable before anyone
 * has registered it. import.meta.env.DEV is a literal false in a build, so the whole block is dropped.
 */
if (import.meta.env?.DEV) {
  const wanted = new URLSearchParams(window.location.search).get('level');
  if (wanted && /^[a-z0-9-]+$/.test(wanted)) {
    LEVELS[wanted] ??= { key: wanted, name: wanted, label: wanted, file: `levels/${wanted}.json`, tileset: 'tiles-soil', next: wanted };
    game.registry.set('startLevel', wanted);
  }
}
