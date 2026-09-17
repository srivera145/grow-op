import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants.js';

const TEXT_STYLE = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 3,
};

/**
 * Heads-up display. Runs in parallel with GameScene and has its own camera, which never
 * scrolls, so the HUD stays fixed while the level moves underneath it. Values come from the
 * game registry (score, drops, lives, world); short announcements arrive as "hud:message".
 */
export default class HUDScene extends Phaser.Scene {
  constructor() {
    super('HUDScene');
  }

  create() {
    this.scene.bringToTop();

    this.worldText = this.add.text(16, 12, '', TEXT_STYLE);
    this.dropsText = this.add.text(16, 34, '', TEXT_STYLE);
    this.scoreText = this.add.text(GAME_WIDTH - 16, 12, '', TEXT_STYLE).setOrigin(1, 0);
    this.livesText = this.add.text(GAME_WIDTH - 16, 34, '', TEXT_STYLE).setOrigin(1, 0);
    this.messageText = this.add
      .text(GAME_WIDTH / 2, 110, '', { ...TEXT_STYLE, fontSize: '28px', strokeThickness: 5 })
      .setOrigin(0.5)
      .setAlpha(0);
    this.add
      .text(16, GAME_HEIGHT - 12, 'Move: Arrows / A D    Jump: Space / Up / W', { ...TEXT_STYLE, fontSize: '12px' })
      .setOrigin(0, 1)
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

  refresh() {
    const get = (key, fallback) => this.registry.get(key) ?? fallback;
    this.worldText.setText(String(get('world', '')));
    this.scoreText.setText(`Score ${String(get('score', 0)).padStart(6, '0')}`);
    this.dropsText.setText(`Drops x${String(get('drops', 0)).padStart(2, '0')}`);
    this.livesText.setText(`Lives x${get('lives', 0)}`);
  }

  showMessage(text, holdMs = 1400) {
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setText(text).setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: holdMs, duration: 400 });
  }
}
