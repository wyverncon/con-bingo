// The feedback topics a player can vote on (ADR 0015).
//
// Feedback is a fixed list, not a text box: spec section 1 rules out free text
// anywhere in the app, and that rule is what makes the room safe to render
// without a server to moderate it. These strings are reviewed content on the
// same footing as the emoji allowlist and the square texts — organizer-owned,
// and the only feedback strings that can ever appear on screen.
//
// `id` is what syncs and what validate.js checks against; the label and icon
// never leave this file. Changing an id orphans the votes already cast under
// it, so add topics rather than renaming them.
// The list itself lives in feedback.json, loaded rather than imported, so an
// organizer review pass diffs as data (see load.js). Top-level await means
// every importer keeps its import unchanged and simply waits.
import { loadJson } from "./load.js";

export const TOPICS = await loadJson("feedback.json");

export const TOPIC_IDS = TOPICS.map((t) => t.id);
