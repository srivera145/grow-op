#!/usr/bin/env node
// Generates every sound effect and both music tracks for Grow Op, and encodes each one as .ogg and .m4a
// into public/audio. Everything is synthesized here from oscillators and noise, so the audio is original:
// there are no samples or third-party recordings to license. Output is deterministic (seeded noise), so
// re-running it produces the same files.
//
//   npm run audio          needs ffmpeg on the PATH (or set FFMPEG=/path/to/ffmpeg)
//
// To replace a sound with a recorded one, drop name.ogg and name.m4a into public/audio under the same name;
// nothing in the game needs to change.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RATE = 44100;
const OUT_DIR = 'public/audio';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

// ---------- synthesis primitives ----------

const TAU = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const buffer = (seconds) => new Float32Array(Math.ceil(seconds * RATE));

/** Seeded random numbers, so noise-based sounds come out identical on every run. */
function randomSource(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WAVES = {
  sine: (phase) => Math.sin(TAU * phase),
  triangle: (phase) => 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5),
  square: (phase, duty = 0.5) => (phase % 1 < duty ? 1 : -1),
};

/** Attack, exponential decay, and a short release so nothing clicks at the end. */
function envelope(t, duration, { attack = 0.004, release = 0.02, decay = 0 }) {
  return Math.min(1, t / attack) * Math.exp(-decay * t) * Math.min(1, Math.max(0, (duration - t) / release));
}

/**
 * Adds one tone to `out`. freq may be a number or a function of time in seconds (for slides and vibrato);
 * phase is accumulated so slides stay continuous.
 */
function tone(out, { start = 0, duration, freq, wave = 'square', duty = 0.5, volume = 0.5, ...env }) {
  const first = Math.floor(start * RATE);
  const count = Math.min(Math.floor(duration * RATE), out.length - first);
  const oscillator = WAVES[wave];
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    phase += (typeof freq === 'function' ? freq(t) : freq) / RATE;
    out[first + i] += oscillator(phase, duty) * volume * envelope(t, duration, env);
  }
}

/** Adds filtered white noise. cutoff (Hz) may be a function of time; highpass keeps what is above it instead. */
function noise(out, { start = 0, duration, cutoff = 4000, highpass = false, volume = 0.5, seed = 1, ...env }) {
  const first = Math.floor(start * RATE);
  const count = Math.min(Math.floor(duration * RATE), out.length - first);
  const random = randomSource(seed);
  let low = 0;
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const white = random() * 2 - 1;
    const fc = typeof cutoff === 'function' ? cutoff(t) : cutoff;
    low += (1 - Math.exp((-TAU * fc) / RATE)) * (white - low);
    out[first + i] += (highpass ? white - low : low) * volume * envelope(t, duration, env);
  }
}

const slide = (from, to, duration) => (t) => from * (to / from) ** Math.min(1, t / duration); // exponential pitch slide
const arpeggio = (out, notes, step, options) => notes.forEach((midi, i) => tone(out, { start: i * step, duration: step * 1.15, freq: hz(midi), ...options }));

/** Scales so the loudest sample sits at `peak`. */
function normalize(samples, peak) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max > 0) for (let i = 0; i < samples.length; i++) samples[i] *= peak / max;
  return samples;
}

// ---------- sound effects ----------
// Sounds that fire together are voiced apart so they layer instead of fighting: stomp is a low thump and
// enemy-death a higher pop; light-orb is a short chime and grow a longer rise; hurt is a harsh buzz and
// shrink a falling run.

