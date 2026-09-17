import Phaser from 'phaser';
import Sfx from './Sfx.js';

const TEXTURE_ON = 'ui-speaker-on';
const TEXTURE_OFF = 'ui-speaker-off';
const SIZE = 32;
const HIT_SIZE = 56; // a comfortable finger target around the icon

/**
 * A speaker icon that shows the mute state and flips it when tapped or clicked. Every screen adds its own
 * (title, HUD, grade screen) and they all follow the "audio:muted" game event, so they never disagree. The
 * M key does the same thing from anywhere; see Sfx.
 *
 * Tapping it is swallowed so the tap does not also fall through to whatever the screen does on a tap.
 */
export function addMuteButton(scene, x, y) {
  ensureTextures(scene);

  const icon = scene.add
    .image(x, y, textureFor(Sfx.isMuted()))
    .setScrollFactor(0)
    .setAlpha(0.85)
    .setInteractive({
      hitArea: new Phaser.Geom.Rectangle((SIZE - HIT_SIZE) / 2, (SIZE - HIT_SIZE) / 2, HIT_SIZE, HIT_SIZE),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });

  icon.on('pointerdown', (pointer, localX, localY, event) => event.stopPropagation());
  icon.on('pointerup', (pointer, localX, localY, event) => {
    event.stopPropagation();
    Sfx.toggleMute();
  });

  const sync = (muted) => icon.setTexture(textureFor(muted));
  scene.game.events.on('audio:muted', sync);
  scene.events.once('shutdown', () => scene.game.events.off('audio:muted', sync));
  return icon;
}

function textureFor(muted) {
  return muted ? TEXTURE_OFF : TEXTURE_ON;
}

/** Draws the two icons once: a speaker with sound waves, and the same speaker crossed out. */
function ensureTextures(scene) {
  if (scene.textures.exists(TEXTURE_ON)) return;

  for (const [key, muted] of [[TEXTURE_ON, false], [TEXTURE_OFF, true]]) {
    const g = scene.make.graphics({ add: false });
    const draw = (color, inset) => {
      g.fillStyle(color, 1);
      g.fillRect(3 + inset, 12 + inset, 7 - inset * 2, 8 - inset * 2); // speaker body
      g.fillTriangle(9 + inset, 16, 17 - inset, 5 + inset * 2, 17 - inset, 27 - inset * 2); // cone
    };
    draw(0x000000, 0); // dark outline, then the white shape inset by one pixel
    draw(0xffffff, 1);

    g.lineStyle(3, 0x000000, 1);
    if (muted) {
      g.lineBetween(20, 10, 30, 22);
      g.lineBetween(30, 10, 20, 22);
      g.lineStyle(1.5, 0xffffff, 1);
      g.lineBetween(20, 10, 30, 22);
      g.lineBetween(30, 10, 20, 22);
    } else {
      for (const [radius, width] of [[6, 3], [11, 3]]) {
        g.lineStyle(width, 0x000000, 1);
        g.beginPath();
        g.arc(17, 16, radius, Phaser.Math.DegToRad(-50), Phaser.Math.DegToRad(50));
        g.strokePath();
      }
      for (const radius of [6, 11]) {
        g.lineStyle(1.5, 0xffffff, 1);
        g.beginPath();
        g.arc(17, 16, radius, Phaser.Math.DegToRad(-50), Phaser.Math.DegToRad(50));
        g.strokePath();
      }
    }
    g.generateTexture(key, SIZE, SIZE);
    g.destroy();
  }
}
