import Phaser from 'phaser';
import Player from '../objects/Player.js';
import Pickup, { PICKUP_KINDS } from '../objects/Pickup.js';
import { CAMERA, FIRST_LEVEL, LEVELS, PICKUPS, RULES, TEXTURES } from '../config/constants.js';

/** Centre of a Tiled object. Rectangles are anchored top-left; points have no size. */
function objectCentre(obj) {
  return { x: obj.x + (obj.width || 0) / 2, y: obj.y + (obj.height || 0) / 2 };
}

/**
 * Plays one level: loads its Tiled map, spawns everything named in the "objects" layer,
 * follows the player with the camera and applies the rules (score, drops, lives).
 * Progress lives in the game registry so the HUD scene can display it.
 */
export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data = {}) {
    this.level = LEVELS[data.level] ?? LEVELS[FIRST_LEVEL];
    this.state = 'playing'; // 'playing' | 'dead' | 'complete'

    if (data.reset !== false) {
      this.registry.set({ score: 0, drops: 0, lives: RULES.START_LIVES });
    }
    this.registry.set('world', this.level.name);
  }

  preload() {
    this.load.tilemapTiledJSON(this.level.key, this.level.file);
  }

  create() {
    // Ground
    this.map = this.make.tilemap({ key: this.level.key });
    const tileset = this.map.addTilesetImage(this.level.tileset, TEXTURES.TILE_SOIL);
    this.groundLayer = this.map.createLayer('ground', tileset, 0, 0);
    this.groundLayer.setCollisionByExclusion([-1]);

    // The world is the map, open at the bottom so gaps drop the player out of it.
    const { widthInPixels, heightInPixels } = this.map;
    this.physics.world.setBounds(0, 0, widthInPixels, heightInPixels, true, true, true, false);

    this.spawnObjects(this.map.getObjectLayer('objects'));

    this.physics.add.collider(this.player, this.groundLayer);
    this.physics.add.overlap(this.player, this.pickups, this.onPickup, undefined, this);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, widthInPixels, heightInPixels);
    camera.startFollow(this.player, true, CAMERA.LERP, CAMERA.LERP);
    camera.setDeadzone(CAMERA.DEADZONE_WIDTH, CAMERA.DEADZONE_HEIGHT);

    this.scene.run('HUDScene');
  }

  /** Creates game objects from the Tiled object layer, matching on each object's name. */
  spawnObjects(layer) {
    this.pickups = this.add.group();
    this.playerStart = { x: 64, y: 64 };

    for (const obj of layer?.objects ?? []) {
      const { x, y } = objectCentre(obj);
      if (obj.name === 'player-start') {
        this.playerStart = { x, y };
      } else if (obj.name in PICKUP_KINDS) {
        this.pickups.add(new Pickup(this, x, y, obj.name));
      } else {
        console.warn(`Level ${this.level.key}: no spawn rule for object "${obj.name}"`);
      }
    }

    // Created last so the player draws in front of the pickups.
    this.player = new Player(this, this.playerStart.x, this.playerStart.y);
  }

  update(time, delta) {
    this.player.update(time, delta);

    const fellOut = this.player.y > this.map.heightInPixels + RULES.FALL_DEATH_MARGIN;
    if (this.state === 'playing' && fellOut) {
      this.loseLife();
    }
  }

  // ---------- pickups ----------

  onPickup(player, pickup) {
    if (this.state !== 'playing' || pickup.collected) return;

    switch (pickup.kind) {
      case 'water-drop':
        this.registry.inc('score', PICKUPS.WATER_DROP_SCORE);
        this.addDrop();
        break;
      case 'light-orb':
        this.registry.inc('score', PICKUPS.LIGHT_ORB_SCORE);
        player.grow();
        this.announce('GROWTH SPURT!');
        break;
      case 'nutrient':
        this.registry.inc('score', PICKUPS.NUTRIENT_SCORE);
        player.makeInvincible();
        this.announce('NUTRIENT BOOST!');
        break;
      case 'goal-jar':
        this.completeLevel();
        return; // the jar stays in place
      default:
        return;
    }
    pickup.collect();
  }

  addDrop() {
    let drops = this.registry.get('drops') + 1;
    if (drops >= PICKUPS.DROPS_PER_LIFE) {
      drops -= PICKUPS.DROPS_PER_LIFE;
      this.registry.inc('lives', 1);
      this.announce('EXTRA LIFE!');
    }
    this.registry.set('drops', drops);
  }

  // ---------- damage, death and level flow ----------

  /** Entry point for enemies and hazards: big players shrink, small unprotected ones lose a life. */
  hitPlayer() {
    if (this.state === 'playing' && this.player.takeHit()) {
      this.loseLife();
    }
  }

  loseLife() {
    this.state = 'dead';
    this.player.controlsEnabled = false;
    this.registry.inc('lives', -1);

    if (this.registry.get('lives') <= 0) {
      this.announce('GAME OVER', RULES.GAME_OVER_DELAY_MS);
      this.time.delayedCall(RULES.GAME_OVER_DELAY_MS, () => {
        this.scene.restart({ level: this.level.key, reset: true });
      });
      return;
    }

    this.time.delayedCall(RULES.RESPAWN_DELAY_MS, () => {
      this.player.respawn(this.playerStart.x, this.playerStart.y);
      this.cameras.main.centerOn(this.playerStart.x, this.playerStart.y);
      this.state = 'playing';
    });
  }

  completeLevel() {
    this.state = 'complete';
    this.player.controlsEnabled = false;
    this.registry.inc('score', PICKUPS.GOAL_SCORE);
    this.announce('STAGE CLEAR!', RULES.STAGE_CLEAR_DELAY_MS);

    // There is no next level yet, so replay this one and keep the score and lives.
    this.time.delayedCall(RULES.STAGE_CLEAR_DELAY_MS, () => {
      this.scene.restart({ level: this.level.key, reset: false });
    });
  }

  announce(text, holdMs) {
    this.game.events.emit('hud:message', text, holdMs);
  }
}
