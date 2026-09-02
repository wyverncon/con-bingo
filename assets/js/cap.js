// Placement limits (ADR 0010 as amended by ADR 0012, addendum §2.5).
//
// Two rules, both derived from the day's own stickers rather than stored
// anywhere, so they reset by themselves at the 4am rollover and survive a
// reload with no bookkeeping:
//
//   1. 25 stickers per player per con day.
//   2. At most one sticker per square per player per day.
//
// Together those are exactly one full card: 25 squares, 25 stickers, none
// wasteable. Rule 2 exists because rule 1 alone did not deliver what it was
// chosen for — stacking two on one square used to cost a square the player
// could then never reach (ADR 0012).
//
// Stacking is untouched as a board behavior: a pile on one square is several
// different people marking it, which is the communal reading.
//
// These are courtesy limits for honest clients, not a defense: anyone with
// devtools can write past them, and that is accepted (addendum §3).

export const MAX_PER_DAY = 25;

// Stickers on this day bearing this name. A reroll therefore resets the
// effective count — accepted in ADR 0010: friend group, rollover self-corrects.
export function countFor(stickers, who) {
  let n = 0;
  for (const s of stickers) if (s.who === who) n++;
  return n;
}

export function atCap(stickers, who) {
  return countFor(stickers, who) >= MAX_PER_DAY;
}

// Rule 2. `stickers` is the day's stickers; `sq` the square being tapped.
export function hasMarked(stickers, who, sq) {
  return stickers.some((s) => s.who === who && s.sq === sq);
}

// Why a placement is refused, or null if it is allowed. The caller turns this
// into the matching message; the strings live in index.html (spec section 1).
export function blockedReason(stickers, who, sq) {
  if (hasMarked(stickers, who, sq)) return "square";
  if (atCap(stickers, who)) return "day";
  return null;
}

// Stickers this player may still place today. Clamped at zero so a board that
// somehow holds more than the cap (an old client, or devtools — see above)
// still reads as "none left" rather than a negative number.
export function remaining(stickers, who) {
  return Math.max(0, MAX_PER_DAY - countFor(stickers, who));
}
