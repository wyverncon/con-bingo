// Scoring a finished card.
//
// bingo.js answers a different question: "did the sticker that just landed
// complete something, for the person holding this phone, right now?" It keeps
// no history. The stats screen needs the other half — who owns each pattern on
// a board that may have been finished hours ago, by nine people, in an order
// nobody was watching.
//
// The rule is now ADR 0024, which supersedes 0019: every player has their own
// card, made of their own stickers, laid out in their own order. So a pattern
// is not arbitrated at all — it simply belongs to the one person whose card it
// is on. "Whoever closed it" stops being a rule and becomes a description.
//
// Two consequences worth stating. A square on YOUR card is filled by YOUR
// sticker and no one else's, so the fill-time bookkeeping below is per player.
// And a line is five cells adjacent *on your board*, so every index tested
// here is a display position, mapped through perm.js — never a stored `sq`.
//
// The room-level numbers (players, stickers, busiest squares, top emoji) stay
// what they always were: they describe the room, not a card.
//
// Everything here is pure: stickers in, plain data out. tools/verify.html
// leans on that.

import { displayIndex } from "./perm.js";

export const ROWS = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19], [20, 21, 22, 23, 24]
];
export const COLS = [
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23], [4, 9, 14, 19, 24]
];
export const DIAGS = [[0, 6, 12, 18, 24], [4, 8, 12, 16, 20]];
export const LINES = [...ROWS, ...COLS, ...DIAGS];
export const CORNERS = [0, 4, 20, 24];
export const PERIMETER = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24];
export const ALL = [...Array(25).keys()];

// The most line bingos one card can hold: five rows, five columns, two
// diagonals. The all-days tab shows a total against ORDER.length * this.
export const LINES_PER_CARD = LINES.length;

/** Map of square index → { t, who } for the sticker that first filled it.
 *  Stored-square space: this is the room's view of the board, used for the
 *  busiest-square thumbnails, not for grading anyone's card. */
export function fillTimes(stickers) {
  const fill = new Map();
  for (const s of stickers) {
    const prev = fill.get(s.sq);
    if (!prev || s.t < prev.t) fill.set(s.sq, { t: s.t, who: s.who });
  }
  return fill;
}

/** One player's card: display position → { t, who }, from their own stickers
 *  only. One sticker per square per player (ADR 0012), so the first-fill rule
 *  is a formality here — it stays for the shape. */
function cardOf(stickers, who) {
  const fill = new Map();
  for (const s of stickers) {
    if (s.who !== who) continue;
    const i = displayIndex(who, s.sq);
    const prev = fill.get(i);
    if (!prev || s.t < prev.t) fill.set(i, { t: s.t, who });
  }
  return fill;
}

// The fill that completed a pattern, or null if the pattern is not complete.
function completion(indices, fill) {
  let last = null;
  for (const i of indices) {
    const f = fill.get(i);
    if (!f) return null;
    if (!last || f.t > last.t) last = f;
  }
  return last;
}

function blankCredit() {
  return { bingos: 0, corners: 0, border: 0, blackout: 0, stickers: 0 };
}

function creditFor(credit, who) {
  if (!credit[who]) credit[who] = blankCredit();
  return credit[who];
}

/**
 * Score one day's stickers.
 *
 * Returns board totals plus a per-player credit map. `corners` / `border` /
 * `blackout` are 0 or 1 at board level — a card has one set of corners, one
 * perimeter, one blackout — and the same at player level, because only one
 * person can place the sticker that finishes each.
 */
export function dayScore(stickers) {
  const credit = {};
  const players = new Set();
  const emoji = new Map();
  const perSquare = new Map();

  for (const s of stickers) {
    players.add(s.who);
    creditFor(credit, s.who).stickers++;
    emoji.set(s.emoji, (emoji.get(s.emoji) || 0) + 1);
    perSquare.set(s.sq, (perSquare.get(s.sq) || 0) + 1);
  }

  // One card per player, graded on its own geometry. The board-level pattern
  // numbers are therefore sums across the room, not properties of one card —
  // which is why the Everyone tab shows activity rather than these.
  let bingos = 0, corners = 0, border = 0, blackout = 0;
  for (const who of players) {
    const card = cardOf(stickers, who);
    const c = creditFor(credit, who);
    for (const line of LINES) {
      if (completion(line, card)) { c.bingos++; bingos++; }
    }
    if (completion(CORNERS, card)) { c.corners = 1; corners++; }
    if (completion(PERIMETER, card)) { c.border = 1; border++; }
    if (completion(ALL, card)) { c.blackout = 1; blackout++; }
  }

  return {
    stickers: stickers.length,
    players: players.size,
    filled: fillTimes(stickers).size,
    bingos,
    corners,
    border,
    blackout,
    credit,
    topEmoji: rank(emoji, 5),
    topSquares: rank(perSquare, 3)
  };
}

/** One player's line out of a day score, zeroed if they did not play. */
export function forPlayer(score, who) {
  return score.credit[who] || blankCredit();
}

/** Sum day scores for one player across the run. */
export function runTotals(scores, who) {
  const out = blankCredit();
  for (const s of scores) {
    const c = forPlayer(s, who);
    out.bingos += c.bingos;
    out.corners += c.corners;
    out.border += c.border;
    out.blackout += c.blackout;
    out.stickers += c.stickers;
  }
  return out;
}

/** Top emoji for one player across any set of stickers. */
export function playerEmoji(stickers, who, n = 5) {
  const counts = new Map();
  for (const s of stickers) {
    if (s.who !== who) continue;
    counts.set(s.emoji, (counts.get(s.emoji) || 0) + 1);
  }
  return rank(counts, n);
}

// Highest first; ties break on the key so a redraw never reshuffles equals.
function rank(counts, n) {
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n);
}