const SFX = {
  jump: () => { const o = buffer(0.17); tone(o, { duration: 0.16, freq: slide(330, 700, 0.13), duty: 0.25, volume: 0.5, decay: 9 }); return o; },
  land: () => { const o = buffer(0.13); tone(o, { duration: 0.12, freq: slide(130, 55, 0.1), wave: 'sine', volume: 0.8, decay: 22 }); noise(o, { duration: 0.06, cutoff: 900, volume: 0.35, decay: 50, seed: 2 }); return o; },
  stomp: () => { const o = buffer(0.17); tone(o, { duration: 0.16, freq: slide(300, 80, 0.12), wave: 'triangle', volume: 0.9, decay: 14 }); noise(o, { duration: 0.05, cutoff: 1800, volume: 0.4, decay: 60, seed: 3 }); return o; },
  slash: () => { const o = buffer(0.2); noise(o, { duration: 0.19, cutoff: slide(7000, 900, 0.17), highpass: true, volume: 0.55, attack: 0.015, decay: 12, seed: 4 }); noise(o, { duration: 0.19, cutoff: slide(5000, 700, 0.17), volume: 0.5, attack: 0.02, decay: 14, seed: 5 }); return o; },
  'slash-hit': () => { const o = buffer(0.16); tone(o, { duration: 0.12, freq: slide(900, 260, 0.1), duty: 0.5, volume: 0.45, decay: 18 }); noise(o, { duration: 0.1, cutoff: 3500, volume: 0.6, decay: 30, seed: 6 }); return o; },
  'water-drop': () => { const o = buffer(0.16); tone(o, { duration: 0.15, freq: slide(1300, 2300, 0.05), wave: 'sine', volume: 0.7, decay: 26 }); return o; },
  'light-orb': () => { const o = buffer(0.3); arpeggio(o, [84, 88, 91, 96], 0.055, { duty: 0.125, volume: 0.4, decay: 10 }); return o; },
  grow: () => { const o = buffer(0.62); arpeggio(o, [60, 64, 67, 72, 76, 79, 84, 88], 0.065, { wave: 'triangle', volume: 0.6, decay: 5 }); arpeggio(o, [72, 76, 79, 84, 88, 91, 96, 100], 0.065, { duty: 0.25, volume: 0.18, decay: 6 }); return o; },
  nutrient: () => { const o = buffer(0.9); for (let r = 0; r < 3; r++) [72, 76, 79, 84].forEach((m, i) => tone(o, { start: r * 0.26 + i * 0.06, duration: 0.09, freq: (t) => hz(m + r * 2) * (1 + 0.01 * Math.sin(TAU * 14 * t)), duty: 0.25, volume: 0.42, decay: 6 })); return o; },
  hurt: () => { const o = buffer(0.26); tone(o, { duration: 0.24, freq: slide(240, 95, 0.2), duty: 0.5, volume: 0.5, decay: 7 }); noise(o, { duration: 0.12, cutoff: 1200, volume: 0.35, decay: 25, seed: 7 }); return o; },
  shrink: () => { const o = buffer(0.5); arpeggio(o, [88, 84, 79, 76, 72, 67, 64, 60], 0.055, { wave: 'triangle', volume: 0.6, decay: 5 }); return o; },
  die: () => { const o = buffer(1.0); tone(o, { duration: 0.7, freq: (t) => slide(520, 120, 0.7)(t) * (1 + 0.03 * Math.sin(TAU * 9 * t)), duty: 0.25, volume: 0.5, decay: 1.5 }); tone(o, { start: 0.68, duration: 0.3, freq: hz(36), wave: 'triangle', volume: 0.7, decay: 6 }); return o; },
  'enemy-death': () => { const o = buffer(0.15); tone(o, { duration: 0.1, freq: slide(760, 240, 0.08), wave: 'sine', volume: 0.7, decay: 20 }); noise(o, { duration: 0.12, cutoff: 5000, highpass: true, volume: 0.22, decay: 28, seed: 8 }); return o; },
  'root-rot-split': () => { const o = buffer(0.32); for (const [start, from] of [[0, 210], [0.09, 170]]) tone(o, { start, duration: 0.16, freq: slide(from, from / 2.4, 0.13), wave: 'sine', volume: 0.75, decay: 12 }); noise(o, { duration: 0.28, cutoff: slide(1600, 300, 0.25), volume: 0.4, attack: 0.01, decay: 9, seed: 9 }); return o; },
  'jar-close': () => { const o = buffer(0.42); tone(o, { duration: 0.1, freq: slide(150, 70, 0.08), wave: 'sine', volume: 0.8, decay: 25 }); for (const f of [2093, 3136, 4186]) tone(o, { start: 0.03, duration: 0.36, freq: f, wave: 'sine', volume: 0.22, decay: 11 }); return o; },
  'level-complete': () => { const o = buffer(1.9); [72, 76, 79, 84].forEach((m, i) => tone(o, { start: i * 0.13, duration: 0.15, freq: hz(m), duty: 0.25, volume: 0.4, decay: 3 })); for (const m of [84, 88, 91]) tone(o, { start: 0.52, duration: 1.3, freq: (t) => hz(m) * (1 + 0.004 * Math.sin(TAU * 6 * t)), duty: 0.25, volume: 0.24, decay: 1.6, release: 0.3 }); tone(o, { start: 0.52, duration: 1.3, freq: hz(48), wave: 'triangle', volume: 0.5, decay: 1.4, release: 0.3 }); return o; },
  'game-over': () => { const o = buffer(2.1); [67, 65, 63, 62].forEach((m, i) => tone(o, { start: i * 0.3, duration: 0.32, freq: hz(m), duty: 0.25, volume: 0.4, decay: 2.5 })); for (const m of [48, 55, 60]) tone(o, { start: 1.2, duration: 0.85, freq: hz(m), wave: 'triangle', volume: 0.4, decay: 1.8, release: 0.3 }); return o; },
  'menu-select': () => { const o = buffer(0.12); tone(o, { duration: 0.05, freq: hz(81), duty: 0.25, volume: 0.4, decay: 8 }); tone(o, { start: 0.045, duration: 0.07, freq: hz(88), duty: 0.25, volume: 0.4, decay: 10 }); return o; },
};

