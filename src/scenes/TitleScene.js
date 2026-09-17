import Phaser from 'phaser';
import { FIRST_LEVEL, GAME_HEIGHT, GAME_WIDTH, UI } from '../config/constants.js';

const FONT = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };
const PROMPT_Y = 430;

/** Title screen. The game boots here and comes back here after a game over. */
export default class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    const centreX = GAME_WIDTH / 2;
    this.starting = false;
    this.cameras.main.setBackgroundColor('#101a13');

    if (this.textures.exists(UI.LOGO.key)) {
      // Centred in the space above the prompt, shrunk if needed to stay within its share of the width.
      // Never enlarged: scaling pixel art up by a fraction smears it.
      this.logo = this.add.image(centreX, PROMPT_Y / 2, UI.LOGO.key);
      this.logo.setScale(Math.min(1, (GAME_WIDTH * UI.LOGO.maxWidthFraction) / this.logo.width, (PROMPT_Y - 60) / this.logo.height));
      this.animateLogo();
    } else {
      // No logo image: the text title stands in for it.
      this.add.text(centreX, 190, 'GROW OP', { ...FONT, fontSize: '72px', color: '#4cd137', strokeThickness: 8 }).setOrigin(0.5);
      this.add.text(centreX, 258, 'Germination to Cure', { ...FONT, fontSize: '18px', color: '#d8f3dc' }).setOrigin(0.5);
    }

    const prompt = this.add.text(centreX, PROMPT_Y, 'Press Space or Enter to start', { ...FONT, fontSize: '20px' }).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.25, duration: 650, yoyo: true, repeat: -1 });

    this.add.text(centreX, GAME_HEIGHT - 24, 'EchoDial LLC', { ...FONT, fontSize: '12px' }).setOrigin(0.5).setAlpha(0.6);

    // event.repeat filters out a key that is still held down from the previous scene.
    this.input.keyboard.on('keydown-SPACE', (event) => !event.repeat && this.startGame());
    this.input.keyboard.on('keydown-ENTER', (event) => !event.repeat && this.startGame());
    this.input.on('pointerup', () => this.startGame());
  }

  /** A quick pop-in, then a slow float. Only position, scale and alpha are tweened; rotation would shred pixel art. */
  animateLogo() {
    const { INTRO_MS, INTRO_START_SCALE, FLOAT_PIXELS, FLOAT_MS } = UI.LOGO;
    const logo = this.logo;
    const restScale = logo.scale;
    const restY = logo.y;

    logo.setAlpha(0).setScale(restScale * INTRO_START_SCALE);
    this.tweens.add({
      targets: logo,
      alpha: 1,
      scale: restScale,
      duration: INTRO_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({ targets: logo, y: restY - FLOAT_PIXELS, duration: FLOAT_MS, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      },
    });
  }

  startGame() {
    if (this.starting) return;
    this.starting = true;
    this.scene.start('GameScene', { level: FIRST_LEVEL, reset: true });
  }
}
