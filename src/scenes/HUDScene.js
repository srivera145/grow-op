import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TOUCH, UI } from '../config/constants.js';
import { touchControlsWanted } from '../input/TouchSource.js';
import { addMuteButton } from '../audio/muteButton.js';
import Save from '../state/Save.js';
import { percentOf } from '../state/levelScore.js';

const TEXT_STYLE = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 4,
};

// Where each readout sits. x is the left edge of its icon (or of its text when there are no icons).
const RIGHT_COLUMN = GAME_WIDTH - 150;
const NEW_BEST_COLOR = '#ffd60a';
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
    addMuteButton(this, GAME_WIDTH / 2, 62); // under the clock, clear of the readouts and the message line

    this.messageText = this.add
      .text(GAME_WIDTH / 2, 110, '', { ...TEXT_STYLE, fontSize: '28px', strokeThickness: 5 })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setAlpha(0);
    // Help line: key names in the bottom-left corner. When the touch controls are up it names the buttons
    // instead and moves to the bottom centre, clear of the two button clusters.
    this.helpText = this.add.text(0, 0, '', { ...TEXT_STYLE, fontSize: '12px', strokeThickness: 3 }).setScrollFactor(0).setAlpha(0.6);
    this.showHelp(touchControlsWanted());
    this.game.events.on('touch:controls', this.showTouchHelp, this);

    // "NEW BEST" flashes beside the score the moment this run passes the stored best for this level.
    // Nothing to beat until the level has been finished once, and then only one flash per run.
    const best = Save.getLevelBest(this.registry.get('levelKey'));
    this.bestScore = best.completions > 0 ? best.score : null;
    this.newBestFlashed = false;
    this.newBestText = this.add
      .text(RIGHT_COLUMN - 8, 26, 'NEW BEST', { ...TEXT_STYLE, fontSize: '14px', color: NEW_BEST_COLOR, strokeThickness: 3 })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setAlpha(0);

    // How much of this level has been harvested so far. Grades are a percentage of the level's maximum,
    // so this is the number the grade is about to be read off. Hidden when that maximum is unknown.
    this.harvestText = this.add
      .text(16, 86, '', { ...TEXT_STYLE, fontSize: '14px', strokeThickness: 3 })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setAlpha(0.7);

    this.refresh();

    // A key's first write emits "setdata"; later writes emit "changedata".
    this.registry.events.on('setdata', this.refresh, this);
    this.registry.events.on('changedata', this.refresh, this);
    this.game.events.on('hud:message', this.showMessage, this);

    this.events.once('shutdown', () => {
      this.registry.events.off('setdata', this.refresh, this);
      this.registry.events.off('changedata', this.refresh, this);
      this.game.events.off('hud:message', this.showMessage, this);
      this.game.events.off('touch:controls', this.showTouchHelp, this);
    });
  }

  showTouchHelp() {
    this.showHelp(true);
  }

  showHelp(touch) {
    if (touch) {
      this.helpText.setText(TOUCH.HELP.text).setOrigin(0.5, 1).setPosition(TOUCH.HELP.x, TOUCH.HELP.y);
    } else {
      this.helpText.setText('Move: Arrows / A D    Jump: Space / Up / W    Slash: X / J    Mute: M').setOrigin(0, 1).setPosition(16, GAME_HEIGHT - 12);
    }
  }

  /** One icon with its value beside it. Returns the text object that shows the value. */
  addReadout({ x, y, frame, label }) {
    const icons = UI.HUD_ICONS;
    const size = icons.SLOT;
    let textX = x;

    if (this.useIcons) {
      // Each icon has its own size: fit it inside the slot, keeping its proportions, centred.
      const icon = this.add.image(x + size / 2, y + size / 2, icons.key, frame).setScrollFactor(0);
      icon.setScale(Math.min(size / icon.width, size / icon.height));
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
    // The readout above shows the run total; the flash compares what THIS level has earned, because
    // that is what the stored best holds. A score carried in from an earlier level must not trip it.
    this.flashNewBest(get('levelScore', 0));

    const maxScore = get('levelMaxScore', 0);
    this.harvestText.setText(maxScore > 0 ? `Harvest ${percentOf(get('levelScore', 0), maxScore)}%` : '');
  }

  /** Fires once per level run, the first time this level's own earnings pass its stored best. */
  flashNewBest(score) {
    if (this.newBestFlashed || this.bestScore === null || score <= this.bestScore) return;
    this.newBestFlashed = true;
    this.newBestText.setAlpha(1);
    this.tweens.add({
      targets: this.newBestText,
      alpha: 0.1,
      duration: 200,
      yoyo: true,
      repeat: 5,
      onComplete: () => this.newBestText.setAlpha(0),
    });
  }

  showMessage(text, holdMs = 1400) {
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setText(text).setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: holdMs, duration: 400 });
  }
}
