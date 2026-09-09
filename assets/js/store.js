// Sticker store. Public surface is unchanged from Phase 2 (ADR 0005):
// add / remove / forDay / forSquare / all / subscribe.
//
// Backing is playhtml via sync.js (ADR 0004). Device-local fields like `fresh`
// (the pop animation) stay off the CRDT — they live in `localById` only.
//
// Every sticker that reaches this module has already passed cleanSticker at
// ingest (addendum section 2.1), except the optimistic local overlay, which
// this device authored itself.

import * as sync from "./sync.js";
import { isFrozen } from "./day.js";

const listeners = new Set();
// Placing-device overlay: the object app.js holds, including `fresh`.
const localById = new Map();

function notify() { for (const fn of listeners) fn(); }

sync.onData(notify);

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function withLocal(s) {
  const loc = localById.get(s.id);
  if (loc && loc.fresh) return { ...s, fresh: true };
  return s;
}

export function all() {
  const seen = new Set();
  const out = [];
  for (const s of sync.allStickers()) {
    seen.add(s.id);
    out.push(withLocal(s));
  }
  // Optimistic: a sticker we just wrote may not have echoed through
  // updateElement yet. Keep it visible on the placing device so the pop
  // animation and the undo window have something to show.
  for (const [id, s] of localById) {
    if (!seen.has(id)) out.push(s);
  }
  return out;
}

export function forDay(day) {
  return all().filter((s) => s.day === day);
}

export function forSquare(day, sq) {
  return all().filter((s) => s.day === day && s.sq === sq);
}

// Strip device-local fields before the mutator write. `fresh` must never sync,
// or every peer would replay the pop animation on arrival.
function forSync(sticker) {
  const { fresh, ...rest } = sticker;
  return rest;
}

// Every write goes through here after the board closes (ADR 0036). The UI
// already refuses — isReadOnly() covers the player, and admin.html hides its
// controls — but this is the one place all four writers share, and a closing
// time that only exists in the UI is a closing time one stale tab undoes.
//
// It stops the admin console too. Moderating a sticker after the cutoff means
// editing the exported snapshot, which is a file review rather than a live
// mutation of a board nobody is watching any more.
function closed() { return isFrozen(); }

export function add(sticker) {
  if (closed()) return null;
  localById.set(sticker.id, sticker);
  // Mutator write happens inside sync.pushSticker (ADR 0004).
  sync.pushSticker(forSync(sticker));
  // Optimistic notify in case updateElement is slow; sync.onData also fires.
  notify();
  return sticker;
}

export function remove(id) {
  if (closed()) return;
  const found = localById.get(id) || sync.allStickers().find((s) => s.id === id);
  localById.delete(id);
  if (!found) {
    notify();
    return;
  }
  // Prefer a no-op if the handle is missing (write never landed); otherwise
  // delete-by-id via mutator splice (phase-3.md / ADR 0004).
  sync.deleteSticker(found.day, found.sq, id);
  notify();
}

// Admin: wipe one square (mutator splice-all). Drops matching local overlays.
export function clearSquare(day, sq) {
  if (closed()) return;
  for (const [id, s] of localById) {
    if (s.day === day && s.sq === sq) localById.delete(id);
  }
  sync.clearSquare(day, sq);
  notify();
}

// Admin nuke: wipe every square of a day via the value-form path in sync
// (ADR 0004 — permitted only here).
export function nukeDay(day) {
  if (closed()) return;
  for (const [id, s] of localById) {
    if (s.day === day) localById.delete(id);
  }
  sync.nukeDay(day);
  notify();
}