// ---------- music ----------
// Tracks are written as steps: a MIDI note number starts a note, -1 holds the previous one, 0 is a rest.
// Anything that rings past the end of the loop is folded back onto the start, so the loop point is seamless.

function sequence(out, steps, stepSeconds, options, gate = 0.9) {
  steps.forEach((midi, i) => {
    if (midi <= 0) return;
    let length = 1;
    while (steps[i + length] === -1) length++;
    tone(out, { start: i * stepSeconds, duration: length * stepSeconds * gate, freq: hz(midi), ...options });
  });
}

function foldLoop(samples, loopSeconds) {
  const length = Math.round(loopSeconds * RATE);
  for (let i = length; i < samples.length; i++) samples[i - length] += samples[i];
  return samples.slice(0, length);
}

const CHORDS = { C: [48, 60, 64, 67], G: [43, 59, 62, 67], Am: [45, 57, 60, 64], F: [41, 57, 60, 65], Em: [40, 59, 64, 67] };

function levelTrack() {
  const step = 60 / 140 / 2; // eighth notes at 140 BPM
  const bars = ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'G'];
  const lead = [
    [79, 76, 72, 76, 79, -1, 84, -1], [83, -1, 81, 79, 74, -1, 79, -1], [81, 76, 72, 76, 81, -1, 84, -1], [81, -1, 79, 77, 81, 79, 77, 76],
    [79, 76, 72, 76, 79, -1, 84, -1], [86, -1, 83, 79, 83, -1, 86, -1], [88, -1, 84, 81, 84, -1, 88, -1], [89, 88, 86, 84, 81, -1, 79, -1],
    [81, -1, -1, 84, 81, -1, 77, -1], [83, -1, -1, 86, 83, -1, 79, -1], [79, -1, -1, 83, 79, -1, 76, -1], [81, -1, 79, 76, 81, -1, -1, 0],
    [81, -1, 84, -1, 89, -1, 84, 81], [83, -1, 86, -1, 91, -1, 86, 83], [84, -1, 79, 76, 84, -1, 88, -1], [86, -1, 83, 79, 74, 79, 83, 86],
  ].flat();
  const loop = bars.length * 8 * step;
  const out = buffer(loop + 1);
  sequence(out, lead, step, { duty: 0.25, volume: 0.3, decay: 2.5 });
  bars.forEach((name, bar) => {
    const [root, ...upper] = CHORDS[name];
    const at = bar * 8 * step;
    const bass = buffer(8 * step + 0.2);
    sequence(bass, [root, -1, 0, root, root + 12, -1, root + 7, 0], step, { wave: 'triangle', volume: 0.55, decay: 2 });
    const sparkle = buffer(8 * step + 0.2);
    sequence(sparkle, Array.from({ length: 16 }, (_, i) => [...upper, upper[0] + 12][i % 4] + 12), step / 2, { duty: 0.125, volume: 0.09, decay: 12 });
    for (let i = 0; i < bass.length; i++) out[Math.floor(at * RATE) + i] += bass[i] + sparkle[i];
    for (let beat = 0; beat < 4; beat++) {
      const start = at + beat * 2 * step;
      if (beat % 2 === 0) tone(out, { start, duration: 0.14, freq: slide(130, 45, 0.1), wave: 'sine', volume: 0.6, decay: 16 });
      else noise(out, { start, duration: 0.12, cutoff: 2600, volume: 0.3, decay: 26, seed: 11 });
      for (const off of [0, step]) noise(out, { start: start + off, duration: 0.04, cutoff: 7000, highpass: true, volume: off ? 0.07 : 0.11, decay: 70, seed: 12 });
    }
  });
  return foldLoop(out, loop);
}

