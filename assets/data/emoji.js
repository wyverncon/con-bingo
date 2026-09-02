// Sticker emoji allowlist, by category (spec section 4.1).
//
// Included: animals & nature, food & drink, plants, objects, activities,
// travel & places, symbols (filtered).
// Excluded: people & body parts, hand gestures, flags - that is where nearly
// all crude, hostile, and slur-adjacent usage lives.
//
// REVIEW STATUS: REVIEWED AND APPROVED by the organizer, 2026-08-23.
// Spec section 4.1 satisfied. Category boundaries are not clean and stacked
// combinations can read worse than any single emoji, so any later addition
// needs a fresh pass - re-run tools/review.html and get sign-off before
// shipping one. Stickers are permanent; one bad emoji persists all day.

// The list itself lives in emoji.json, loaded rather than imported, so an
// organizer review pass diffs as data (see load.js). Top-level await means
// every importer keeps its import unchanged and simply waits.
import { loadJson } from "./load.js";

export const CATS = await loadJson("emoji.json");
