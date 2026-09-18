import { GRADES, SAVE } from '../config/constants.js';
import { gradeFor, maxScoreForLevel } from './levelScore.js';

/**
 * Everything that outlives a refresh, apart from the mute flag (Sfx owns that one).
 *
 * One namespaced key holds one JSON object: a schema version, two global counters and a table of
 * per-level records. Results only. Nothing here is mid-level progress, so discarding the whole file
 * is always safe, and that is what happens when it is unreadable, unparseable or another version.
 *
 * Every read goes through here and always returns a usable value, so a blocked localStorage (private
 * browsing, a sandboxed frame, storage switched off in devtools) costs the player their records and
 * nothing else. Storage failing is a normal state, not an error, so none of it is logged.
 */

/** A level's records before it has ever been completed. */
function emptyLevelBest() {
  return { score: 0, grade: null, timeMs: 0, drops: 0, completions: 0 };
}

/** A save file with nothing in it. */
function emptySave() {
  return { version: SAVE.VERSION, plays: 0, completed: false, levels: {} };
}

/** A stored count, or null if what was in the file is not one. Every number here is a whole count. */
function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** A count coming from the running game (a clock reading is fractional), made safe to store. */
function toCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Grades are stored by name and looked up in GRADES when shown, so recolouring one needs no migration. */
function knownGrade(name) {
  return GRADES.some((grade) => grade.name === name) ? name : null;
}

/** Rebuilds the save from whatever was in storage, keeping only the fields that have the right shape. */
function sanitise(data) {
  const save = emptySave();
  save.plays = count(data.plays) ?? 0;
  save.completed = data.completed === true;

  const levels = data.levels && typeof data.levels === 'object' ? data.levels : {};
  for (const [key, entry] of Object.entries(levels)) {
    if (!entry || typeof entry !== 'object') continue;
    const best = {
      score: count(entry.score),
      grade: knownGrade(entry.grade),
      timeMs: count(entry.timeMs),
      drops: count(entry.drops),
      completions: count(entry.completions),
    };
    // One bad count and the whole record is untrustworthy, so it goes rather than being half believed:
    // a record kept with its numbers zeroed would show up on the title screen as a best of 000000.
    // An unrecognised grade is not disqualifying; it is the one field the screens can do without.
    if (best.score === null || best.timeMs === null || best.drops === null || best.completions === null) continue;
    save.levels[key] = best;
  }
  // Having finished a level cannot outlive the records that prove it.
  save.completed = save.completed && Object.values(save.levels).some((entry) => entry.completions > 0);
  return save;
}

/** The stored save, or null if there is none, it cannot be read, it is not JSON, or it is another version. */
function readStored() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE.STORAGE_KEY);
  } catch {
    return null; // storage blocked: this visit keeps nothing and says nothing
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE.VERSION) return null;
    return sanitise(parsed);
  } catch {
    return null; // corrupt: start fresh, and the next write replaces it
  }
}

class SaveStore {
  constructor() {
    // Kept in memory as well as in storage, so records still work within a visit when writes fail.
    this.data = readStored() ?? emptySave();
  }

  write() {
    try {
      localStorage.setItem(SAVE.STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // full, blocked or disabled: the record simply does not outlive this visit
    }
  }

  /**
   * A level's records. Always an object; completions is 0 when the level has never been finished.
   *
   * The grade is recomputed from the stored score rather than read back, because a grade is a percentage
   * of the level's maximum and that maximum can change when the level does. The stored score keeps its
   * meaning either way, so an old save shows the grade its score earns now, not the one it earned then.
   */
  getLevelBest(levelKey) {
    const levels = this.data.levels;
    const best = Object.prototype.hasOwnProperty.call(levels, levelKey) ? { ...levels[levelKey] } : emptyLevelBest();
    best.grade = best.completions > 0 ? gradeFor(best.score, maxScoreForLevel(levelKey)).name : null;
    return best;
  }

  /**
   * Global counters: level attempts started, whether one was ever finished, and how many finishes there
   * have been in total. `completions` counts finishes across every level, not how many distinct levels
   * have been cleared, so finishing 1-1 four times counts four.
   */
  getTotals() {
    const completions = Object.values(this.data.levels).reduce((total, entry) => total + entry.completions, 0);
    return { plays: this.data.plays, completed: this.data.completed, completions };
  }

  /** The best result across every level, for the title screen. null until a level has been completed. */
  best() {
    let best = null;
    for (const levelKey of Object.keys(this.data.levels)) {
      const entry = this.getLevelBest(levelKey); // via getLevelBest, so its grade is recomputed too
      if (entry.completions > 0 && (!best || entry.score > best.score)) best = entry;
    }
    return best;
  }

  /** Whether there is anything a reset would clear. */
  hasData() {
    return this.data.plays > 0 || this.data.completed || Object.keys(this.data.levels).length > 0;
  }

  /** Counts one level attempt. Called as a level starts, so a replay and a Next each count. */
  recordPlay() {
    this.data.plays += 1;
    this.write();
  }

  /**
   * Files a finished run and returns what it beat: `previous` is the record table as it was on arrival
   * (what the grade screen shows beside the new result), `records` says which of the three fell, and
   * `hadPrevious` is false on a first completion, where there was no record to beat.
   */
  recordCompletion(levelKey, result) {
    const previous = this.getLevelBest(levelKey);
    const hadPrevious = previous.completions > 0;
    const score = toCount(result.score);
    const timeMs = toCount(result.timeMs);
    const drops = toCount(result.drops);

    const records = {
      score: !hadPrevious || score > previous.score,
      timeMs: !hadPrevious || timeMs < previous.timeMs, // the only record where lower wins
      drops: !hadPrevious || drops > previous.drops,
    };

    this.data.levels[levelKey] = {
      // The grade follows the score: it is a function of it, so they can never disagree.
      score: records.score ? score : previous.score,
      grade: records.score ? knownGrade(result.grade) : previous.grade,
      timeMs: records.timeMs ? timeMs : previous.timeMs,
      drops: records.drops ? drops : previous.drops,
      completions: previous.completions + 1,
    };
    this.data.completed = true;
    this.write();

    return { previous, records, hadPrevious };
  }

  /** Clears everything, in memory and in storage. The title screen's reset option is the only caller. */
  reset() {
    this.data = emptySave();
    try {
      localStorage.removeItem(SAVE.STORAGE_KEY);
    } catch {
      // nothing stored to remove, or storage is blocked; the in-memory data is cleared either way
    }
  }
}

const Save = new SaveStore();
export default Save;
