import Phaser from 'phaser';
import { FIRST_LEVEL, GAME_WIDTH, GRADES, LEVELS } from '../config/constants.js';
import Sfx from '../audio/Sfx.js';
import Save from '../state/Save.js';
import { gradeFor, maxScoreForLevel, percentOf } from '../state/levelScore.js';
import { addMuteButton } from '../audio/muteButton.js';

/** Formats milliseconds as m:ss.t */
export function formatTime(ms) {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

const FONT = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };
const INPUT_DELAY_MS = 400; // ignore keys still held from the level for a moment
const RECORD_COLOR = '#ffd60a'; // a value on this run that beat the stored one
const PREVIOUS_COLOR = '#9bbf9b'; // the stored column, dimmer than this run's
const NO_VALUE = '--'; // stands in for a previous best that does not exist yet

// The three columns of the results table: row label, this level, the best before this run. Wider than
// the values strictly need, because the score row carries "1700 / 2910  58%" rather than a bare number.
const LABEL_X = GAME_WIDTH / 2 - 230;
const RUN_X = GAME_WIDTH / 2 + 80;
const PREVIOUS_X = GAME_WIDTH / 2 + 230;

/**
 * Harvest report shown after the goal jar: score, drops, time and the grade the score earns.
 * Replay starts the same level from scratch; Next carries score and lives into the next level.
 */
export default class LevelCompleteScene extends Phaser.Scene {
  constructor() {
    super('LevelCompleteScene');
  }

  init(data = {}) {
    // score is what this level earned: it is what gets graded and recorded. runTotal is the running
    // figure the HUD was showing, which carries into the next level; the two differ only after a Next.
    this.result = {
      level: data.level ?? FIRST_LEVEL,
      score: data.score ?? 0,
      runTotal: data.runTotal ?? data.score ?? 0,
      drops: data.drops ?? 0,
      timeMs: data.timeMs ?? 0,
    };
    this.leaving = false;
  }

  create() {
    const level = LEVELS[this.result.level] ?? LEVELS[FIRST_LEVEL];
    const centreX = GAME_WIDTH / 2;
    // Graded against this level's own maximum, so the same grade means the same thing on every level.
    this.maxScore = maxScoreForLevel(this.result.level);
    this.grade = gradeFor(this.result.score, this.maxScore);
    this.cameras.main.setBackgroundColor('#101a13');

    // Filed before anything is drawn. recordCompletion hands back the record table as it was on arrival,
    // which is what the right-hand column shows, so the new result never overwrites what it is compared to.
    const { previous, records, hadPrevious } = Save.recordCompletion(this.result.level, {
      score: this.result.score,
      grade: this.grade.name,
      timeMs: this.result.timeMs,
      drops: this.result.drops,
    });

    this.add.text(centreX, 52, 'HARVEST REPORT', { ...FONT, fontSize: '36px' }).setOrigin(0.5);
    this.add.text(centreX, 88, level.name, { ...FONT, fontSize: '18px', color: '#d8f3dc' }).setOrigin(0.5);

    this.add.text(RUN_X, 124, 'THIS LEVEL', { ...FONT, fontSize: '14px', color: '#d8f3dc' }).setOrigin(1, 0.5);
    this.add.text(PREVIOUS_X, 124, 'PREV BEST', { ...FONT, fontSize: '14px', color: PREVIOUS_COLOR }).setOrigin(1, 0.5);

    // A first completion beats nothing, so its records are shown plainly with an empty column beside them.
    this.addRow(154, 'Score', this.scoreLine(), String(previous.score), records.score && hadPrevious, hadPrevious);
    this.addRow(184, 'Drops', String(this.result.drops), String(previous.drops), records.drops && hadPrevious, hadPrevious);
    this.addRow(214, 'Time', formatTime(this.result.timeMs), formatTime(previous.timeMs), records.timeMs && hadPrevious, hadPrevious);
    this.addRunTotal(244);

    this.add.text(centreX, 276, 'GRADE', { ...FONT, fontSize: '16px', color: '#d8f3dc' }).setOrigin(0.5);
    this.gradeText = this.add
      .text(centreX, 320, this.grade.name, { ...FONT, fontSize: '56px', color: this.grade.color, strokeThickness: 6 })
      .setOrigin(0.5)
      .setScale(0.2);
    this.tweens.add({ targets: this.gradeText, scale: 1, duration: 350, ease: 'Back.easeOut' });
    this.addPreviousGrade(360, previous, hadPrevious);
    this.addRecordBanner(396, records, hadPrevious);

    this.replayButton = this.addButton(centreX - 110, 450, 'Replay', () => this.replay());
    this.nextButton = this.addButton(centreX + 110, 450, 'Next', () => this.next());
    addMuteButton(this, GAME_WIDTH - 32, 32);
    this.add.text(centreX, 500, 'R to replay    N or Enter for next', { ...FONT, fontSize: '12px' }).setOrigin(0.5).setAlpha(0.6);

    this.time.delayedCall(INPUT_DELAY_MS, () => {
      this.input.keyboard.on('keydown-R', (event) => !event.repeat && this.replay());
      this.input.keyboard.on('keydown-N', (event) => !event.repeat && this.next());
      this.input.keyboard.on('keydown-ENTER', (event) => !event.repeat && this.next());
    });
  }