function titleTrack() {
  const step = 60 / 100 / 2; // eighth notes at 100 BPM
  const bars = ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'];
  const lead = [
    [72, -1, 77, -1, 81, -1, -1, 79], [79, -1, 74, -1, 83, -1, -1, 81], [79, -1, 76, -1, 83, -1, -1, 79], [81, -1, -1, -1, 76, -1, 72, -1],
    [77, -1, 81, -1, 84, -1, -1, 81], [79, -1, 83, -1, 86, -1, -1, 83], [84, -1, -1, 79, 76, -1, 79, -1], [72, -1, -1, -1, 74, -1, 76, -1],
  ].flat();
  const loop = bars.length * 8 * step;
  const out = buffer(loop + 2);
  sequence(out, lead, step, { wave: 'triangle', volume: 0.42, decay: 1.2, attack: 0.02, release: 0.08 }, 1);
  bars.forEach((name, bar) => {
    const [root, ...upper] = CHORDS[name];
    const start = bar * 8 * step;
    for (const midi of upper) tone(out, { start, duration: 8 * step + 0.5, freq: hz(midi), wave: 'sine', volume: 0.1, attack: 0.35, release: 0.6 });
    tone(out, { start, duration: 6 * step, freq: hz(root), wave: 'triangle', volume: 0.4, decay: 1, attack: 0.02, release: 0.2 });
    upper.forEach((midi, i) => tone(out, { start: start + (i * 2 + 2) * step, duration: 0.5, freq: hz(midi + 12), duty: 0.125, volume: 0.05, decay: 7 }));
  });
  return foldLoop(out, loop);
}

const MUSIC = { 'music-level': levelTrack, 'music-title': titleTrack };
const MUSIC_MAX_BYTES = 1024 * 1024;

// ---------- encoding ----------

function wavBytes(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return data;
}

/** Safari cannot play Ogg Vorbis, and AAC is patchy in some Firefox setups, so every sound ships as both. */
function encode(name, samples, { music }) {
  const wav = path.join(os.tmpdir(), `growop-${name}.wav`);
  fs.writeFileSync(wav, wavBytes(samples));
  const common = ['-y', '-loglevel', 'error', '-i', wav, '-map_metadata', '-1', '-ac', '1'];
  const targets = { ogg: ['-c:a', 'libvorbis', '-q:a', music ? '4' : '5'], m4a: ['-c:a', 'aac', '-b:a', music ? '96k' : '128k', '-movflags', '+faststart'] };
  const sizes = {};
  for (const [extension, options] of Object.entries(targets)) {
    const file = path.join(OUT_DIR, `${name}.${extension}`);
    execFileSync(FFMPEG, [...common, ...options, file], { stdio: ['ignore', 'inherit', 'inherit'] });
    sizes[extension] = fs.statSync(file).size;
  }
  fs.rmSync(wav);
  return sizes;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let failed = false;
  for (const [table, music] of [[SFX, false], [MUSIC, true]]) {
    for (const [name, make] of Object.entries(table)) {
      const samples = normalize(make(), music ? 0.7 : 0.8);
      const sizes = encode(name, samples, { music });
      const tooBig = music && Math.max(sizes.ogg, sizes.m4a) > MUSIC_MAX_BYTES;
      failed ||= tooBig;
      const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`.padStart(9);
      console.log(`${name.padEnd(16)} ${(samples.length / RATE).toFixed(2).padStart(6)} s   ogg ${kb(sizes.ogg)}   m4a ${kb(sizes.m4a)}${tooBig ? '   OVER 1 MB' : ''}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { SFX, MUSIC };
