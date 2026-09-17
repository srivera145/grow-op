import Phaser from 'phaser';
import Player from '../objects/Player.js';
import Pickup, { PICKUP_KINDS } from '../objects/Pickup.js';
import SpiderMite from '../objects/enemies/SpiderMite.js';
import FungusGnat from '../objects/enemies/FungusGnat.js';
import RootRot from '../objects/enemies/RootRot.js';
import ParallaxBackground from '../objects/ParallaxBackground.js';
import { ensureRotateGuard } from './RotateScene.js';
import { touchControlsWanted } from '../input/TouchSource.js';
import { ATTACK, CAMERA, ENEMIES, FIRST_LEVEL, LEVELS, PICKUPS, PLAYER, RULES, TILESETS, TILE_SIZE } from '../config/constants.js';
import Sfx from '../audio/Sfx.js';

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
 * Where a Tiled object meets the ground: the bottom edge of a rectangle, or of the tile cell a point
 * sits in. Things that stand on the ground are placed from this line, so a change of body size can
 * never sink them into the floor or leave them hovering.
 */
function objectGroundY(obj) {
  return obj.height ? obj.y + obj.height : Math.ceil(obj.y / TILE_SIZE) * TILE_SIZE;
}

/** Moves a sprite whose position is its body centre so that the body's bottom edge rests on groundY. */
function standOn(sprite, body, groundY) {
  sprite.y = groundY - body.height / 2;
  sprite.body.updateFromGameObject(); // sleeping bodies are not refreshed by the physics step
  return sprite;
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
    this.registry.set({ world: this.level.name, worldLabel: this.level.label, time: 0 });
  }

  preload() {
    this.load.tilemapTiledJSON(this.level.key, this.level.file);
  }

  create() {
    this.background = new ParallaxBackground(this);

    // Ground
    this.map = this.make.tilemap({ key: this.level.key });
    // The tileset's name in the map, its entry in TILESETS and its texture key are all the same string.
    const tilesetDef = TILESETS[this.level.tileset];
    const tileset = this.map.addTilesetImage(this.level.tileset, this.level.tileset);
    this.groundLayer = this.map.createLayer('ground', tileset, 0, 0);
    // Every gid the tileset owns is solid, whichever edge piece it is. Only gid 0 is empty.
    this.groundLayer.setCollisionBetween(tilesetDef.firstGid, tilesetDef.firstGid + tilesetDef.tileCount - 1);
    this.addGroundBacking(tilesetDef.backing);

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
    Sfx.playMusic('level'); // keeps going through the grade screen and a replay

    // Touch devices: on-screen buttons while the level is in play, and the portrait guard.
    this.touchControlsShown = false;
    this.events.once('shutdown', () => this.scene.stop('TouchScene'));
    this.syncTouchControls();
    // A touchscreen laptop only gets the buttons once its screen is touched, which can happen mid-level.
    this.input.on('pointerdown', () => this.syncTouchControls());
    ensureRotateGuard(this);
  }

  /**
   * Fills the hairline gaps that a tileset leaves between neighbouring tiles when its art stops short of
   * the cell edges (see TILESETS). A flat colour goes behind every solid tile, pulled in from whichever
   * sides face open air, so only soil-against-soil joins are backed and outward edges keep their shape.
   * Like the autotiler, it treats cells outside the map as solid.
   */
  addGroundBacking(backing) {
    if (!backing) return;

    const layer = this.groundLayer;
    const { width, height } = layer.layer;
    const solid = (col, row) => col < 0 || row < 0 || col >= width || row >= height || layer.getTileAt(col, row) !== null;
    const graphics = this.add.graphics().setDepth(layer.depth - 1);
    graphics.fillStyle(backing.color, 1);

    layer.forEachTile((tile) => {
      const left = solid(tile.x - 1, tile.y) ? 0 : backing.inset;
      const right = solid(tile.x + 1, tile.y) ? 0 : backing.inset;
      const top = solid(tile.x, tile.y - 1) ? 0 : backing.inset;
      const bottom = solid(tile.x, tile.y + 1) ? 0 : backing.inset;
      graphics.fillRect(tile.pixelX + left, tile.pixelY + top, TILE_SIZE - left - right, TILE_SIZE - top - bottom);

      // Thin strips along the joins themselves, reaching further out under the grass than the main fill.
      const seam = (open) => (open ? backing.seamInset : 0);
      if (bottom === 0) {
        graphics.fillRect(tile.pixelX + seam(left), tile.pixelY + TILE_SIZE - 3, TILE_SIZE - seam(left) - seam(right), 4);
      }
      if (right === 0) {
        graphics.fillRect(tile.pixelX + TILE_SIZE - 2, tile.pixelY + seam(top), 4, TILE_SIZE - seam(top) - seam(bottom));
      }
    }, this, 0, 0, width, height, { isNotEmpty: true });
  }

  /** Creates game objects from the Tiled object layer, matching on each object's name. */
  spawnObjects(layer) {
    this.pickups = this.add.group();
    this.enemies = this.add.group();
    this.playerStart = { x: 64, y: 64 };

    for (const obj of layer?.objects ?? []) {
      const { x, y } = objectCentre(obj);
      const groundY = objectGroundY(obj);
      if (obj.name === 'player-start') {
        this.playerStart = { x, y: groundY - PLAYER.BODY.small.height / 2 };
      } else if (obj.name in PICKUP_KINDS) {
        const pickup = new Pickup(this, x, y, obj.name);
        if (pickup.def.anchor === 'bottom') standOn(pickup, pickup.def.body, groundY);
        this.pickups.add(pickup);
      } else if (obj.name in ENEMY_TYPES) {
        const enemy = this.spawnEnemy(obj.name, x, y);
        if (enemy.art.anchor === 'bottom') standOn(enemy, enemy.art.body, groundY);
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

    // The HUD clock: whole seconds since the level started, frozen once the goal is reached.
    if (this.state !== 'complete') {
      const seconds = Math.floor((this.time.now - this.levelStartTime) / 1000);
      if (seconds !== this.registry.get('time')) this.registry.set('time', seconds);
    }

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
      Sfx.play('stomp');
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
    Sfx.play('slash-hit');
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

  /** Every change of state goes through here so the touch controls always follow it. */
  setState(state) {
    this.state = state;
    this.syncTouchControls();
  }

  /**
   * The on-screen buttons exist only while the level is actually being played. They go away on death,
   * stage clear and game over, and come back on respawn or replay. Desktop never starts them.
   */
  syncTouchControls() {
    if (!touchControlsWanted()) return;

    // Only act on a change. scene.run() on a scene that is already running restarts it, and a restart
    // makes TouchScene treat the fingers already down as held rather than newly pressed, which would
    // swallow the very press that triggered it.
    const show = this.state === 'playing';
    if (show === this.touchControlsShown) return;
    this.touchControlsShown = show;

    if (show) {
      this.scene.run('TouchScene');
      this.game.events.emit('touch:controls'); // lets the HUD switch its help line to the button names
    } else {
      this.scene.stop('TouchScene');
    }
  }

  /** One point of damage: big players shrink, small unprotected ones lose a life. */
  hitPlayer() {
    if (this.state === 'playing' && this.player.takeHit()) {
      this.loseLife('hit');
    }
  }

  // ---------- death and level flow ----------

  loseLife(cause) {
    this.setState('dead');
    this.player.controlsEnabled = false;
    if (cause === 'hit') {
      this.player.die();
    }
    this.registry.inc('lives', -1);

    if (this.registry.get('lives') <= 0) {
      Sfx.play('game-over'); // the sting stands in for the death jingle on the last life
      this.announce('GAME OVER', RULES.GAME_OVER_DELAY_MS);
      this.time.delayedCall(RULES.GAME_OVER_DELAY_MS, () => {
        this.scene.stop('HUDScene');
        this.scene.start('TitleScene');
      });
      return;
    }

    Sfx.play('die');
    this.time.delayedCall(RULES.RESPAWN_DELAY_MS, () => {
      this.player.respawn(this.playerStart.x, this.playerStart.y);
      this.cameras.main.centerOn(this.playerStart.x, this.playerStart.y);
      this.setState('playing');
    });
  }

  /** Goal reached: freeze the player, pop them into the jar, then open the grade screen. */
  completeLevel(jar) {
    this.setState('complete');
    const player = this.player;
    const timeMs = this.time.now - this.levelStartTime;

    player.controlsEnabled = false;
    player.body.enable = false; // physics off so the tween owns the sprite
    player.attackZone.body.enable = false;
    player.celebrate();
    this.registry.inc('score', PICKUPS.GOAL_SCORE);
    this.announce('STAGE CLEAR!', 2000);
    Sfx.play('level-complete');

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