  /**
   * The score as a share of everything this level had to offer, so a player can see what they missed.
   * Falls back to the bare score when the level's maximum is unknown, which is when grading does too.
   */
  scoreLine() {
    const { score } = this.result;
    if (this.maxScore <= 0) return String(score);
    return `${score} / ${this.maxScore}   ${percentOf(score, this.maxScore)}%`;
  }

  /** One results row: its label, this run's value, and the stored one. A beaten record turns gold. */
  addRow(y, label, value, previousValue, isRecord, hadPrevious) {
    const size = { ...FONT, fontSize: '20px' };
    this.add.text(LABEL_X, y, label, { ...size, color: '#d8f3dc' }).setOrigin(0, 0.5);
    this.add.text(RUN_X, y, value, { ...size, color: isRecord ? RECORD_COLOR : '#ffffff' }).setOrigin(1, 0.5);
    this.add.text(PREVIOUS_X, y, hadPrevious ? previousValue : NO_VALUE, { ...size, color: PREVIOUS_COLOR }).setOrigin(1, 0.5);
  }

  /**
   * The score carried on into the next level, below the table and outside it: it has no record to beat,
   * because records are per level. Only shown once it differs from this level's own score, which happens
   * the moment a Next carries something in, so a plain single-level run is unchanged.
   */
  addRunTotal(y) {
    if (this.result.runTotal === this.result.score) return;
    const style = { ...FONT, fontSize: '13px', color: PREVIOUS_COLOR };
    this.add.text(LABEL_X, y, 'Run total', style).setOrigin(0, 0.5).setAlpha(0.85);
    this.add.text(RUN_X, y, String(this.result.runTotal), style).setOrigin(1, 0.5).setAlpha(0.85);
  }

  /** The grade that was standing before this run, under the big one, in its own colour. */
  addPreviousGrade(y, previous, hadPrevious) {
    if (!hadPrevious) return;
    const stored = GRADES.find((grade) => grade.name === previous.grade);
    const text = `previous best  ${previous.grade ?? NO_VALUE}`;
    this.add.text(GAME_WIDTH / 2, y, text, { ...FONT, fontSize: '14px', color: stored?.color ?? PREVIOUS_COLOR }).setOrigin(0.5);
  }

  /** NEW BEST, flashing, whenever one of the three records fell. A first completion says so instead. */
  addRecordBanner(y, records, hadPrevious) {
    const centreX = GAME_WIDTH / 2;
    if (!hadPrevious) {
      this.add.text(centreX, y, 'FIRST HARVEST RECORDED', { ...FONT, fontSize: '14px', color: '#d8f3dc' }).setOrigin(0.5).setAlpha(0.8);
      return;
    }
    if (!records.score && !records.timeMs && !records.drops) return;

    const banner = this.add
      .text(centreX, y, 'NEW BEST', { ...FONT, fontSize: '26px', color: RECORD_COLOR, strokeThickness: 5 })
      .setOrigin(0.5);
    this.tweens.add({ targets: banner, alpha: 0.15, duration: 240, yoyo: true, repeat: 7 });
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
    Sfx.play('menu-select');
    this.scene.start('GameScene', { level: this.result.level, reset: true });
  }

  next() {
    if (this.leaving) return;
    this.leaving = true;
    Sfx.play('menu-select');
    const level = LEVELS[this.result.level] ?? LEVELS[FIRST_LEVEL];
    this.scene.start('GameScene', { level: level.next ?? FIRST_LEVEL, reset: false });
  }
}
