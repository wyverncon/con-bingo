// The 25 observations on each day's card.
//
// Two sets exist: the con's 125 and the beta's 75 (`squares-beta.js`). Which
// one ships is the edition flag, not an import site — every reader still asks
// for SQUARES and gets the set for this build (ADR 0014).
//
// A BUILD MUST NOT CARRY THE OTHER EDITION'S LIST. This used to import
// squares-beta.js statically, which top-level-awaits its JSON, so both files
// were fetched at boot and both shipped in every snapshot — the con's 125
// squares were sitting on the public beta host. The beta side is therefore a
// dynamic import: the con build never evaluates that module and never asks for
// its JSON, and the beta build never asks for the con's. `tools/verify.html`
// still imports squares-beta.js directly, on purpose — it checks both sets
// whatever edition it is opened in.
//
// Draft set for organizer sign-off (Phase 6). Review at tools/squares-review.html.
// Spec section 3: majority DragonCon in-jokes, remainder generic, no square
// names an individual person. Locked at deploy (ADR 0007) — no mid-con edits.

import { isBeta } from "../js/edition.js";
import { loadJson } from "./load.js";

// The lists live in JSON, loaded rather than imported, so an organizer review
// pass diffs as data (see load.js). Top-level await means every importer keeps
// its import unchanged and simply waits.
export const SQUARES = isBeta
  ? (await import("./squares-beta.js")).BETA_SQUARES
  : await loadJson("squares-con.json");
