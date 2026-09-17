import Phaser from 'phaser';
import { AUDIO, MUSIC, SOUNDS } from '../config/audio.js';

/**
 * The one place that talks to Phaser's sound system. Everything else calls Sfx.play('jump') and moves on.
 *
 * A sound whose file did not load is simply silent, the way missing art leaves a placeholder. Nothing
 * plays until the player's first tap or key press has unlocked the browser's audio (see unlock()), so no
 * sound is ever started against a suspended context, which browsers log a warning about. Music asked for
 * before that moment starts as soon as it arrives.
 *
 * The mute state lives in localStorage and is applied in init(), before anything can play.
 */
class SoundPlayer {
  constructor() {
    this.game = null;
    this.muted = false;
    this.unlocked = false;
    this.lastPlayedAt = new Map(); // sound key -> performance.now() of its last play, for minIntervalMs
    this.voices = new Map(); // sound key -> the single instance of a non-overlapping sound
    this.music = null;
    this.musicName = null;
    this.musicVolume = 0; // the track's own volume from MUSIC
    this.musicCurrent = 0; // where the ramp is now; kept here because a sound's gain reads back late while the context is starting
    this.wantedMusic = null; // the track asked for, kept so it can start once audio is unlocked
    this.ducking = 0; // how many ducking sounds are playing right now
    this.warned = new Set();
  }

  /** Called once at boot, before any sound is loaded or played. */
  init(game) {
    if (this.game) return;
    this.game = game;
    this.muted = readStoredMute();
    game.sound.mute = this.muted;

    // Not locked at all (audio already allowed, or no audio in this browser) means nothing to wait for.
    if (!game.sound.locked) this.unlocked = true;
    // Phaser also resumes the context on the first gesture anywhere on the page; follow its lead.
    game.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.unlock());
    game.events.on(Phaser.Core.Events.STEP, this.step, this);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** The files to load, one entry per sound, each offered in every format so the loader can pick. */
  files() {
    const urls = (name) => AUDIO.FORMATS.map((ext) => `${AUDIO.PATH}/${name}.${ext}`);
    return [
      ...Object.keys(SOUNDS).map((key) => ({ key, urls: urls(key) })),
      ...Object.values(MUSIC).map((def) => ({ key: def.file, urls: urls(def.file) })),
    ];
  }

  /** True when the sound's file loaded. Everything else about a sound is in SOUNDS. */
  isLoaded(key) {
    return Boolean(this.game) && this.game.cache.audio.exists(key);
  }

  /** Plays a sound effect. Silent if the sound is unknown, not loaded, rate-limited, or audio is still locked. */
  play(key) {
    if (key == null) return; // a thing with no sound configured
    const def = SOUNDS[key];
    if (!def) return this.warnOnce(`[audio] unknown sound "${key}"`);
    if (!this.unlocked || !this.isLoaded(key)) return;

    const now = performance.now();
    if (def.minIntervalMs && now - (this.lastPlayedAt.get(key) ?? -Infinity) < def.minIntervalMs) return;
    this.lastPlayedAt.set(key, now);

    const variation = def.pitchVariation ?? 0;
    const sound = def.overlap ? this.transient(key) : this.voice(key);
    sound.play({ volume: def.volume, rate: 1 + Phaser.Math.FloatBetween(-variation, variation) });
    if (def.duck) this.duckWhile(sound);
  }

  /** A fresh instance that removes itself when done, so quick repeats layer. */
  transient(key) {
    const sound = this.game.sound.add(key);
    sound.once(Phaser.Sound.Events.COMPLETE, sound.destroy, sound);
    return sound;
  }

  /** The one instance of a non-overlapping sound; playing it again restarts it. */
  voice(key) {
    let sound = this.voices.get(key);
    if (!sound) {
      sound = this.game.sound.add(key);
      this.voices.set(key, sound);
    }
    return sound;
  }

  /** Holds the music down while `sound` plays, however it ends. */
  duckWhile(sound) {
    this.ducking += 1;
    const release = () => {
      sound.off(Phaser.Sound.Events.COMPLETE, release);
      sound.off(Phaser.Sound.Events.STOP, release);
      sound.off(Phaser.Sound.Events.DESTROY, release);
      this.ducking -= 1;
    };
    sound.on(Phaser.Sound.Events.COMPLETE, release);
    sound.on(Phaser.Sound.Events.STOP, release);
    sound.on(Phaser.Sound.Events.DESTROY, release);
  }

  /** Starts a track from MUSIC, looping. Asking for the track already playing leaves it running. */
  playMusic(name) {
    const def = MUSIC[name];
    if (!def) return this.warnOnce(`[audio] unknown music "${name}"`);
    this.wantedMusic = name;
    if (!this.unlocked || (this.musicName === name && this.music)) return;

    this.dropMusic();
    if (!this.isLoaded(def.file)) return;
    this.musicName = name;
    this.musicVolume = def.volume;
    this.musicCurrent = this.musicTarget();
    this.music = this.game.sound.add(def.file, { loop: true, volume: this.musicCurrent });
    this.music.play();
  }

  stopMusic() {
    this.wantedMusic = null;
    this.dropMusic();
  }

  dropMusic() {
    if (this.music) {
      this.music.stop();
      this.music.destroy();
    }
    this.music = null;
    this.musicName = null;
  }

  musicTarget() {
    return this.musicVolume * (this.ducking > 0 ? AUDIO.DUCK_VOLUME : 1);
  }

  /** Every frame: eases the music toward its target volume, so ducking in and out is a short ramp, not a step. */
  step(time, delta) {
    if (!this.music) return;
    const target = this.musicTarget();
    const current = this.musicCurrent;
    if (current === target) return;
    const maxStep = (delta / AUDIO.DUCK_RAMP_MS) * this.musicVolume * (1 - AUDIO.DUCK_VOLUME);
    this.musicCurrent = current < target ? Math.min(target, current + maxStep) : Math.max(target, current - maxStep);
    this.music.setVolume(this.musicCurrent);
  }

  /**
   * Call from inside the first tap or key press. Browsers only let audio start after a gesture, so the
   * context is resumed here rather than at boot, and only from here on does anything play. Safe to repeat.
   */
  unlock() {
    if (!this.game || this.unlocked) return;
    this.unlocked = true;
    const context = this.game.sound.context;
    if (context && context.state === 'suspended') context.resume().catch(() => {});
    if (this.wantedMusic) this.playMusic(this.wantedMusic);
  }

  isMuted() {
    return this.muted;
  }

  /** Flips the mute, remembers it across visits, and tells the speaker icons via the "audio:muted" game event. */
  toggleMute() {
    this.muted = !this.muted;
    this.game.sound.mute = this.muted;
    writeStoredMute(this.muted);
    this.unlock(); // a toggle only ever comes from a key or a tap, so this is a gesture too
    this.game.events.emit('audio:muted', this.muted);
  }

  onKeyDown = (event) => {
    if (event.key.toLowerCase() === 'm' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.toggleMute();
    }
  };

  warnOnce(message) {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(message);
  }
}

function readStoredMute() {
  try {
    return localStorage.getItem(AUDIO.MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false; // storage blocked (private mode, sandboxed frame): sound stays on for this visit
  }
}

function writeStoredMute(muted) {
  try {
    localStorage.setItem(AUDIO.MUTE_STORAGE_KEY, String(muted));
  } catch {
    // nothing to do; the choice simply does not outlive this visit
  }
}

const Sfx = new SoundPlayer();
export default Sfx;
