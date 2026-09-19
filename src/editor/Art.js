import { ALIGNMENTS, ART_KINDS, MAX_DESCRIPTION } from '../../tools/generate/art-prompt.mjs';

/**
 * The Art panel: describe an asset, get one drawn, look at what actually came back, keep it or not.
 *
 * The shape is the Generate panel's, because the problem is the same one: what a model hands back is a
 * suggestion, and the job of the panel is to find out whether it is any good before it becomes part of
 * the game. Where Generate runs a layout through the reachability solver, this runs an image through
 * tools/repack.py and shows the audit - every number measured off the real PNG, none of it assumed.
 *
 * Two rules are worth stating because they are what the panel is for.
 *
 * An asset the audit has flagged cannot be accepted. Not greyed out with an override: the Accept
 * button is not offered, and the server refuses it as well. A strip whose frames are not evenly spaced
 * will be cut in the wrong places, and it will look like a bug in the game rather than a bad export.
 *
 * Getting it wrong is free the second time. Every generation is kept in .art-raw, so a strip that came
 * back with five frames when four were asked for is repacked at five - no API call, no money. Generate
 * is the only button here that costs anything, and it says so.
 */

const COST_NOTE = 'One paid image generation per press, to the model named in .env. Repacking from .art-raw is free.';
const PREVIEW_SCALE = 4; // the sheets are 32px-ish; anything less and the frames cannot be seen at all

/**
 * Where an accept report waits out the page reload it causes.
 *
 * Registering a tileset or a background edits constants.js, and constants.js is a module this page
 * imports, so Vite reloads the editor - which is how the new entry reaches the tileset dropdown
 * without anybody restarting anything. The cost is that the report showing what just happened would
 * flash up and vanish. It is put here instead and shown again on the way back in.
 */
const REPORT_KEY = 'growop.editor.art-report';

export class Art {
  /**
   * @param root the container element
   * @param handlers { onRegistered() } - called after an accept that changed constants.js
   */
  constructor(root, handlers = {}) {
    this.root = root;
    this.handlers = handlers;
    this.packed = null; // the last repack: { kind, key, staged, audit, entry, png }
    this.raw = null; // the generation it came from, so it can be packed again differently
    this.busy = false;
    this.build();
    this.applyKind();
    this.refreshRaws();
    this.resumeReport();
  }

  /** Shows the report from an accept that reloaded the page, if this is the page it reloaded into. */
  resumeReport() {
    try {
      const saved = sessionStorage.getItem(REPORT_KEY);
      if (!saved) return;
      sessionStorage.removeItem(REPORT_KEY);
      this.report(JSON.parse(saved));
    } catch {
      // A blocked or full sessionStorage costs a message, not the accept that already happened.
    }
  }

  build() {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = 'Art';

    this.kind = document.createElement('select');
    this.kind.id = 'art-kind';
    for (const [name, def] of Object.entries(ART_KINDS)) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = def.label;
      this.kind.append(option);
    }
    this.kind.addEventListener('change', () => this.applyKind());

    this.key = document.createElement('input');
    this.key.id = 'art-key';
    this.key.type = 'text';
    this.key.placeholder = 'asset key, a-z 0-9 and dashes';

    this.description = document.createElement('textarea');
    this.description.id = 'art-description';
    this.description.rows = 3;
    this.description.maxLength = MAX_DESCRIPTION;
    this.description.placeholder = 'A fat grey aphid with a glossy shell, six legs, scuttling sideways.';

    this.params = document.createElement('div');
    this.params.className = 'fields';
    this.params.append(
      this.field('Frames', 'art-frames', 'number', { min: 1, max: 16 }),
      this.field('Frame W', 'art-frame-width', 'number', { min: 8, max: 256 }),
      this.field('Frame H', 'art-frame-height', 'number', { min: 8, max: 256 }),
      this.alignField(),
      this.field('Tile px', 'art-tile', 'number', { min: 8, max: 128 }),
      this.field('Scroll', 'art-factor', 'number', { min: 0, max: 1, step: 0.05 }),
    );

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.id = 'art-run';
    this.button.textContent = 'Generate this asset';
    this.button.addEventListener('click', () => this.generate());

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = COST_NOTE;

    this.status = document.createElement('p');
    this.status.className = 'note';

