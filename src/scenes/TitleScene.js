import Phaser from 'phaser';
import { FIRST_LEVEL, GAME_HEIGHT, GAME_WIDTH } from '../config/constants.js';

const FONT = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };

/** Placeholder title screen. The game boots here and comes back here after a game over. */
export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const centreX = GAME_WIDTH / 2;
    this.starting = false;
    this.cameras.main.setBackgroundColor('#101a13');

    this.add.text(centreX, 190, 'GROW OP', { ...FONT, fontSize: '72px', color: '#4cd137', strokeThickness: 8 }).setOrigin(0.5);
    this.add.text(centreX, 258, 'Germination to Cure', { ...FONT, fontSize: '18px', color: '#d8f3dc' }).setOrigin(0.5);

    const prompt = this.add.text(centreX, 360, 'Press Space or Enter to start', { ...FONT, fontSize: '20px' }).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.25, duration: 650, yoyo: true, repeat: -1 });

    this.add.text(centreX, GAME_HEIGHT - 24, 'EchoDial LLC', { ...FONT, fontSize: '12px' }).setOrigin(0.5).setAlpha(0.6);

    // event.repeat filters out a key that is still held down from the previous scene.
    this.input.keyboard.on('keydown-SPACE', (event) => !event.repeat && this.startGame());
    this.input.keyboard.on('keydown-ENTER', (event) => !event.repeat && this.startGame());
    this.input.on('pointerup', () => this.startGame());
  }

  startGame() {
    if (this.starting) return;
    this.starting = true;
    this.scene.start('GameScene', { level: FIRST_LEVEL, reset: true });
  }
}
