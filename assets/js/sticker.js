// The sticker this device is carrying (ADR 0027).
//
// Per device, not synced: it is a tool in your hand, not a fact about the room.
// The first emoji you place becomes it, the counter chip shows it, and tapping
// that chip opens the picker to change it.
//
// Validated on the way in AND on the way out against the reviewed allowlist,
// for the same reason favourites are: localStorage is client-writable, so a
// value read back out of it is no more trustworthy than one read off sync
// (addendum section 2.1). A rejected value is dropped, never repaired.

import { CATS } from "../data/emoji.js";

const KEY = "dcb.sticker.v1";
const ALLOWED = new Set(CATS.flatMap((c) => c.list));

let current = read();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return typeof raw === "string" && ALLOWED.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The emoji a tap will place, or null if nothing has been chosen yet. */
export function defaultEmoji() {
  return current;
}

/**
 * Remember an emoji as the one being carried.
 * @returns {boolean} whether it was accepted.
 */
export function setDefaultEmoji(emoji) {
  if (typeof emoji !== "string" || !ALLOWED.has(emoji)) return false;
  if (current === emoji) return true;
  current = emoji;
  try { localStorage.setItem(KEY, emoji); } catch { /* private mode */ }
  return true;
}
