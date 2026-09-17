import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, UI } from '../config/constants.js';

const TEXT_STYLE = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 4,
};

// Where each readout sits. x is the left edge of its icon (or of its text when there are no icons).
const RIGHT_COLUMN = GAME_WIDTH - 150;
const LAYOUT = {
  world: { x: 16, y: 10, frame: UI.HUD_ICONS.FRAME.WORLD, label: 'World' },
  drops: { x: 16, y: 46, frame: UI.HUD_ICONS.FRAME.DROPS, label: 'Drops' },
  time: { x: GAME_WIDTH / 2 - 48, y: 10, frame: UI.HUD_ICONS.FRAME.TIME, label: 'Time' },
  score: { x: RIGHT_COLUMN, y: 10, frame: UI.HUD_ICONS.FRAME.SCORE, label: 'Score' },
  lives: { x: RIGHT_COLUMN, y: 46, frame: UI.HUD_ICONS.FRAME.LIVES, label: 'Lives' },
};

/**
 * Heads-up display. Runs in parallel with GameScene, so the level scrolls underneath it while it stays
 * put; every element is also pinned with setScrollFactor(0). Values come from the game registry
 * (score, drops, lives, time, world); short announcements arrive as "hud:message".
 *
 * Each readout is an icon from hud-icons.png with its number beside it. If that image did not load,
 * the readouts fall back to text labels ("Score 000120").
 */
export default class HUDScene extends Phaser.Scene {
  constructor() {
    super('HUDScene');
  }

  create() {
    this.scene.bringToTop();
    this.useIcons = this.textures.exists(UI.HUD_ICONS.key);

    this.worldText = this.addReadout(LAYOUT.world);
    this.dropsText = this.addReadout(LAYOUT.drops);
    this.timeText = this.addReadout(LAYOUT.time);
    this.scoreText = this.addReadout(LAYOUT.score);
    this.livesText = this.addReadout(LAYOUT.lives);

    this.messageText = this.add
      .text(GAME_WIDTH / 2, 110, '', { ...TEXT_STYLE, fontSize: '28px', strokeThickness: 5 })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setAlpha(0);
    this.add
      .text(16, GAME_HEIGHT - 12, 'Move: Arrows / A D    Jump: Space / Up / W    Slash: X / J', { ...TEXT_STYLE, fontSize: '12px', strokeThickness: 3 })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setAlpha(0.6);

    this.refresh();

    // A key's first write emits "setdata"; later writes emit "changedata".
    this.registry.events.on('setdata', this.refresh, this);
    this.registry.events.on('changedata', this.refresh, this);
    this.game.events.on('hud:message', this.showMessage, this);

    this.events.once('shutdown', () => {
      this.registry.events.off('setdata', this.refresh, this);
      this.registry.events.off('changedata', this.refresh, this);
      this.game.events.off('hud:message', this.showMessage, this);
    });
  }

  /** One icon with its value beside it. Returns the text object that shows the value. */
  addReadout({ x, y, frame, label }) {
    const icons = UI.HUD_ICONS;
    const size = icons.frameSize * icons.scale;
    let textX = x;

    if (this.useIcons) {
      this.add.image(x, y, icons.key, frame).setOrigin(0, 0).setScale(icons.scale).setScrollFactor(0);
      textX = x + size + 8;
    }
    const text = this.add.text(textX, y + size / 2, '', TEXT_STYLE).setOrigin(0, 0.5).setScrollFactor(0);
    text.label = this.useIcons ? '' : `${label} `; // without an icon the value needs a word in front of it
    return text;
  }

  refresh() {
    const get = (key, fallback) => this.registry.get(key) ?? fallback;
    const seconds = get('time', 0);
    const show = (text, value) => text.setText(text.label + value);

    show(this.worldText, this.useIcons ? get('worldLabel', '') : get('world', '').replace(/^World /, ''));
    show(this.dropsText, `x${String(get('drops', 0)).padStart(2, '0')}`);
    show(this.timeText, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    show(this.scoreText, String(get('score', 0)).padStart(6, '0'));
    show(this.livesText, `x${get('lives', 0)}`);
  }

  showMessage(text, holdMs = 1400) {
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setText(text).setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: holdMs, duration: 400 });
  }
}