    this.preview = document.createElement('canvas');
    this.preview.id = 'art-preview';
    this.preview.hidden = true;

    this.table = document.createElement('table');
    this.table.className = 'audit';
    this.table.hidden = true;

    this.findings = document.createElement('ul');
    this.findings.className = 'problems';

    this.actions = document.createElement('div');
    this.actions.className = 'buttons';
    this.accept = this.action('Accept', 'art-accept', () => this.acceptIt());
    this.again = this.action('Repack', 'art-repack', () => this.repack());
    this.discard = this.action('Discard', 'art-discard', () => this.clear('Discarded. The raw generation is still in .art-raw.'));
    this.actions.append(this.accept, this.again, this.discard);
    this.showActions(false);

    // Everything ever generated, so a strip can be packed again at a different frame count without
    // paying for the picture twice. This is the whole reason .art-raw exists.
    const rawHeading = document.createElement('h2');
    rawHeading.textContent = 'Raw generations';
    this.raws = document.createElement('select');
    this.raws.id = 'art-raws';
    this.rawNote = document.createElement('p');
    this.rawNote.className = 'note';
    const rawButton = document.createElement('button');
    rawButton.type = 'button';
    rawButton.id = 'art-repack-raw';
    rawButton.textContent = 'Repack the selected one';
    rawButton.addEventListener('click', () => this.repack(this.raws.value));

