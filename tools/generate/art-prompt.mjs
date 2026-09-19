import { TILE_SIZE } from '../../src/config/constants.js';

/**
 * What an image model is told before it draws an asset.
 *
 * There are two halves to a request and they are not equal. The description is the subject - what the
 * thing is, what it does, what it looks like - and it comes from whoever is sitting in the editor. The
 * style is how Grow Op's art is drawn, and it does not come from them: it is the same block for every
 * asset, it is appended after the description, and it says so. A description reading "smooth 3D render
 * on a white background" is a description of a spider mite that will be drawn in this style anyway.
 *
 * That is not politeness about instructions. Every one of these rules is load-bearing downstream:
 * tools/repack.py finds frames by looking for transparent columns between them, scales each frame off
 * its own alpha bounds, and hardens edge pixels on the way down. Art on a white background has no
 * columns to find and no bounds to measure, so it does not come out as a wonky sprite - it comes out
 * as four crops of a white rectangle.
 */

/**
 * The palette, sampled from the art already in public/assets rather than chosen.
 *
 * The greens and browns are the most common opaque colours across every sheet and tileset in the game,
 * quantised and counted; the accents are the ones constants.js and the editor already name (GRADES,
 * PLAYER.INVINCIBLE_TINTS, the object colours in editor/format.js). Re-export the art and these drift;
 * they are written down because an image model cannot be handed a PNG to eyedrop.
 */
export const PALETTE = {
  outline: ['#000000', '#001000'],
  leaf: ['#209010', '#30a010', '#40b010', '#50b010', '#4cd137'],
  soil: ['#402010', '#704020', '#906030', '#a06030', '#b07030', '#c08040'],
  accent: ['#ffd60a', '#e8443a', '#c77dff', '#4cc9f0'],
  highlight: ['#f0f0f0'],
};

const swatches = (name) => `${name}: ${PALETTE[name].join(' ')}`;

/**
 * The rules the repacker depends on. Never abridged, never overridden, and last in the prompt so it is
 * the most recent thing said.
 */
function style() {
  return [
    'HOUSE STYLE - these are requirements, not preferences, and they override anything in the subject',
    'description above that contradicts them:',
    '',
    '  - Fully transparent background. Not white, not a colour, not a checkerboard drawn to look like',
    '    transparency: actual alpha, zero everywhere the art is not.',
    '  - Pixel art. Hard pixel edges, no anti-aliasing, no soft shadows, no gradients, no blur, no glow.',
    '    Every pixel is either the colour or nothing.',
    '  - A 1px dark outline around every shape, in a near-black that reads against the colour it borders.',
    '  - A small flat palette, no more than about eight colours in the asset, drawn from these:',
    `      ${swatches('outline')}`,
    `      ${swatches('leaf')}`,
    `      ${swatches('soil')}`,
    `      ${swatches('accent')}`,
    `      ${swatches('highlight')}`,
    '  - Side view, straight on, the way a 2D platformer is drawn. Not three-quarter, not isometric,',
    '    not perspective.',
    '  - Nothing around the art: no frame, no border, no drop shadow, no label, no caption, no grid',
    '    lines, no colour swatches, no text of any kind anywhere in the image.',
  ].join('\n');
}

/** The extra rules a horizontal animation strip has to follow, which are the ones most often dropped. */
function stripRules(frames) {
  return [
    `LAYOUT - one horizontal strip of exactly ${frames} frames, left to right, and nothing else:`,
    '',
    `  - ${frames} frames in one row. Not a grid, not ${frames} separate images, not a sheet with two rows.`,
    '  - Evenly spaced: every frame gets the same width, and each one is centred in its own share of it.',
    '  - Fully transparent columns between the frames, so one frame never touches the next. That gap is',
    '    how the frames are found; without it they are one wide drawing and get cut in the wrong places.',
    '  - The same character at the same scale in every frame. It is one thing moving, not several',
    '    drawings of a similar thing, and it must not grow or shrink across the strip.',
    '  - Feet on the bottom row. Whatever stands on the ground touches the bottom edge of its frame in',
    '    every frame, so the animation does not bob when the game draws it standing still.',
    '  - The motion reads as a loop: the last frame leads back into the first.',
  ].join('\n');
}

