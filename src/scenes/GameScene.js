import Phaser from 'phaser';
import Player from '../objects/Player.js';
import Pickup, { PICKUP_KINDS } from '../objects/Pickup.js';
import SpiderMite from '../objects/enemies/SpiderMite.js';
import FungusGnat from '../objects/enemies/FungusGnat.js';
import RootRot from '../objects/enemies/RootRot.js';
import ParallaxBackground from '../objects/ParallaxBackground.js';
import { ATTACK, CAMERA, ENEMIES, FIRST_LEVEL, LEVELS, PICKUPS, RULES, TEXTURES } from '../config/constants.js';

// Enemy classes by the object name used in the Tiled "objects" layer.
const ENEMY_TYPES = {
  'spider-mite': SpiderMite,
  'fungus-gnat': FungusGnat,
  'root-rot': RootRot,
};

/** Centre of a Tiled object. Rectangles are anchored top-left; points have no size. */
function objectCentre(obj) {
  return { x: obj.x + (obj.width || 0) / 2, y: obj.y + (obj.height || 0) / 2 };
}

/**
 * Plays one level: loads its Tiled map, spawns everything named in the "objects" layer,
 * follows the player with the camera and applies the rules (score, drops, lives, damage).
 * Progress lives in the game registry so the HUD scene can display it.
 */
