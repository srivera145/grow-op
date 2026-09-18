import { OBJECT_TYPES } from './format.js';

/**
 * The left-hand panel: what the mouse is currently doing, which object type is armed, this level's
 * details, the order every level sits in, and what is wrong with the one being edited.
 *
 * It owns no editor state - it reads what it is given and reports back through callbacks - so main.js
 * stays the one place that knows what the level is.
 */
export class Palette {
  /**
   * @param root the container element
   * @param handlers { onTool, onObjectType, onResize, onReorder, onSaveIndex }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.toolButtons = new Map();
    this.typeButtons = new Map();
    this.build();
  }

  build() {
    this.root.innerHTML = '';

    this.root.append(this.section('Tool', this.tools()));
    this.root.append(this.section('Objects', this.objectTypes()));
    this.root.append(this.section('This level', this.levelFields()));
    this.root.append(this.section('Map size', this.sizeControls()));
    this.root.append(this.section('Level order', this.levelList()));

    this.problemList = document.createElement('ul');
    this.problemList.className = 'problems';
    this.root.append(this.section('Checks', this.problemList));

    this.root.append(this.section('Keys', this.help()));
  }

  section(title, body) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = title;
    section.append(heading, body);
    return section;
  }

  /** A labelled text box. Built rather than templated, because level names are free text. */
  field(label, name, value = '') {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    input.value = value;
    wrapper.append(text, input);
    return { wrapper, input };
  }

  tools() {
    const row = document.createElement('div');
    row.className = 'buttons';
    for (const [tool, label] of [['tiles', 'Tiles'], ['objects', 'Objects']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => this.handlers.onTool(tool));
      this.toolButtons.set(tool, button);
      row.append(button);
    }
    return row;
  }

  objectTypes() {
    const list = document.createElement('div');
    list.className = 'types';
    for (const [type, def] of Object.entries(OBJECT_TYPES)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'type';
      const swatch = document.createElement('i');
      swatch.style.background = def.color;
      const name = document.createElement('span');
      name.textContent = type;
      button.append(swatch, name);
      button.addEventListener('click', () => this.handlers.onObjectType(type));
      this.typeButtons.set(type, button);
      list.append(button);
    }
    return list;
  }

  /**
   * Name, label and tileset for the level being edited. These go into the index entry when a new level
   * is registered on save; an existing level's entry is left alone (that is what Level order is for).
   */
  levelFields() {
    const box = document.createElement('div');
    box.className = 'fields';
    const name = this.field('Name', 'name');
    const label = this.field('Label', 'label');
    const tileset = this.field('Tileset', 'tileset', 'tiles-soil');
    this.metaInputs = { name: name.input, label: label.input, tileset: tileset.input };
    box.append(name.wrapper, label.wrapper, tileset.wrapper);
    return box;
  }

  /** What the level being edited should be registered as. Blanks are filled in by the caller. */
  meta() {
    return {
      name: this.metaInputs.name.value.trim(),
      label: this.metaInputs.label.value.trim(),
      tileset: this.metaInputs.tileset.value.trim(),
    };
  }

  setMeta({ name = '', label = '', tileset = 'tiles-soil' }) {
    this.metaInputs.name.value = name;
    this.metaInputs.label.value = label;
    this.metaInputs.tileset.value = tileset;
  }

  sizeControls() {
    const form = document.createElement('form');
    form.className = 'size';
    form.innerHTML = `
      <label>W <input name="width" type="number" min="8" max="1000" step="1"></label>
      <label>H <input name="height" type="number" min="8" max="200" step="1"></label>
      <button type="submit">Apply</button>`;
    this.widthInput = form.elements.width;
    this.heightInput = form.elements.height;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handlers.onResize(Number(this.widthInput.value), Number(this.heightInput.value));
    });
    return form;
  }

  /**
   * The whole level list, in order. Saving it is deliberately its own button: it rewrites entries that
   * this editing session may never have touched, which saving a level must never do.
   */
  levelList() {
    const box = document.createElement('div');
    this.indexRows = document.createElement('div');
    this.indexRows.className = 'levels';

    const save = document.createElement('button');
    save.type = 'button';
    save.id = 'save-index';
    save.textContent = 'Save level order';
    save.addEventListener('click', () => this.handlers.onSaveIndex(this.readIndex()));

    box.append(this.indexRows, save);
    return box;
  }

  /** Rebuilt only when the list itself changes, so typing in a row does not lose the caret. */
  renderIndex(index) {
    this.indexRows.innerHTML = '';
    index.forEach((entry, position) => {
      const row = document.createElement('div');
      row.className = 'level-row';
      row.dataset.key = entry.key;

      const head = document.createElement('div');
      head.className = 'level-head';
      const key = document.createElement('code');
      key.textContent = entry.key;
      head.append(key);

      for (const [direction, glyph, disabled] of [
        [-1, '↑', position === 0],
        [1, '↓', position === index.length - 1],
      ]) {
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'move';
        move.textContent = glyph;
        move.disabled = disabled;
        move.addEventListener('click', () => this.handlers.onReorder(position, position + direction));
        head.append(move);
      }

      const name = this.field('name', 'name', entry.name ?? '');
      const label = this.field('label', 'label', entry.label ?? '');
      const next = this.field('next', 'next', entry.next ?? '');
      row.append(head, name.wrapper, label.wrapper, next.wrapper);
      this.indexRows.append(row);
    });
  }

  /** The list as the boxes currently read it. Empty fields are dropped, so defaults stay defaults. */
  readIndex() {
    return [...this.indexRows.querySelectorAll('.level-row')].map((row) => {
      const entry = { key: row.dataset.key };
      for (const field of ['name', 'label', 'next']) {
        const value = row.querySelector(`input[name="${field}"]`).value.trim();
        if (value) entry[field] = value;
      }
      return entry;
    });
  }

  help() {
    const help = document.createElement('dl');
    help.className = 'help';
    const keys = [
      ['Left drag', 'paint solid'],
      ['Right drag', 'erase'],
      ['Shift drag', 'filled rectangle'],
      ['Middle / Space drag', 'pan'],
      ['Wheel', 'zoom'],
      ['Alt', 'place off the grid'],
      ['Delete', 'remove selected object'],
      ['Ctrl+Z / Ctrl+Y', 'undo / redo'],
    ];
    for (const [key, what] of keys) {
      const term = document.createElement('dt');
      term.textContent = key;
      const meaning = document.createElement('dd');
      meaning.textContent = what;
      help.append(term, meaning);
    }
    return help;
  }

  /** Redraws everything that depends on editor state. Cheap enough to call on every change. */
  update({ tool, objectType, width, height, problems }) {
    for (const [name, button] of this.toolButtons) button.classList.toggle('active', name === tool);
    for (const [type, button] of this.typeButtons) button.classList.toggle('active', type === objectType);

    if (document.activeElement !== this.widthInput) this.widthInput.value = String(width);
    if (document.activeElement !== this.heightInput) this.heightInput.value = String(height);

    this.problemList.innerHTML = '';
    if (problems.length === 0) {
      const item = document.createElement('li');
      item.className = 'ok';
      item.textContent = 'Nothing wrong with it.';
      this.problemList.append(item);
      return;
    }
    for (const problem of problems) {
      const item = document.createElement('li');
      item.className = problem.severity;
      item.textContent = problem.message;
      this.problemList.append(item);
    }
  }
}
