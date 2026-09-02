// Per-day palette, day order, and filter dot colors.
//
// Tuned for phone readability. Each day carries a hue (`hue`, degrees) and a
// contrast hue (`hueOwn`) used for squares this player has filled. Everything
// the cell frame draws — ring, glow, centre, label ink — is derived from one
// of those two numbers in app.css, so a day is still a variable swap and the
// pair can be reviewed side by side in tools/review.html.
//
// The hues match the accent colours they came from; `hueOwn` is roughly 150-190
// degrees away, far enough that a filled square reads as a different colour
// rather than a shade of the day's (phase 6d). They are authored, not computed,
// so a bad pair is caught in review rather than at runtime.

import { isBeta } from "../js/edition.js";

// The list itself lives in theme.json, loaded rather than imported, so an
// organizer review pass diffs as data (see load.js). Top-level await means
// every importer keeps its import unchanged and simply waits.
import { loadJson } from "./load.js";

const DATA = await loadJson("theme.json");

export const DAYCFG = DATA.days;

// The days this build has cards for. The beta runs Friday to Sunday and
// reuses those three palettes unchanged, so a day is still a variable swap
// (ADR 0014). Every day-aware module reads ORDER rather than counting to five.
export const ORDER = isBeta
  ? ["fri","sat","sun"]
  : ["thu","fri","sat","sun","mon"];

// Filter chip / player dot colors, cycled by index.
export const DOTS = DATA.dots;