export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data = {}) {
    this.level = LEVELS[data.level] ?? LEVELS[FIRST_LEVEL];
    this.state = 'playing'; // 'playing' | 'dead' | 'complete'
    this.levelDrops = 0; // drops collected this run, for the grade screen (the HUD counter wraps at 100)

    if (data.reset !== false) {
      this.registry.set({ score: 0, drops: 0, lives: RULES.START_LIVES });
    }
    this.registry.set('world', this.level.name);
  }

  preload() {
    this.load.tilemapTiledJSON(this.level.key, this.level.file);
  }

  create() {
    this.background = new ParallaxBackground(this);

    // Ground
    this.map = this.make.tilemap({ key: this.level.key });
    const tileset = this.map.addTilesetImage(this.level.tileset, TEXTURES.TILE_SOIL);
    this.groundLayer = this.map.createLayer('ground', tileset, 0, 0);
    this.groundLayer.setCollisionByExclusion([-1]);

    // The world is the map, open at the bottom so gaps drop things out of it.
    const { widthInPixels, heightInPixels } = this.map;
    this.physics.world.setBounds(0, 0, widthInPixels, heightInPixels, true, true, true, false);

    this.spawnObjects(this.map.getObjectLayer('objects'));

    this.physics.add.collider(this.player, this.groundLayer);
    this.physics.add.collider(this.enemies, this.groundLayer, undefined, (enemy) => enemy.collidesWithGround);
    this.physics.add.overlap(this.player, this.pickups, this.onPickup, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.onEnemyContact, undefined, this);
    this.physics.add.overlap(this.player.attackZone, this.enemies, this.onSlashHit, undefined, this);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, widthInPixels, heightInPixels);
    camera.startFollow(this.player, true, CAMERA.LERP, CAMERA.LERP);
    camera.setDeadzone(CAMERA.DEADZONE_WIDTH, CAMERA.DEADZONE_HEIGHT);

    this.levelStartTime = this.time.now;
    this.scene.run('HUDScene');
  }

  /** Creates game objects from the Tiled object layer, matching on each object's name. */
  spawnObjects(layer) {
    this.pickups = this.add.group();
    this.enemies = this.add.group();
    this.playerStart = { x: 64, y: 64 };

    for (const obj of layer?.objects ?? []) {
      const { x, y } = objectCentre(obj);
      if (obj.name === 'player-start') {
        this.playerStart = { x, y };
      } else if (obj.name in PICKUP_KINDS) {
        this.pickups.add(new Pickup(this, x, y, obj.name));
      } else if (obj.name in ENEMY_TYPES) {
        this.spawnEnemy(obj.name, x, y);
      } else {
        console.warn(`Level ${this.level.key}: no spawn rule for object "${obj.name}"`);
      }
    }

    // Created last so the player draws in front of everything else.
    this.player = new Player(this, this.playerStart.x, this.playerStart.y);
  }

  /** Adds an enemy to the level. Also used by enemies that spawn others, such as a splitting root rot. */
  spawnEnemy(kind, x, y, options) {
    const enemy = new ENEMY_TYPES[kind](this, x, y, options);
    this.enemies.add(enemy);
    return enemy;
  }

  update(time, delta) {
    this.player.update(time, delta);
    this.background.update();

    const fellOut = this.player.y > this.map.heightInPixels + RULES.FALL_DEATH_MARGIN;
    if (this.state === 'playing' && fellOut) {
      this.loseLife('fall');
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
        this.completeLevel(pickup);
        return; // the jar stays in place
      default:
        return;
    }
    pickup.collect();
  }

  addDrop() {
    this.levelDrops += 1;
    let drops = this.registry.get('drops') + 1;
    if (drops >= PICKUPS.DROPS_PER_LIFE) {
      drops -= PICKUPS.DROPS_PER_LIFE;
      this.registry.inc('lives', 1);
      this.announce('EXTRA LIFE!');
    }
    this.registry.set('drops', drops);
  }

  // ---------- enemies and damage ----------

  onEnemyContact(player, enemy) {
    if (this.state !== 'playing' || !enemy.canTouch()) return;

    // Nutrient invincibility beats every enemy, including the ones that cannot be stomped.
    if (player.isInvincible()) {
      enemy.defeat('knockout');
      this.registry.inc('score', ENEMIES.STOMP_SCORE);
      return;
    }

    if (enemy.stompable && this.isStomp(player, enemy)) {
      enemy.stomp(player);
      player.bounce();
      this.registry.inc('score', ENEMIES.STOMP_SCORE);
      return;
    }

    this.hitPlayer();
  }

  /** The leaf slash kills the enemies marked slashable and passes harmlessly through the rest. */
  onSlashHit(zone, enemy) {
    if (this.state !== 'playing' || !enemy.slashable || !enemy.canTouch()) return;
    enemy.defeat('knockout');
    this.registry.inc('score', ATTACK.SCORE);
  }

  /**
   * A stomp is the player falling onto the top of an enemy. Judged from where both bodies
   * were before this physics step, so a fast fall that sinks deep into the enemy still counts
   * while running into its side never does.
   */
  isStomp(player, enemy) {
    const feetBefore = player.body.bottom - player.body.deltaY();
    const headBefore = enemy.body.top - enemy.body.deltaY();
    return player.body.velocity.y > 0 && feetBefore <= headBefore + ENEMIES.STOMP_TOLERANCE;
  }

  /** One point of damage: big players shrink, small unprotected ones lose a life. */
  hitPlayer() {
    if (this.state === 'playing' && this.player.takeHit()) {
      this.loseLife('hit');
    }
  }

  // ---------- death and level flow ----------

  loseLife(cause) {
    this.state = 'dead';
    this.player.controlsEnabled = false;
    if (cause === 'hit') {
      this.player.die();
    }
    this.registry.inc('lives', -1);

    if (this.registry.get('lives') <= 0) {
      this.announce('GAME OVER', RULES.GAME_OVER_DELAY_MS);
      this.time.delayedCall(RULES.GAME_OVER_DELAY_MS, () => {
        this.scene.stop('HUDScene');
        this.scene.start('TitleScene');
      });
      return;
    }

    this.time.delayedCall(RULES.RESPAWN_DELAY_MS, () => {
      this.player.respawn(this.playerStart.x, this.playerStart.y);
      this.cameras.main.centerOn(this.playerStart.x, this.playerStart.y);
      this.state = 'playing';
    });
  }

  /** Goal reached: freeze the player, pop them into the jar, then open the grade screen. */
  completeLevel(jar) {
    this.state = 'complete';
    const player = this.player;
    const timeMs = this.time.now - this.levelStartTime;

    player.controlsEnabled = false;
    player.body.enable = false; // physics off so the tween owns the sprite
    player.attackZone.body.enable = false;
    player.celebrate();
    this.registry.inc('score', PICKUPS.GOAL_SCORE);
    this.announce('STAGE CLEAR!', 2000);

    // Positions are body centres, and bodies keep their size whatever art is showing.
    const hopY = jar.body.top - player.body.height / 2 - 24; // feet clear of the lid, which sits above the jar's body
    this.tweens.chain({
      tweens: [
        // hop up over the mouth of the jar
        { targets: player, x: jar.x, y: hopY, duration: 280, ease: 'Sine.easeOut' },
        // drop inside, shrinking out of sight
        { targets: player, y: jar.y + 8, scale: 0.6, alpha: 0, duration: 320, ease: 'Sine.easeIn', onComplete: () => jar.close() },
        // the jar thumps as the lid seals
        { targets: jar, scaleX: 1.12, scaleY: 0.92, duration: 90, yoyo: true, repeat: 1 },
      ],
      onComplete: () => {
        this.time.delayedCall(RULES.JARRING_HOLD_MS, () => {
          this.scene.stop('HUDScene');
          this.scene.start('LevelCompleteScene', {
            level: this.level.key,
            score: this.registry.get('score'),
            drops: this.levelDrops,
            timeMs,
          });
        });
      },
    });
  }

  announce(text, holdMs) {
    this.game.events.emit('hud:message', text, holdMs);
  }
}
