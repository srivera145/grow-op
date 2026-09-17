import Phaser from 'phaser';
import Player from '../objects/Player.js';
import { GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, TEXTURES } from '../config/constants.js';

const COLS = Math.ceil(GAME_WIDTH / TILE_SIZE);

/**
 * Placeholder test level: a soil floor with a pit (for trying coyote time),
 * two steps on the right, and a floating ledge on the left that only a
 * fully held jump can reach.
 */
export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.ground = this.physics.add.staticGroup();
    this.buildLevel();

    // Start standing on the floor, two and a half tiles up from the bottom edge.
    this.player = new Player(this, TILE_SIZE * 2.5, GAME_HEIGHT - TILE_SIZE * 2.5);
    this.physics.add.collider(this.player, this.ground);

    this.add.text(12, 12, 'Move: Arrows / A D    Jump: Space / Up / W (hold for height)', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#d8f3dc',
    });
  }

  buildLevel() {
    // Floor: two rows of soil across the screen, minus a three-tile pit.
    const pit = { from: 14, to: 16 };
    for (let col = 0; col < COLS; col++) {
      if (col >= pit.from && col <= pit.to) continue;
      this.placeTile(col, 0);
      this.placeTile(col, 1);
    }

    // Two steps on the right.
    this.fillTiles(20, 22, 2, 2);
    this.fillTiles(23, 25, 2, 3);

    // Floating ledge on the left, three tiles above the floor.
    this.fillTiles(6, 9, 4, 4);
  }

  fillTiles(colFrom, colTo, rowFrom, rowTo) {
    for (let col = colFrom; col <= colTo; col++) {
      for (let row = rowFrom; row <= rowTo; row++) {
        this.placeTile(col, row);
      }
    }
  }

  /**
   * Places one soil tile. Columns count from the left edge of the screen and rows count
   * up from the bottom edge, so row 0 is the lowest row of tiles.
   */
  placeTile(col, row) {
    const x = col * TILE_SIZE + TILE_SIZE / 2;
    const y = GAME_HEIGHT - row * TILE_SIZE - TILE_SIZE / 2;
    this.ground.create(x, y, TEXTURES.TILE_SOIL);
  }

  update(time, delta) {
    this.player.update(time, delta);
  }
}