    section.append(
      heading, this.labelled('Kind', this.kind), this.labelled('Key', this.key), this.description,
      this.params, this.button, note, this.status, this.preview, this.table, this.findings, this.actions,
      rawHeading, this.raws, rawButton, this.rawNote,
    );
    this.root.append(section);
  }

  labelled(text, control) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    const span = document.createElement('span');
    span.textContent = text;
    wrapper.append(span, control);
    return wrapper;
  }

  field(text, id, type, attributes) {
    const input = document.createElement('input');
    input.id = id;
    input.type = type;
    for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, String(value));
    const wrapper = this.labelled(text, input);
    wrapper.dataset.for = id;
    return wrapper;
  }

  alignField() {
    const input = document.createElement('select');
    input.id = 'art-align';
    for (const name of ALIGNMENTS) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      input.append(option);
    }
    const wrapper = this.labelled('Align', input);
    wrapper.dataset.for = 'art-align';
    return wrapper;
  }

  action(label, id, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  /** Shows the parameters this kind actually has, and fills them with its defaults. */
  applyKind() {
    const def = ART_KINDS[this.kind.value];
    const shown = {
      strip: ['art-frames', 'art-frame-width', 'art-frame-height', 'art-align'],
      tileset: ['art-tile'],
      single: ['art-factor'],
    }[def.mode];

    for (const wrapper of this.params.children) {
      wrapper.hidden = !shown.includes(wrapper.dataset.for);
    }
    for (const [name, value] of Object.entries(def.defaults)) {
      const input = this.params.querySelector(`#art-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
      if (input) input.value = String(value);
    }
    this.clear('');
  }

  /** What the panel is asking for, as the routes expect it. */
  request() {
    const def = ART_KINDS[this.kind.value];
    const value = (id) => Number(this.params.querySelector(`#${id}`).value);
    const wanted = { kind: this.kind.value, key: this.key.value.trim(), description: this.description.value };

    if (def.mode === 'strip') {
      wanted.frames = value('art-frames');
      wanted.frameWidth = value('art-frame-width');
      wanted.frameHeight = value('art-frame-height');
      wanted.align = this.params.querySelector('#art-align').value;
    } else if (def.mode === 'tileset') {
      wanted.tile = value('art-tile');
    } else {
      wanted.factor = value('art-factor');
    }
    return wanted;
  }

  say(message, severity = 'ok') {
    this.status.textContent = message;
    this.status.dataset.severity = severity;
  }

  setBusy(busy, message) {
    this.busy = busy;
    for (const button of [this.button, this.again, this.accept]) button.disabled = busy;
    this.button.textContent = busy ? 'Drawing...' : 'Generate this asset';
    if (message) this.say(message, 'warn');
  }

  showActions(showing, { canAccept = false } = {}) {
    this.actions.style.display = showing ? 'flex' : 'none';
    this.accept.hidden = !canAccept;
  }

  // ---------------------------------------------------------------- the three requests

  /** The one that costs money. One at a time, no retries, nothing automatic. */
  async generate() {
    if (this.busy) return null;
    const wanted = this.request();
    if (!/^[a-z0-9-]+$/.test(wanted.key)) {
      this.say('Give it a key first: a-z, 0-9 and dashes.', 'error');
      return null;
    }
    if (wanted.description.trim().length < 3) {
      this.say('Describe what the asset is first.', 'error');
      return null;
    }
    return this.post('/api/generate-art', wanted, 'Drawing it. This takes a minute or two...');
  }

  /** The one that does not. Packs a raw generation again, at whatever the boxes say now. */
  async repack(raw = this.raw) {
    if (this.busy) return null;
    if (!raw) {
      this.say('Nothing to repack: generate something, or pick a raw generation below.', 'error');
      return null;
    }
    return this.post('/api/repack-art', { ...this.request(), raw }, `Repacking ${raw}...`);
  }

  async post(url, body, busyMessage) {
    this.setBusy(true, busyMessage);
    this.showActions(false);
    this.findings.innerHTML = '';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error ?? `HTTP ${response.status}`);

      this.raw = answer.raw;
      const verdict = this.offer(answer);
      if (answer.model) {
        this.say(`${this.status.textContent} ${answer.model}, ${answer.size}, ${answer.seconds}s.`, this.status.dataset.severity);
      }
      await this.refreshRaws();
      return verdict;
    } catch (error) {
      this.say(`Could not do that: ${error.message}`, 'error');
      this.showActions(Boolean(this.raw), { canAccept: false });
      return null;
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Shows what came back and decides whether it may be accepted.
   *
   * Split out from the request so an audit can be judged without one, which is how the editor's own
   * checks exercise this - the same seam `offer()` gives the Generate panel.
   */
  offer(packed) {
    this.packed = packed;
    const { audit } = packed;
    this.drawPreview(packed);
    this.drawAudit(audit);

    const problems = [
      ...audit.flags.map((message) => ({ severity: 'error', message })),
      ...[...audit.notes, ...(packed.report ?? [])].map((message) => ({ severity: 'warn', message })),
    ];
    this.render(problems);

    const ok = audit.flags.length === 0;
    this.showActions(true, { canAccept: ok });
    if (ok) {
      this.say(`${packed.key}: ${audit.width}x${audit.height} in, ${audit.impliedFrames} of ${audit.expectedFrames} frames found, ${audit.transparentPercent}% transparent.`);
    } else {
      this.say('Not accepted: the audit flagged this. Repack it from the raw generation, or ask for it again.', 'error');
    }
    return { ok, key: packed.key, flags: audit.flags, audit };
  }

  /** Writes the asset, and registers it if that is something this kind can be. */
  async acceptIt() {
    if (!this.packed || this.busy) return null;
    const { audit, staged, key } = this.packed;
    this.setBusy(true, `Writing ${key}...`);
    try {
      const response = await fetch('/api/accept-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...this.request(), staged, flags: audit.flags }),
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error ?? `HTTP ${response.status}`);

      this.packed = null;
      this.showActions(false);
      if (answer.registered) {
        // Said before the reload rather than after, because the reload is moments away.
        try {
          sessionStorage.setItem(REPORT_KEY, JSON.stringify(answer));
        } catch {
          // Not worth failing an accept over; the report is shown now either way.
        }
        this.handlers.onRegistered?.(answer);
      }
      this.report(answer);
      return answer;
    } catch (error) {
      this.say(`Could not accept it: ${error.message}`, 'error');
      return null;
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * What landed, and what has not been done yet.
   *
   * The second half is the point. Art is the part of a new enemy that a panel can finish; the class
   * that makes it move and the entry that makes it worth points are code, and a panel that wrote the
   * file and said "done" would be telling somebody they had added an enemy when they had added a PNG.
   */
  report(answer) {
    this.findings.innerHTML = '';
    const lines = [{ severity: 'ok', message: `Wrote ${answer.written}.` }];

    if (answer.registered) {
      lines.push({ severity: 'ok', message: `Registered in ${answer.registered.where}: ${answer.registered.line}` });
      if (answer.registered.note) lines.push({ severity: 'warn', message: answer.registered.note });
      lines.push({ severity: 'ok', message: 'It is usable now. The editor reloads itself because constants.js changed.' });
    }
    for (const need of answer.needs ?? []) lines.push({ severity: 'warn', message: need });

    this.render(lines);
    this.say(
      answer.needs?.length > 0
        ? `${answer.key} is in the game's files, but not in the game yet: ${answer.needs.length} things still need writing.`
        : `${answer.key} is in and registered.`,
      answer.needs?.length > 0 ? 'warn' : 'ok',
    );
  }

  // ---------------------------------------------------------------- showing it

  /**
   * The packed sheet at 4x, with every frame boxed.
   *
   * The boxes are the only way to see the mistake that matters. A strip cut one frame short still
   * looks like a sprite sheet; what it looks like is a sprite sheet with half a leg in the next cell,
   * and that is visible the moment the cell edges are drawn on top of it.
   */
  drawPreview(packed) {
    const image = new Image();
    image.onload = () => {
      const scale = PREVIEW_SCALE;
      this.preview.width = image.width * scale;
      this.preview.height = image.height * scale;
      this.preview.hidden = false;

      const context = this.preview.getContext('2d');
      context.imageSmoothingEnabled = false;
      // A dark checker, so transparent pixels read as transparent rather than as black paint.
      for (let y = 0; y < this.preview.height; y += 8) {
        for (let x = 0; x < this.preview.width; x += 8) {
          context.fillStyle = ((x / 8 + y / 8) % 2 === 0) ? '#16241a' : '#101a13';
          context.fillRect(x, y, 8, 8);
        }
      }
      context.drawImage(image, 0, 0, this.preview.width, this.preview.height);

      const cell = packed.entry ?? {};
      const width = (cell.frameWidth ?? cell.tileWidth ?? image.width) * scale;
      const height = (cell.frameHeight ?? cell.tileHeight ?? image.height) * scale;
      context.strokeStyle = '#4cd137';
      context.lineWidth = 1;
      for (let y = 0; y < this.preview.height; y += height) {
        for (let x = 0; x < this.preview.width; x += width) {
          context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
        }
      }
    };
    image.src = packed.png;
  }

  /** The audit, as a table. Everything in it was measured off the PNG, not asked for. */
  drawAudit(audit) {
    const cells = audit.frames.map((frame) => `${frame.width}x${frame.height}`);
    const rows = [
      ['image', `${audit.width} x ${audit.height}`],
      ['alpha channel', audit.hasAlpha ? 'yes' : 'NO'],
      ['transparent', `${audit.transparentPercent}%`],
      audit.dividesEvenly === null ? null : ['width / frames', audit.dividesEvenly ? `even, ${audit.frameWidth}px each` : 'NOT EVEN'],
      audit.kind === 'tileset' ? ['grid', `${audit.columns} x ${audit.rows}`] : null,
      audit.kind === 'single' ? ['edge seam', `${audit.seamDifference} of 255`] : ['frames found', `${audit.impliedFrames} of ${audit.expectedFrames} expected`],
      ['cell', `${audit.cell.width} x ${audit.cell.height}`],
      ['content', cells.length > 6 ? `${cells.slice(0, 6).join('  ')} ...` : cells.join('  ')],
    ].filter(Boolean);

    this.table.innerHTML = '';
    for (const [name, value] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = name;
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(th, td);
      this.table.append(tr);
    }
    this.table.hidden = false;
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

  async refreshRaws() {
    try {
      const response = await fetch('/api/art-raw', { cache: 'no-store' });
      const { files = [] } = await response.json();
      this.raws.innerHTML = '';
      for (const file of files) {
        const option = document.createElement('option');
        option.value = file.name;
        option.textContent = `${file.name}  (${Math.round(file.bytes / 1024)}kB)`;
        this.raws.append(option);
      }
      if (this.raw) this.raws.value = this.raw;
      this.rawNote.textContent = files.length
        ? `${files.length} kept in .art-raw. Repacking one is free: change the boxes above and press Repack.`
        : 'Nothing generated yet. Whatever is generated is kept here, so it can be repacked without paying again.';
    } catch {
      this.rawNote.textContent = 'Could not read .art-raw.';
    }
  }

  clear(message) {
    this.packed = null;
    this.preview.hidden = true;
    this.table.hidden = true;
    this.findings.innerHTML = '';
    this.showActions(false);
    this.say(message ?? '');
  }
}
