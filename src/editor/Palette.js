import { OBJECT_TYPES } from './format.js';

/**
 * The left-hand panel: what the mouse is currently doing, which object type is armed, and the list of
 * things wrong with the level. It owns no editor state - it reads what it is given and reports clicks
 * back through callbacks - so main.js stays the one place that knows what the level is.
 */
export class Palette {
  /**
   * @param root the container element
   * @param handlers { onTool(name), onObjectType(type), onResize(width, height) }
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
    this.root.append(this.section('Map size', this.sizeControls()));

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
      button.innerHTML = `<i style="background:${def.color}"></i><span>${type}</span>`;
      button.addEventListener('click', () => this.handlers.onObjectType(type));
      this.typeButtons.set(type, button);
      list.append(button);
    }
    return list;
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
