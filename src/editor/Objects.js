import { OBJECT_TYPES, TILE, centreOf, makeObject, snapTo } from './format.js';

/**
 * The named points in a level: placing them, picking them up, moving them, removing them.
 *
 * Objects carry every field they were read with, so anything Tiled wrote that the editor has no opinion
 * about survives a round trip. Only x and y are ever changed on an existing one.
 */
export class ObjectLayer {
  constructor(objects = [], nextId = 1) {
    this.list = objects;
    this.nextId = nextId;
    this.selected = null;
  }

  /** The topmost object under a world point, so the one drawn last is the one picked up. */
  at(x, y) {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const object = this.list[i];
      const { x: cx, y: cy } = centreOf(object);
      // A point has no rectangle to hit, so it gets a tile-sized one around it.
      const halfWidth = Math.max(object.width || 0, TILE) / 2;
      const halfHeight = Math.max(object.height || 0, TILE) / 2;
      if (Math.abs(x - cx) <= halfWidth && Math.abs(y - cy) <= halfHeight) return object;
    }
    return null;
  }

  /**
   * Adds one. Snapped placement puts it where the cell wants it - standing on the floor of the cell, or
   * centred in it, depending on the type - and free placement centres it on the pointer instead.
   */
  add(type, worldX, worldY, { snap = true } = {}) {
    const def = OBJECT_TYPES[type];
    const position = snap
      ? snapTo(type, Math.floor(worldX / TILE), Math.floor(worldY / TILE))
      : { x: Math.round(worldX - (def.width || 0) / 2), y: Math.round(worldY - (def.height || 0) / 2) };

    const object = makeObject(this.nextId, type, position.x, position.y);
    this.nextId += 1;
    this.list.push(object);
    this.selected = object;
    return object;
  }

  /** Moves one so it lands where the pointer is, snapped to the cell under the pointer unless free. */
  moveTo(object, worldX, worldY, { snap = true } = {}) {
    const def = OBJECT_TYPES[object.name];
    const position = snap && def
      ? snapTo(object.name, Math.floor(worldX / TILE), Math.floor(worldY / TILE))
      : { x: Math.round(worldX - (object.width || 0) / 2), y: Math.round(worldY - (object.height || 0) / 2) };

    const moved = object.x !== position.x || object.y !== position.y;
    object.x = position.x;
    object.y = position.y;
    return moved;
  }

  remove(object) {
    const index = this.list.indexOf(object);
    if (index < 0) return false;
    this.list.splice(index, 1);
    if (this.selected === object) this.selected = null;
    return true;
  }

  /** Objects that fall outside a resized map, so the caller can say what a shrink would cost. */
  countOutside(width, height) {
    return this.list.filter((object) => {
      const { x, y } = centreOf(object);
      return x > width * TILE || y > height * TILE;
    }).length;
  }

  count(type) {
    return this.list.filter((object) => object.name === type).length;
  }
}
