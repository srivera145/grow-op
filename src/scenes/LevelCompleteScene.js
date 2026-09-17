import Phaser from 'phaser';
import { FIRST_LEVEL, GAME_WIDTH, GRADES, LEVELS } from '../config/constants.js';

/** The harvest grade a final score earns. GRADES is ordered best first. */
export function gradeForScore(score) {
  return GRADES.find((grade) => score >= grade.minScore) ?? GRADES[GRADES.length - 1];
}

/** Formats milliseconds as m:ss.t */
export function formatTime(ms) {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

const FONT = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };
const INPUT_DELAY_MS = 400; // ignore keys still held from the level for a moment

/**
 * Harvest report shown after the goal jar: score, drops, time and the grade the score earns.
 * Replay starts the same level from scratch; Next carries score and lives into the next level.
 */
export default class LevelCompleteScene extends Phaser.Scene {
  constructor() {
    super('LevelCompleteScene');
  }

  init(data = {}) {
    this.result = {
      level: data.level ?? FIRST_LEVEL,
      score: data.score ?? 0,
      drops: data.drops ?? 0,
      timeMs: data.timeMs ?? 0,
    };
    this.leaving = false;
  }

  create() {
    const level = LEVELS[this.result.level] ?? LEVELS[FIRST_LEVEL];
    const centreX = GAME_WIDTH / 2;
    this.grade = gradeForScore(this.result.score);
    this.cameras.main.setBackgroundColor('#101a13');

    this.add.text(centreX, 64, 'HARVEST REPORT', { ...FONT, fontSize: '36px' }).setOrigin(0.5);
    this.add.text(centreX, 106, level.name, { ...FONT, fontSize: '18px', color: '#d8f3dc' }).setOrigin(0.5);

    this.scoreText = this.addRow(170, 'Score', String(this.result.score));
    this.dropsText = this.addRow(204, 'Drops', String(this.result.drops));
    this.timeText = this.addRow(238, 'Time', formatTime(this.result.timeMs));

    this.add.text(centreX, 292, 'GRADE', { ...FONT, fontSize: '16px', color: '#d8f3dc' }).setOrigin(0.5);
    this.gradeText = this.add
      .text(centreX, 344, this.grade.name, { ...FONT, fontSize: '56px', color: this.grade.color, strokeThickness: 6 })
      .setOrigin(0.5)
      .setScale(0.2);
    this.tweens.add({ targets: this.gradeText, scale: 1, duration: 350, ease: 'Back.easeOut' });

    this.replayButton = this.addButton(centreX - 110, 450, 'Replay', () => this.replay());
    this.nextButton = this.addButton(centreX + 110, 450, 'Next', () => this.next());
    this.add.text(centreX, 500, 'R to replay    N or Enter for next', { ...FONT, fontSize: '12px' }).setOrigin(0.5).setAlpha(0.6);

    this.time.delayedCall(INPUT_DELAY_MS, () => {
      this.input.keyboard.on('keydown-R', (event) => !event.repeat && this.replay());
      this.input.keyboard.on('keydown-N', (event) => !event.repeat && this.next());
      this.input.keyboard.on('keydown-ENTER', (event) => !event.repeat && this.next());
    });
  }

  addRow(y, label, value) {
    const centreX = GAME_WIDTH / 2;
    this.add.text(centreX - 150, y, label, { ...FONT, fontSize: '22px', color: '#d8f3dc' }).setOrigin(0, 0.5);
    return this.add.text(centreX + 150, y, value, { ...FONT, fontSize: '22px' }).setOrigin(1, 0.5);
  }

  addButton(x, y, label, onClick) {
    const button = this.add
      .text(x, y, label, { ...FONT, fontSize: '22px', backgroundColor: '#2f8f22', padding: { x: 22, y: 10 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setBackgroundColor('#4cd137'));
    button.on('pointerout', () => button.setBackgroundColor('#2f8f22'));
    button.on('pointerup', onClick);
    return button;
  }

  replay() {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start('GameScene', { level: this.result.level, reset: true });
  }

  next() {
    if (this.leaving) return;
    this.leaving = true;
    const level = LEVELS[this.result.level] ?? LEVELS[FIRST_LEVEL];
    this.scene.start('GameScene', { level: level.next ?? FIRST_LEVEL, reset: false });
  }
}
