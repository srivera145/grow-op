import { DEFAULT_SIZE, LayoutError, SIZE_LIMITS, countObjects, extractLayout, parseLayout } from '../../tools/generate/parse.mjs';
import { analyseReachability, describeReachability } from './reachability.mjs';
import { OBJECT_TYPES, TILE, centreOf } from './format.js';
import { Grid } from './Grid.js';
import { ObjectLayer } from './Objects.js';
import { validate } from './validate.js';

/**
 * The Generate panel: describe a level, get a draft, look at it, keep it or throw it away.
 *
 * What comes back from a model is a suggestion, not a level. Before it is allowed anywhere near the
 * canvas it has to parse, pass the same checks a hand-drawn level passes, and then be proved walkable
 * from player-start to the jar. A draft that fails any of that is not loaded - it is shown, with what
 * was wrong with it, and the same failure is what gets sent back with the next attempt.
 *
 * Nothing here writes anything. Accepting a draft puts it on the canvas as unsaved work, and Save is
 * still the button that writes a file.
 */

const COST_NOTE = 'One paid API call per generate, to the model named in .env.';

export class Generate {
  /**
   * @param root the container element
   * @param handlers { onAccept(level) -> whether the editor took it }
   */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.draft = null; // the parsed level, once one has passed everything
    this.previous = null; // { layout, problems } from the last rejected attempt, fed to the next one
    this.busy = false;
    this.build();
  }

  build() {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = 'Generate';

    this.description = document.createElement('textarea');
    this.description.id = 'generate-description';
    this.description.rows = 3;
    this.description.placeholder = 'A flooded basement grow: knee-deep water, pipes to climb, mites on the walkways.';

    const size = document.createElement('div');
    size.className = 'size';
    size.innerHTML = `
      <label>W <input id="generate-width" type="number" min="${SIZE_LIMITS.width[0]}" max="${SIZE_LIMITS.width[1]}" step="1" value="${DEFAULT_SIZE.width}"></label>
      <label>H <input id="generate-height" type="number" min="${SIZE_LIMITS.height[0]}" max="${SIZE_LIMITS.height[1]}" step="1" value="${DEFAULT_SIZE.height}"></label>`;
    this.width = size.querySelector('#generate-width');
    this.height = size.querySelector('#generate-height');

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.id = 'generate-run';
    this.button.textContent = 'Generate a level';
    this.button.addEventListener('click', () => this.run());

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = COST_NOTE;

    this.status = document.createElement('p');
    this.status.className = 'note';

    this.preview = document.createElement('canvas');
    this.preview.id = 'generate-preview';
    this.preview.hidden = true;

    this.findings = document.createElement('ul');
    this.findings.className = 'problems';

    this.actions = document.createElement('div');
    this.actions.className = 'buttons';
    this.accept = this.action('Use this level', 'generate-accept', () => this.use());
    this.again = this.action('Regenerate', 'generate-again', () => this.run());
    this.discard = this.action('Discard', 'generate-discard', () => this.clear('Discarded the draft.'));
    this.actions.append(this.accept, this.again, this.discard);
    this.showActions(false);

    section.append(heading, this.description, size, this.button, note, this.status, this.preview, this.findings, this.actions);
    this.root.append(section);
  }

  action(label, id, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  showActions(showing, { canAccept = false } = {}) {
    this.actions.style.display = showing ? 'flex' : 'none';
    this.accept.hidden = !canAccept;
  }

  say(message, severity = 'ok') {
    this.status.textContent = message;
    this.status.dataset.severity = severity;
  }

  setBusy(busy, message) {
    this.busy = busy;
    this.button.disabled = busy;
    this.again.disabled = busy;
    this.button.textContent = busy ? 'Generating...' : 'Generate a level';
    if (message) this.say(message, 'warn');
  }

  /** One request at a time, with the last rejection - if there was one - sent along with it. */
  async run() {
    if (this.busy) return null;
    const description = this.description.value.trim();
    if (description.length < 3) {
      this.say('Describe the level you want first.', 'error');
      return null;
    }

    this.setBusy(true, this.previous ? 'Asking again, with what was wrong last time...' : 'Asking the model...');
    this.showActions(false);
    this.findings.innerHTML = '';
    try {
      const response = await fetch('/api/generate-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          width: Number(this.width.value),
          height: Number(this.height.value),
          previous: this.previous,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

      const verdict = this.offer(body.reply, body.size);
      this.cost = `${body.model}, ${body.usage.input} in / ${body.usage.output} out tokens, ${body.seconds}s.`;
      this.say(`${this.status.textContent} ${this.cost}`, this.status.dataset.severity);
      return verdict;
    } catch (error) {
      this.say(`Could not generate: ${error.message}`, 'error');
      this.showActions(true, { canAccept: false });
      return null;
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Judges a layout and shows the verdict. Split out from the request so a draft can be judged without
   * one - which is how the editor's own checks exercise this.
   *
   * The order is the cheap checks first: a layout that is not the right shape never reaches the solver,
   * and a level with no player-start has nothing to search from anyway.
   */
  offer(reply, size) {
    this.draft = null;
    this.preview.hidden = true;

    let layout = '';
    let level;
    try {
      layout = extractLayout(reply);
      level = parseLayout(layout, size);
    } catch (error) {
      if (!(error instanceof LayoutError)) throw error;
      return this.reject(layout, [{ severity: 'error', message: `The layout could not be read: ${error.message}.` }]);
    }

    const grid = new Grid(level.width, level.height, level.cells);
    const objects = new ObjectLayer(level.objects, level.nextObjectId);
    const problems = validate(grid, objects);
    if (problems.some((problem) => problem.severity === 'error')) return this.reject(layout, problems, level);

    const reach = analyseReachability(level);
    const stranded = describeReachability(reach);
    if (stranded.length > 0) return this.reject(layout, [...problems, ...stranded], level, reach);

    this.draft = level;
    this.previous = null;
    this.drawPreview(level);
    this.render(problems);
    this.showActions(true, { canAccept: true });
    const counts = countObjects(level.objects);
    const pickups = ['water-drop', 'light-orb', 'nutrient'].reduce((total, name) => total + (counts[name] ?? 0), 0);
    this.say(`A ${level.width}x${level.height} draft: ${pickups} pickups, ${level.objects.length - pickups - 1} enemies and the jar, all reachable.`);
    return { ok: true, level, reach, problems, counts };
  }

  /** A draft that is not going on the canvas. It is kept only to tell the next attempt what went wrong. */
  reject(layout, problems, level = null, reach = null) {
    this.previous = { layout, problems: problems.filter((problem) => problem.severity === 'error').map((problem) => problem.message) };
    this.render(problems);
    if (level) this.drawPreview(level, reach);
    this.showActions(true, { canAccept: false });
    this.say('Not loaded: this level cannot be played as drawn. Regenerate sends these back with the next attempt.', 'error');
    return { ok: false, level, reach, problems };
  }

  render(problems) {
    this.findings.innerHTML = '';
    for (const problem of problems) {
      const item = document.createElement('li');
      item.className = problem.severity;
      item.textContent = problem.message;
      this.findings.append(item);
    }
  }

  /**
   * A thumbnail of the draft: ground in soil brown, each object a dot in its palette colour, and
   * anything the solver could not reach ringed in red so it can be seen as well as read.
   */
  drawPreview(level, reach = null) {
    const scale = Math.max(2, Math.floor(this.root.clientWidth / level.width)) || 2;
    this.preview.width = level.width * scale;
    this.preview.height = level.height * scale;
    this.preview.hidden = false;

    const context = this.preview.getContext('2d');
    context.fillStyle = '#0d1711';
    context.fillRect(0, 0, this.preview.width, this.preview.height);

    context.fillStyle = '#4a2f24';
    for (let row = 0; row < level.height; row += 1) {
      for (let col = 0; col < level.width; col += 1) {
        if (level.cells[row * level.width + col]) context.fillRect(col * scale, row * scale, scale, scale);
      }
    }

    const unreachable = new Set((reach?.stranded ?? []).map((object) => object.id));
    for (const object of level.objects) {
      const centre = centreOf(object);
      const x = (centre.x / TILE) * scale;
      const y = (centre.y / TILE) * scale;
      context.fillStyle = OBJECT_TYPES[object.name]?.color ?? '#ffffff';
      context.fillRect(x - scale / 2, y - scale / 2, Math.max(2, scale), Math.max(2, scale));
      if (unreachable.has(object.id)) {
        context.strokeStyle = '#e8443a';
        context.lineWidth = 1;
        context.strokeRect(x - scale - 1, y - scale - 1, scale * 2 + 2, scale * 2 + 2);
      }
    }
  }

  /** Hands the draft to the editor. The editor decides whether it may replace what is open. */
  use() {
    if (!this.draft) return false;
    const taken = this.handlers.onAccept(this.draft);
    if (taken) this.clear('Loaded as an unsaved draft. Save writes it to disk.');
    return taken;
  }

  clear(message) {
    this.draft = null;
    this.previous = null;
    this.preview.hidden = true;
    this.findings.innerHTML = '';
    this.showActions(false);
    this.say(message ?? '');
  }
}
