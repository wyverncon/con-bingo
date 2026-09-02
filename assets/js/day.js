// Which con day's card is live right now (spec section 3).
//
// Rollover is 4:00am EASTERN, not midnight: DragonCon programming runs deep
// into the night, and a midnight rollover would split one night's activity
// across two cards.
//
// Eastern is handled via Intl, not a fixed UTC offset - the con straddles
// Labor Day weekend, which is inside US daylight saving time, and hardcoding
// -0500 or -0400 would silently shift the rollover by an hour.

import { ORDER } from "../data/theme.js";
import { isBeta } from "./edition.js";

// Calendar dates of the 2026 con, in Eastern local time. Thursday first.
// The beta runs a different, shorter weekend; see below.
// UPDATE THESE if the con dates change.
const REAL_CON_DATES = {
  thu: "2026-09-03",
  fri: "2026-09-04",
  sat: "2026-09-05",
  sun: "2026-09-06",
  mon: "2026-09-07",
};

// The beta weekend. Everything else about the rollover is identical, which is
// the point: the beta exercises the same 4am boundary the con will use, and
// the daily cap keeps resetting for free (ADR 0014).
// UPDATE THESE to move the beta to a different weekend.
const BETA_DATES = {
  fri: "2026-08-28",
  sat: "2026-08-29",
  sun: "2026-08-30",
};

export const CON_DATES = isBeta ? BETA_DATES : REAL_CON_DATES;

// When the board closes for good (ADR 0036). Eastern wall clock, "YYYY-MM-DD
// HH:MM", inclusive: at or after this instant the whole board is read-only on
// every card, not just the ones that are not today.
//
// This is a closing time, not a lock. It is client-side, so a tab left open on
// old code can still write to the room; what actually ends tampering is the
// export and an archive build with no room in it. The freeze exists so the
// board stops accepting play on its own, with nobody awake to press anything.
//
// It ships BEFORE the event it ends, on purpose. Code written on the Monday is
// code that is not there.
const REAL_CON_FREEZE = "2026-09-08 00:00";  // midnight ending con Monday
const BETA_FREEZE = "2026-08-31 00:01";      // the Monday after the beta weekend

export const FREEZE_AT = isBeta ? BETA_FREEZE : REAL_CON_FREEZE;

// When the board unlocks — a hard wall-clock gate, separate from the 4am
// rollover. Before this instant Thursday shows a countdown instead of a
// playable card; at or after it the con is open. Eastern wall clock,
// "YYYY-MM-DD HH:MM".
//
// The gate is this timestamp, NOT the countdown reaching zero: isPreOpen()
// reads the clock, so if the on-screen timer ever stalled the board would
// still unlock on time. The beta's date is in the past, so the beta never
// locks — it already had its weekend.
const REAL_CON_OPEN = "2026-09-03 00:00";   // midnight ending Wednesday
const BETA_OPEN = "2026-08-28 00:00";       // the beta weekend is already open

export const CON_OPEN = isBeta ? BETA_OPEN : REAL_CON_OPEN;

// Shown on the frozen board. Authored per edition by the organizer; the two
// live together here for the same reason the two date sets do (ADR 0014).
export const CLOSED_MESSAGE = isBeta
  ? "The Beta has closed! Thank you so much for taking part and providing feedback!"
  : "The Con has come to an end. Hope you got home safely and we'll see you next year!";

const EASTERN = "America/New_York";

// Wall-clock Eastern parts for an instant, without depending on the host's
// own timezone. Returns { y, m, d, h, min }.
export function easternParts(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}

// Eastern wall clock as "YYYY-MM-DD HH:MM" — zero padded, so string order is
// time order and the freeze comparison needs no date arithmetic.
function easternStamp(now = new Date()) {
  const { y, m, d, h, min } = easternParts(now);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${y}-${p2(m)}-${p2(d)} ${p2(h)}:${p2(min)}`;
}

// Has the board closed? (ADR 0036.) Inclusive of the cutoff minute itself.
export function isFrozen(now = new Date()) {
  return easternStamp(now) >= FREEZE_AT;
}

// Milliseconds until the freeze, or null if it has already happened. Used to
// schedule the transition for a device that is open across the cutoff; a
// device that opens later gets it from isFrozen() at boot.
export function msUntilFreeze(now = new Date()) {
  if (isFrozen(now)) return null;
  let lo = 0;
  let hi = 60000;
  // Grow rather than assume a bound: the freeze can be months out during
  // development and seconds out on the night.
  while (!isFrozen(new Date(now.getTime() + hi))) {
    hi *= 2;
    if (hi > 400 * 24 * 3600000) return null; // further out than we schedule
  }
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (isFrozen(new Date(now.getTime() + mid))) hi = mid; else lo = mid;
  }
  return hi;
}

// Is the board still locked before the con opens? (Hard wall-clock gate.)
export function isPreOpen(now = new Date()) {
  return easternStamp(now) < CON_OPEN;
}

// Milliseconds until the board opens, or null if it already has. Mirrors
// msUntilFreeze: the boundary is a wall-clock stamp, so binary-search for the
// edge rather than doing zone/DST arithmetic. Drives the countdown display.
export function msUntilOpen(now = new Date()) {
  if (!isPreOpen(now)) return null;
  let lo = 0;
  let hi = 60000;
  while (isPreOpen(new Date(now.getTime() + hi))) {
    hi *= 2;
    if (hi > 400 * 24 * 3600000) return null; // further out than we schedule
  }
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (isPreOpen(new Date(now.getTime() + mid))) lo = mid; else hi = mid;
  }
  return hi;
}

// The Eastern calendar date that "owns" this instant, as YYYY-MM-DD.
// Before 4am, the previous date still owns it.
export function conDateFor(now = new Date()) {
  const { y, m, d, h } = easternParts(now);
  const shifted = new Date(Date.UTC(y, m - 1, d));
  if (h < 4) shifted.setUTCDate(shifted.getUTCDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

// Current day key. Dates before the con clamp to the first day, after to the
// last, so the board always renders something (spec section 3: five cards).
export function currentDay(now = new Date()) {
  const date = conDateFor(now);
  const hit = ORDER.find((k) => CON_DATES[k] === date);
  if (hit) return hit;
  return date < CON_DATES[ORDER[0]] ? ORDER[0] : ORDER[ORDER.length - 1];
}

// Milliseconds until the next 4am Eastern boundary, for scheduling a rollover
// without polling.
//
// The rollover is by definition the instant conDateFor() changes, so binary
// search for that edge rather than reasoning about offsets. Correct across the
// DST changes that a fixed -0400/-0500 assumption would get wrong.
// Recompute after each fire; do not cache across a rollover.
export function msUntilRollover(now = new Date()) {
  const today = conDateFor(now);
  const at = (ms) => conDateFor(new Date(now.getTime() + ms));
  let lo = 0;
  let hi = 30 * 3600000; // a day plus slack; always past the next boundary
  if (at(hi) === today) return hi; // should not happen, but never return 0
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid) === today) lo = mid; else hi = mid;
  }
  return hi;
}

// "Aug 29" for a day key, for the overlay on a card that has not opened yet.
// Formatted at UTC noon: the stored date is a calendar date, not an instant,
// and parsing it in the viewer's own zone would shift it a day west of Eastern.
export function dateLabel(day) {
  const iso = CON_DATES[day];
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC"
  }).format(new Date(iso + "T12:00:00Z"));
}