/** And the rules a 3x3 edge tileset has to follow, which is a much stricter shape than "some tiles". */
function tilesetRules(tile) {
  return [
    'LAYOUT - exactly 9 tiles in a 3x3 grid, and nothing else:',
    '',
    '  - Three rows of three, evenly spaced, with fully transparent gaps between every tile so each one',
    '    can be found on its own.',
    '  - Every tile is square and they are all the same size.',
    `  - They are one terrain seen from the front, cut into the nine pieces an edge set needs. Read left`,
    '    to right, top to bottom, they are:',
    '        top-left corner    top edge      top-right corner',
    '        left edge          middle fill   right edge',
    '        bottom-left corner bottom edge   bottom-right corner',
    '  - An edge piece is the terrain with its surface along that side: the top row has the surface',
    '    along the top, the left column along the left, and so on. The middle tile is solid fill with',
    '    no surface at all, because it is only ever seen buried.',
    '  - They must tile seamlessly: the right edge of one piece has to line up with the left edge of the',
    '    piece that sits beside it, with no seam and no highlight stopping short.',
    `  - Each tile is drawn to fill its square completely, edge to edge. The game draws them at`,
    `    ${tile}x${tile} pixels butted up against each other, so any transparent margin inside a tile`,
    '    becomes a visible gap in the floor.',
  ].join('\n');
}

/** A parallax layer is one image, and the rule that matters is that it repeats. */
function parallaxRules() {
  return [
    'LAYOUT - one single image, not a strip and not a grid:',
    '',
    '  - It is a background layer that scrolls behind the level, so it has to tile horizontally: the',
    '    right-hand edge must continue seamlessly into the left-hand edge with no visible join.',
    '  - It is scenery, far behind the action. Nothing in it should read as something to stand on, and',
    '    nothing in it should be more eye-catching than the gameplay in front of it.',
    '  - Darker and lower contrast than a sprite. It sits behind everything and must never compete.',
    '  - No characters, no pickups, no platforms.',
  ].join('\n');
}

/**
 * The kinds of asset the Art panel can ask for, and what each one means everywhere downstream.
 *
 * One definition, imported by the panel for its defaults and by the dev server for its validation, so
 * "what is an enemy" cannot be answered two different ways on the two sides of the route.
 *
 *  - `dir` is where an accepted asset is written, under public/assets.
 *  - `mode` is which repack.py mode packs it.
 *  - `registers` is what accepting can do as data. `null` means nothing: the art lands, and code has
 *    to be written before the game knows about it.
 *  - `needs` is that code, named file by file, and shown on accepting. It is not a nag. A pickup whose
 *    name never reaches objectValues() in levelScore.js scores zero, which quietly lowers the maximum
 *    of every level containing it and hands out Exotic grades that were not earned.
 *  - `size` is what the image model is asked for. Strips want the widest shape available so each frame
 *    gets as many pixels as possible before being scaled down to a 32px-ish cell.
 */
