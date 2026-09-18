/**
 * The tile grid, and the undo stack for the whole editor.
 *
 * A cell is 1 or 0 - solid or empty - and nothing else. Which of the nine soil pieces a solid cell is
 * drawn with is worked out from its neighbours every time, never stored, so there is no way for the
 * editor to hold a tile arrangement the autotiler would not produce.
 */

/** Reads and writes one solid/empty cell per tile, and resizes without losing what is already there. */
export class Grid {
  constructor(width, height, cells) {
    this.width = width;
    this.height = height;
    this.cells = cells ?? new Uint8Array(width * height);
  }

  inside(col, row) {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  get(col, row) {
    return this.inside(col, row) ? this.cells[row * this.width + col] : 0;
  }

  /** Returns true if this actually changed something, so a stroke can skip pointless redraws. */
  set(col, row, solid) {
    if (!this.inside(col, row)) return false;
    const index = row * this.width + col;
    const value = solid ? 1 : 0;
    if (this.cells[index] === value) return false;
    this.cells[index] = value;
    return true;
  }

  /** Paints or erases a filled rectangle between two cells, in either direction. */
  fillRect(colA, rowA, colB, rowB, solid) {
    let changed = false;
    for (let row = Math.min(rowA, rowB); row <= Math.max(rowA, rowB); row += 1) {
      for (let col = Math.min(colA, colB); col <= Math.max(colA, colB); col += 1) {
        changed = this.set(col, row, solid) || changed;
      }
    }
    return changed;
  }

  /**
   * Resizes, keeping everything that still fits. Growing adds empty cells; shrinking drops whatever
   * falls outside, which is why the caller warns first.
   */
  resize(width, height) {
    const cells = new Uint8Array(width * height);
    for (let row = 0; row < Math.min(height, this.height); row += 1) {
      for (let col = 0; col < Math.min(width, this.width); col += 1) {
        cells[row * width + col] = this.cells[row * this.width + col];
      }
    }
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  /** How much would be lost by resizing to this size: solid cells outside it, and why it matters. */
  countLostBy(width, height) {
    let lost = 0;
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        if ((col >= width || row >= height) && this.cells[row * this.width + col]) lost += 1;
      }
    }
    return lost;
  }
}

const DEPTH = 100; // the brief asks for at least 50; snapshots are a couple of kilobytes each

/**
 * Undo and redo for everything at once.
 *
 * Each entry is a snapshot of the whole level - grid, objects, size - rather than a description of what
 * changed. A level is small enough that this costs nothing, and it means a change can never be half
 * undone: tile edits, object edits and resizes all travel together through the same stack.
 */
export class History {
  constructor(takeSnapshot, applySnapshot) {
    this.takeSnapshot = takeSnapshot;
    this.applySnapshot = applySnapshot;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Called immediately BEFORE a change, with the level still as it was. */
  record() {
    this.undoStack.push(this.takeSnapshot());
    if (this.undoStack.length > DEPTH) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Drops the most recent recorded state, for a change that turned out to be a no-op. */
  forget() {
    this.undoStack.pop();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.takeSnapshot());
    this.applySnapshot(this.undoStack.pop());
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.takeSnapshot());
    this.applySnapshot(this.redoStack.pop());
    return true;
  }

  get depth() {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
