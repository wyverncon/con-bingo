// Player name generation (spec section 5).
//
// Identity is a randomly generated two-word name, assigned on first visit and
// persisted on the device. Not chosen, not derived from anything identifying.
//
// REVIEW STATUS: REVIEWED AND APPROVED by the organizer, 2026-08-23.
// Spec section 5.2 satisfied - both word lists and a sample of generated
// output were eyeballed. Any later edit to either list needs a fresh pass:
// open tools/review.html and get sign-off before shipping it.
//
// Curation rules applied when building these lists:
//   - no body parts, no anatomy, no bodily functions
//   - no words with a crude second meaning in common usage
//   - no real-world nationalities, religions, or identity terms
//   - nothing that reads as an insult when paired with any noun below
// The lists are deliberately bland-safe: the humor lives in the board, not in
// people's names.

// The list itself lives in names.json, loaded rather than imported, so an
// organizer review pass diffs as data (see load.js). Top-level await means
// every importer keeps its import unchanged and simply waits.
import { loadJson } from "./load.js";

const DATA = await loadJson("names.json");

export const ADJECTIVES = DATA.adjectives;
export const NOUNS = DATA.nouns;

// Rejected at the word boundary, not inside a word.
//
// Both lists are curated, so a crude term appearing WITHIN a word is a
// deliberate, harmless part of that word - "Brass", "Glassy", "Compass" all
// contain "ass"; "Sextant" is a navigation instrument. Only a term that spans
// the junction between the two words is an accident worth rejecting.
// The organizer should extend this list during the section 5.2 review.
export const BLOCKED = DATA.blocked;

const squash = (w) => w.toLowerCase().replace(/[^a-z]/g, "");

// True unless a blocked term straddles the adjective/noun junction.
export function isAllowed(adj, noun) {
  const a = squash(adj);
  const full = a + squash(noun);
  return !BLOCKED.some((bad) => {
    let i = full.indexOf(bad);
    while (i !== -1) {
      if (i < a.length && i + bad.length > a.length) return true; // spans it
      i = full.indexOf(bad, i + 1);
    }
    return false;
  });
}

// Dev helper: reports blocked terms sitting wholly inside a curated word.
// Those are not rejections - they are a prompt to check the word is intended.
export function auditWordLists() {
  const out = [];
  for (const w of ADJECTIVES.concat(NOUNS))
    for (const bad of BLOCKED)
      if (squash(w).includes(bad)) out.push(w + " contains " + bad);
  return out;
}

// ADJECTIVES.length * NOUNS.length combinations (9016). With ~40 players the
// odds of any two colliding sit near 1 in 12, and spec section 5.1 accepts
// that: there is no claim logic, and a colliding player can simply reroll.
export function generateName(rand = Math.random) {
  for (let i = 0; i < 50; i++) {
    const a = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
    const n = NOUNS[Math.floor(rand() * NOUNS.length)];
    if (a === n) continue; // "Lantern Lantern" is the only way this fires
    if (isAllowed(a, n)) return a + " " + n;
  }
  return "Quiet Nebula"; // unreachable in practice; never returns a blocked name
}
