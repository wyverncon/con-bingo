// View state: what this device is currently looking at. Never synced — shared
// sticker state lives in store.js (backed by sync.js / playhtml).
//
// Readability and stack mode persist per device: they are an accessibility
// preference, and spec open question 1 wants them chosen once and left alone.

import { ORDER } from "../data/theme.js";
import { currentDay, isFrozen, isPreOpen } from "./day.js";
import { TEXT_MODES, STACK_MODES } from "./cell.js";

const PREF_KEY = "dcb.prefs.v1";

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    return {
      textMode: TEXT_MODES.includes(p.textMode) ? p.textMode : "halo",
      stackMode: STACK_MODES.includes(p.stackMode) ? p.stackMode : "shrink"
    };
  } catch { return { textMode: "halo", stackMode: "shrink" }; }
}

const prefs = loadPrefs();

export const state = {
  today: currentDay(),        // the live card; refreshed at 4am rollover
  frozen: isFrozen(),         // the board has closed for good (ADR 0036)
  preOpen: isPreOpen(),       // the con has not opened yet; board is locked with a countdown
  day: currentDay(),          // the card being viewed (may be an archive day)
  textMode: prefs.textMode,
  stackMode: prefs.stackMode,
  filter: null,               // player name, or null
  favOnly: false,             // board shows favourites only (ADR 0026)
  activeSq: null,             // square awaiting an emoji pick
  sheet: null                 // "emoji" | "filter" | "archive" | "read" | null
};

const listeners = new Set();

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function set(patch) {
  Object.assign(state, patch);
  if ("textMode" in patch || "stackMode" in patch) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        textMode: state.textMode, stackMode: state.stackMode
      }));
    } catch { /* private mode */ }
  }
  for (const fn of listeners) fn();
}

// Archive days are view-only (spec section 8). This is the single check; every
// placement path must go through it.
//
// After the freeze (ADR 0036) every day is an archive day, including today's:
// the run is over and the whole board is the thing the group made. Scores,
// player lookup and the archive sheet are unaffected — nothing here hides a
// card, it only stops new stickers.
// preOpen also locks the whole board: before the con opens nothing may be
// placed, the same as after the freeze.
export function isReadOnly() { return state.preOpen || state.frozen || state.day !== state.today; }

// A day that has not opened yet. Both this and a past day are read-only, but
// they mean opposite things to a player: a past card is the thing the group
// made and must stay readable, while a future card is a locked door and should
// say when it opens. Only this one gets covered up.
export function isFuture() {
  return ORDER.indexOf(state.day) > ORDER.indexOf(state.today);
}

export function stepDay(n) {
  const i = ORDER.indexOf(state.day);
  const j = Math.max(0, Math.min(ORDER.length - 1, i + n));
  if (j !== i) set({ day: ORDER[j], filter: null, activeSq: null, sheet: null });
  return j !== i;
}
