// The line under the room's bingo count on the stats screen: a true,
// checkable comparison for a bingo total.
//
// Two standing rules, both learned the hard way in review:
//
//   1. EVERY FACT IS TRUE and checkable. The comparison is allowed to be an
//      odd thing to count; the number is not allowed to be invented. A made-up
//      statistic reads as a joke the first time and as sloppiness the second.
//   2. A fact must fit its bucket. "As many as the Great Lakes" is charming at
//      five and nonsense at forty, so each line declares the range it holds
//      for and the screen only draws from the matching bucket.
//
// This list is deliberately short for the beta. The con reaches much higher
// totals across five days and needs a longer list, plus con-flavoured entries
// (see the memory note; organizer-reviewed content like the squares).

// The list itself lives in facts.json, loaded rather than imported, so an
// organizer review pass diffs as data (see load.js). Top-level await means
// every importer keeps its import unchanged and simply waits.
import { loadJson } from "./load.js";

const DATA = await loadJson("facts.json");

export const FACTS = DATA.facts;

export function factFor(n) {
  const pool = FACTS.filter((f) => n >= f.min && n <= f.max);
  if (!pool.length) return null;
  return pool[n % pool.length].text;
}
