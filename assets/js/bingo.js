// Pattern detection + easter eggs per day per device.
//
// The card is yours (ADR 0024): only your own stickers fill it, and a line is
// five cells adjacent *on your board*, so every index in this module is a
// DISPLAY position — your stored squares mapped through your permutation.
//
// Fire only when a single square newly fills and that fill completes a pattern.
// Refresh / first sync / other devices opening an already-complete board ingest
// many squares at once (or zero new ones) and must stay silent.
//
// Bigger patterns supersede line bingos on the same fill: blackout > border >
// corners > line. Armed after the first synced paint (arm()), same moment as
// enableArrivalMotion.

import { ORDER } from "../data/theme.js";
import { forDay } from "./store.js";
import { whoAmI } from "./identity.js";
import { displayIndex } from "./perm.js";
import { playBingoFx } from "./bingo-fx.js";

// Pattern geometry lives in score.js, the module that also grades a finished
// card. One definition, so a change to what counts as a border cannot reach
// the stats screen without reaching the celebration.
import { LINES, CORNERS, PERIMETER, ALL } from "./score.js";

let armed = false;
let busy = false;
/** @type {Map<string, Set<number>>} */
const prevFilled = new Map();

function filledSet(day) {
  const me = whoAmI();
  const filled = new Set();
  for (const s of forDay(day)) {
    if (s.who !== me) continue;
    filled.add(displayIndex(me, s.sq));
  }
  return filled;
}

function complete(filled, indices) {
  return indices.every((i) => filled.has(i));
}

function snapshot(day) {
  prevFilled.set(day, filledSet(day));
}

/** Call after the first synced board paint. */
export function arm() {
  for (const day of ORDER) snapshot(day);
  armed = true;
}

function newlyFilled(filled, before) {
  const out = [];
  for (const i of filled) if (!before.has(i)) out.push(i);
  return out;
}

function newlyRemoved(filled, before) {
  const out = [];
  for (const i of before) if (!filled.has(i)) out.push(i);
  return out;
}

function pickNew(filled, before) {
  const added = newlyFilled(filled, before);
  // Bulk ingest or no change — never celebrate.
  if (added.length !== 1) return null;
  const sq = added[0];

  if (complete(filled, ALL) && !complete(before, ALL))
    return "blackout";
  if (complete(filled, PERIMETER) && !complete(before, PERIMETER) && PERIMETER.includes(sq))
    return "perimeter";
  if (complete(filled, CORNERS) && !complete(before, CORNERS) && CORNERS.includes(sq))
    return "corners";
  if (LINES.some((line) => line.includes(sq) && complete(filled, line) && !complete(before, line)))
    return "line";
  return null;
}

export function evaluate(day, ctx) {
  if (!armed || busy || !ctx?.stage || !ctx?.grid) return;

  const filled = filledSet(day);
  if (!prevFilled.has(day)) {
    snapshot(day);
    return;
  }

  const before = prevFilled.get(day);
  const added = newlyFilled(filled, before);
  const removed = newlyRemoved(filled, before);

  // Nuke, clear-square, or any bulk change — re-baseline without FX so patterns
  // can be earned again. Single-square adds with no removals are the only
  // path that may celebrate.
  if (removed.length > 0 || added.length !== 1) {
    snapshot(day);
    return;
  }

  // The placer check that used to live here is gone: the filled set is built
  // from this device's own stickers, so the square that just appeared in it can
  // only be one this player placed. ADR 0019's question — who owns a pattern
  // several people built — stops existing when a card has one author.
  const kind = pickNew(filled, before);
  prevFilled.set(day, filled);
  if (!kind) return;

  busy = true;
  playBingoFx(kind, ctx).finally(() => {
    busy = false;
    evaluate(day, ctx);
  });
}

// --- test exports (tools/verify.html) ---------------------------------------
export function _complete(filledArr, indices) {
  return complete(new Set(filledArr), indices);
}
export function _pickNew(filledArr, beforeArr) {
  return pickNew(new Set(filledArr), new Set(beforeArr));
}