export const ART_KINDS = {
  parallax: {
    label: 'Parallax background',
    dir: 'assets/bg',
    mode: 'single',
    size: '1536x1024',
    registers: 'PARALLAX',
    needs: [],
    defaults: { factor: 0.3 },
    rules: parallaxRules,
  },
  tileset: {
    label: 'Tileset',
    dir: 'assets/tiles',
    mode: 'tileset',
    size: '1024x1024',
    registers: 'TILESETS',
    needs: [],
    defaults: { tile: TILE_SIZE },
    rules: ({ tile }) => tilesetRules(tile),
  },
  enemy: {
    label: 'Enemy',
    dir: 'assets/sheets',
    mode: 'strip',
    size: '1536x1024',
    registers: null,
    needs: [
      'src/config/animations.js - an entry for this sheet key, giving its frame count, frame rate and whether it loops. Without one the strip is never even requested.',
      'src/objects/enemies/<Name>.js - an enemy class saying how it moves and what it does when stomped, next to SpiderMite.js, FungusGnat.js and RootRot.js, and spawned from GameScene.spawnObjects.',
      'src/state/levelScore.js - the new name in objectValues(), or every level containing one grades against a maximum that is too low and hands out grades nobody earned.',
      'src/editor/format.js - an OBJECT_TYPES entry, so it can be placed in the editor at all.',
      'tools/generate/parse.mjs - a letter in LETTERS, so a generated level may contain one.',
    ],
    defaults: { frames: 4, frameWidth: 40, frameHeight: 32, align: 'bottom' },
    rules: ({ frames }) => stripRules(frames),
  },
  pickup: {
    label: 'Pickup',
    dir: 'assets/sheets',
    mode: 'strip',
    size: '1536x1024',
    registers: null,
    needs: [
      'src/config/animations.js - an entry for this sheet key, giving its frame count, frame rate and whether it loops. Without one the strip is never even requested.',
      'src/objects/Pickup.js and GameScene.onPickup - what collecting one does, and PICKUPS in constants.js for its hitbox and what it is worth.',
      'src/state/levelScore.js - the new name in objectValues(), or every level containing one grades against a maximum that is too low and hands out grades nobody earned.',
      'src/editor/format.js - an OBJECT_TYPES entry, so it can be placed in the editor at all.',
      'tools/generate/parse.mjs - a letter in LETTERS, so a generated level may contain one.',
    ],
    defaults: { frames: 4, frameWidth: 32, frameHeight: 32, align: 'center' },
    rules: ({ frames }) => stripRules(frames),
  },
  effect: {
    label: 'Effect',
    dir: 'assets/sheets',
    mode: 'strip',
    size: '1536x1024',
    registers: null,
    needs: [
      'src/config/animations.js - an entry for this sheet key, giving its frame count, frame rate and whether it loops. Without one the strip is never even requested.',
      'src/objects/effects.js - where it is played from. An effect nothing triggers is a sheet that loads and never shows.',
    ],
    defaults: { frames: 4, frameWidth: 32, frameHeight: 32, align: 'center' },
    rules: ({ frames }) => stripRules(frames),
  },
};

export const ART_KIND_NAMES = Object.keys(ART_KINDS);

/**
 * How a strip's frames are placed in their cells, named exactly as tools/repack.py names them. The
 * list is here rather than in the panel so the server can check a request against the same four words
 * the repacker will be handed.
 */
export const ALIGNMENTS = ['bottom', 'center', 'strip', 'norm'];

/** The longest description worth sending. Past this it is a brief, and a brief is not a subject. */
export const MAX_DESCRIPTION = 600;

/**
 * Flattens a description to one paragraph of plain text.
 *
 * Line breaks and backticks are removed rather than escaped because this is quoted inside a prompt as
 * the subject of the picture: something that arrives looking like a new section heading, or a fenced
 * block, reads as a new instruction rather than as part of the sentence it was typed into.
 */
export function cleanDescription(description) {
  return String(description ?? '')
    .replace(/[`\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

/**
 * The whole request for one asset.
 *
 * The order is deliberate and is the one thing in here worth not rearranging: what it is, then what
 * shape it has to come back in, then the house style. The description goes first because it is the
 * subject and the rest of the prompt is about how to draw that subject; the style goes last because
 * the last thing said is the thing most likely to be obeyed, and it is the half that is not negotiable.
 */
export function buildArtPrompt({ kind, description, frames, tile } = {}) {
  const def = ART_KINDS[kind];
  if (!def) throw new Error(`"${kind}" is not an asset kind. Try one of: ${ART_KIND_NAMES.join(', ')}`);

  const subject = cleanDescription(description);
  if (subject.length < 3) throw new Error('describe what the asset is in a few words first');

  const label = def.label.toLowerCase();
  const prompt = [
    `A single Grow Op game asset: ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label} for a 2D pixel-art`,
    'side-scrolling platformer set in a cannabis grow room.',
    '',
    'SUBJECT - what to draw:',
    '',
    `  ${subject}`,
    '',
    'That line describes the subject only. Everything below is how Grow Op is drawn and applies whatever',
    'the subject says.',
    '',
    def.rules({ frames: frames ?? def.defaults.frames, tile: tile ?? def.defaults.tile }),
    '',
    style(),
  ].join('\n');

  return { prompt, size: def.size, kind, subject };
}
