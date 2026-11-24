// The save slot: one small JSON record in localStorage under SAVE_KEY holding the cash, how far
// the story has got, the total ever earned and the courier jobs done. Written when a mission or a
// job is completed; read by the title screen (which offers Continue when it exists); cleared by
// New Game. Storage can be unavailable (private windows, blocked cookies): then nothing is saved
// and the game simply plays on.
import { SAVE_KEY } from './config.js';
import { STORY_LENGTH } from './missions.js';

const VERSION = 1;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const wholeNumber = (value, max = Number.MAX_SAFE_INTEGER) => (Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null);

/** The saved progress { cash, storyIndex, totalEarned, jobsDone }, or null if there is none (or it is unreadable). */
export function loadSave() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return null;
    const save = {
      cash: wholeNumber(data.cash),
      storyIndex: wholeNumber(data.storyIndex, STORY_LENGTH),
      totalEarned: wholeNumber(data.totalEarned),
      jobsDone: wholeNumber(data.jobsDone),
    };
    return Object.values(save).every((value) => value !== null) ? save : null;
  } catch {
    return null;
  }
}

/** True when there is a save to continue. */
export function hasSave() {
  return loadSave() !== null;
}

/** Writes the world's progress to the slot. */
export function writeSave(world) {
  const store = storage();
  if (!store) return false;
  const stats = world.stats;
  const record = {
    version: VERSION,
    cash: Math.max(0, Math.round(stats.cash)),
    storyIndex: world.missions.storyIndex,
    totalEarned: Math.max(0, Math.round(stats.totalEarned)),
    jobsDone: stats.jobsDone,
  };
  try {
    store.setItem(SAVE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the saved progress (New Game). */
export function clearSave() {
  const store = storage();
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}
