// Favourite players, per device (ADR 0026).
//
// Deliberately NOT synced. A favourite is a note this phone keeps about who
// its owner is here with; putting it in the room would add shared data, a
// moderation surface, and the question of whether people can see who favourited
// them. None of that buys anything the feature needs.
//
// Names are validated against the same curated word lists everything else is,
// so a tampered localStorage cannot smuggle a string onto the screen: a stored
// entry that is not a legal generated name is dropped at read.

import { cleanWho } from "./validate.js";

const KEY = "dcb.favs.v1";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return new Set();
    // Same rule as sync ingest: validate, never repair (addendum section 2.1).
    return new Set(raw.map(cleanWho).filter((n) => n !== null));
  } catch {
    return new Set();
  }
}

let favs = read();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify([...favs])); } catch { /* private mode */ }
}

export function isFav(name) {
  return favs.has(name);
}

export function toggleFav(name) {
  const clean = cleanWho(name);
  if (clean === null) return false;
  if (favs.has(clean)) favs.delete(clean);
  else favs.add(clean);
  write();
  return favs.has(clean);
}

export function favSet() {
  return favs;
}

export function anyFavs() {
  return favs.size > 0;
}
