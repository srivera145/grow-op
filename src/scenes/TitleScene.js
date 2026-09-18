import Phaser from 'phaser';
import { FIRST_LEVEL, GAME_HEIGHT, GAME_WIDTH, GRADES, TOUCH, UI } from '../config/constants.js';
import { isHandheld, touchControlsWanted } from '../input/TouchSource.js';
import { ensureRotateGuard } from './RotateScene.js';
import Sfx from '../audio/Sfx.js';
import { addMuteButton } from '../audio/muteButton.js';
import Save from '../state/Save.js';

const FONT = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };
const PROMPT_Y = 430;
const BEST_Y = 458; // between the start prompt and the reset option
const TOTALS_Y = 478; // under the best line, quiet enough not to compete with it
const RESET_Y = 500; // far enough above the footer line to read as its own thing

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

    const promptText = touchControlsWanted() ? TOUCH.START_PROMPT : 'Press Space or Enter to start';
    const prompt = this.add.text(centreX, PROMPT_Y, promptText, { ...FONT, fontSize: '20px' }).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.25, duration: 650, yoyo: true, repeat: -1 });

    this.add.text(centreX, GAME_HEIGHT - 24, 'EchoDial LLC', { ...FONT, fontSize: '12px' }).setOrigin(0.5).setAlpha(0.6);
    addMuteButton(this, GAME_WIDTH - 32, 32);
    this.confirming = false;
    this.confirmLayer = null;
    this.buildSaveUi();

    // The first tap or key press anywhere here is what lets the browser play audio at all; the title music
    // starts at that moment. Escape is the one key browsers do not count as a gesture.
    Sfx.playMusic('title');
    this.input.keyboard.on('keydown', (event) => event.key !== 'Escape' && Sfx.unlock());
    // event.repeat filters out a key that is still held down from the previous scene.
    this.input.keyboard.on('keydown-SPACE', (event) => !event.repeat && this.startGame());
    this.input.keyboard.on('keydown-ENTER', (event) => !event.repeat && this.startGame());
    this.input.on('pointerup', () => {
      Sfx.unlock();
      if (this.confirming) return; // the confirmation owns the screen; a tap on it must not start the game
      this.enterFullscreenOnHandheld();
      this.startGame();
    });
    // Only live while the confirmation is open. Space and Enter are deliberately not among them, so the
    // key that starts the game can never erase a save by being held down from the previous screen.
    this.input.keyboard.on('keydown-Y', () => this.confirming && this.eraseRecords());
    this.input.keyboard.on('keydown-N', () => this.confirming && this.closeResetConfirm());
    this.input.keyboard.on('keydown-ESC', () => this.confirming && this.closeResetConfirm());
    this.input.keyboard.on('keydown-DELETE', (event) => !event.repeat && !this.confirming && this.openResetConfirm());

    ensureRotateGuard(this);
  }

  /**
   * Phones and tablets go fullscreen on the first tap, which hides the browser's bars. It has to happen
   * inside the tap itself, because browsers only allow fullscreen from a user gesture. Desktop never asks,
   * and neither does a browser without the API (Safari on iPhone), where this quietly does nothing.
   */
  enterFullscreenOnHandheld() {
    if (isHandheld() && this.scale.fullscreen.available && !this.scale.isFullscreen) {
      this.scale.startFullscreen();
    }
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

  /**
   * The saved best and the way to clear it. Both are absent until there is something to show: the best
   * line until a level has been completed, the reset option until anything at all has been stored.
   * Rebuilt in place after a reset rather than restarting the scene, which would replay the logo intro.
   */
  buildSaveUi() {
    const centreX = GAME_WIDTH / 2;
    this.saveUi?.destroy(); // a container destroys its children with it
    this.saveUi = this.add.container(0, 0);

    const best = Save.best();
    if (best) {
      // The grade is stored by name; its colour is looked up here, so recolouring a grade takes effect at once.
      const colour = GRADES.find((grade) => grade.name === best.grade)?.color ?? '#ffffff';
      const score = String(best.score).padStart(6, '0');
      const line = best.grade ? `BEST  ${best.grade}  ${score}` : `BEST  ${score}`;
      this.saveUi.add(this.add.text(centreX, BEST_Y, line, { ...FONT, fontSize: '18px', color: colour }).setOrigin(0.5));
    }

    if (Save.hasData()) {
      // Lifetime counters, deliberately quiet. Completions counts finishes, not distinct levels, so
      // finishing 1-1 four times reads 4.
      const { plays, completions } = Save.getTotals();
      const totals = `Plays ${plays}    Completed ${completions}`;
      this.saveUi.add(this.add.text(centreX, TOTALS_Y, totals, { ...FONT, fontSize: '11px', strokeThickness: 3 }).setOrigin(0.5).setAlpha(0.45));

      const label = touchControlsWanted() ? 'Erase records' : 'Erase records (Del)';
      const reset = this.add
        .text(centreX, RESET_Y, label, { ...FONT, fontSize: '13px', color: '#d8f3dc', padding: { x: 12, y: 8 } })
        .setOrigin(0.5)
        .setAlpha(0.65)
        .setInteractive({ useHandCursor: true });
      reset.on('pointerover', () => reset.setAlpha(1));
      reset.on('pointerout', () => reset.setAlpha(0.65));
      reset.on('pointerup', (pointer, x, y, event) => {
        event.stopPropagation(); // this tap must not also be read as "tap anywhere to start"
        this.openResetConfirm();
      });
      this.saveUi.add(reset);
    }
  }

  /** Nothing is erased without this. Its own layer, over everything, and it swallows every tap it receives. */
  openResetConfirm() {
    if (this.starting || this.confirming || !Save.hasData()) return;
    this.confirming = true;
    Sfx.unlock();
    Sfx.play('menu-select');

    const centreX = GAME_WIDTH / 2;
    const layer = this.add.container(0, 0).setDepth(100);
    const backdrop = this.add.rectangle(centreX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82).setInteractive();
    backdrop.on('pointerup', (pointer, x, y, event) => event.stopPropagation());

    layer.add(backdrop);
    layer.add(this.add.text(centreX, 206, 'Erase saved records?', { ...FONT, fontSize: '28px' }).setOrigin(0.5));
    layer.add(
      this.add
        .text(centreX, 248, 'Best scores, grades and times go with it. This cannot be undone.', { ...FONT, fontSize: '14px', color: '#d8f3dc' })
        .setOrigin(0.5)
    );
    // Cancel sits where the grade screen puts Replay: left is the button that leaves things alone.
    layer.add(this.addConfirmButton(centreX - 100, 318, 'Cancel', '#2f8f22', '#4cd137', () => this.closeResetConfirm()));
    layer.add(this.addConfirmButton(centreX + 100, 318, 'Erase', '#8f2222', '#d13737', () => this.eraseRecords()));
    layer.add(this.add.text(centreX, 376, 'Y to erase    N or Esc to cancel', { ...FONT, fontSize: '12px' }).setOrigin(0.5).setAlpha(0.6));
    this.confirmLayer = layer;
  }

  addConfirmButton(x, y, label, colour, hoverColour, onClick) {
    const button = this.add
      .text(x, y, label, { ...FONT, fontSize: '22px', backgroundColor: colour, padding: { x: 24, y: 10 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setBackgroundColor(hoverColour));
    button.on('pointerout', () => button.setBackgroundColor(colour));
    button.on('pointerup', (pointer, localX, localY, event) => {
      event.stopPropagation(); // the scene's "tap anywhere to start" must not see this tap
      onClick();
    });
    return button;
  }

  closeResetConfirm() {
    this.confirmLayer?.destroy();
    this.confirmLayer = null;
    this.confirming = false;
  }

  eraseRecords() {
    Save.reset();
    Sfx.play('menu-select');
    this.closeResetConfirm();
    this.buildSaveUi(); // back to the screen as it looked before anything was ever recorded
  }

  startGame() {
    if (this.starting || this.confirming) return;
    this.starting = true;
    Sfx.stopMusic(); // the level's own track takes over once it is built
    Sfx.unlock(); // the start press may itself be the first gesture
    Sfx.play('menu-select');
    // startLevel is only ever set by main.js in dev, from ?level=; everywhere else this is FIRST_LEVEL.
    this.scene.start('GameScene', { level: this.registry.get('startLevel') ?? FIRST_LEVEL, reset: true });
  }
}
