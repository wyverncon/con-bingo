// Per-player board order (ADR 0024).
//
// Two people see the same twenty-five squares in different positions. This is
// a RENDER-TIME PERMUTATION over a canonical order that never changes — it is
// not a shuffle of the square list, and it must never become one.
//
// The reason is ADR 0004 and 0007 together: a sticker records `sq`, an index
// into SQUARES[day], and squares lock at deploy precisely because an index
// that moves orphans every sticker on it. So the stored index is shared and
// permanent; the *position on your screen* is yours. board.js writes the
// stored index onto each cell's dataset, which keeps placement, the owner
// sheet and the caps working in stored space with no idea any of this happened.
//
// What does need to know is anything that reads GEOMETRY — a line is five
// cells adjacent *on your board* — so score.js and bingo.js map through
// `displayIndex` before they test a pattern.
//
// The seed is the player's name. That makes a board the same on their phone
// and their laptop, and the same after a reload, with nothing stored. The cost,
// accepted: rerolling your name reshuffles your board, and the stickers you
// already placed move with their squares.

const SIZE = 25;

// xmur3: string → a well-mixed 32-bit seed. Small, and good enough that two
// names one letter apart do not produce two similar boards.
function seedFrom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// mulberry32: one 32-bit state, uniform enough for a 25-element shuffle.
function rngFrom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDENTITY = Object.freeze([...Array(SIZE).keys()]);

// Built once per name. The board re-renders on every sticker; re-shuffling
// twenty-five entries each time would be pointless work, and a cached array
// also guarantees a name can never produce two different boards in one session.
const cache = new Map();

/**
 * Display position → stored square index, for one player.
 *
 * A missing name (identity has not arrived yet) gets the canonical order, so
 * the board is never wrong while it waits — it is only unshuffled.
 *
 * @param {string|null} name
 * @returns {number[]} length 25, a permutation of 0..24
 */
export function permFor(name) {
  if (!name) return IDENTITY;
  const hit = cache.get(name);
  if (hit) return hit;

  const rnd = rngFrom(seedFrom(name)());
  const out = [...IDENTITY];
  // Fisher-Yates, downward, so every ordering is equally likely.
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  Object.freeze(out);
  cache.set(name, out);
  return out;
}

const inverses = new Map();

/**
 * Stored square index → the position it occupies on this player's board.
 * The inverse of `permFor`, which is what pattern geometry needs.
 */
export function displayIndex(name, sq) {
  if (!name) return sq;
  let inv = inverses.get(name);
  if (!inv) {
    const perm = permFor(name);
    inv = new Array(SIZE);
    for (let i = 0; i < SIZE; i++) inv[perm[i]] = i;
    Object.freeze(inv);
    inverses.set(name, inv);
  }
  return inv[sq];
}
