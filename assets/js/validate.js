// Ingest validation for synced records (security addendum §2.1, ADR 0009).
//
// The site is static: every byte in the playhtml/PartyKit room was written by
// a client, and any client with devtools can write anything. There is no
// server to validate against, so the whole defense lives here, on the reading
// end. A tampered room may make the board WRONG; it must never make the board
// DANGEROUS.
//
// Two rules make that hold:
//   1. Nothing attacker-chosen ever reaches the DOM. `emoji` must be an exact
//      member of the hand-reviewed allowlist and `who` an exact pair of
//      hand-reviewed words, so the only strings that can render are strings
//      the organizer already signed off on (spec 4.1 / 5.2).
//   2. Synced objects are never spread or merged. `cleanSticker` builds a
//      fresh literal with named fields, so unknown keys - `__proto__`,
//      `constructor`, a 10,000-char payload - are simply not carried across.
//
// Anything that fails is DROPPED, never clamped back into range or defaulted.
// The exception is layout numbers (dx/dy/rot), which are clamped because they
// cannot smuggle content: a bad offset can only move an already-approved
// emoji a few pixels.

import { CATS } from "../data/emoji.js";
import { ADJECTIVES, NOUNS, isAllowed } from "../data/names.js";
import { ORDER } from "../data/theme.js";
import { TOPIC_IDS } from "../data/feedback.js";

// Built once at module load, not per record: ingest runs on every sync frame.
const EMOJI = new Set(CATS.flatMap((c) => c.list));
const ADJ = new Set(ADJECTIVES);
const NOUN = new Set(NOUNS);
const DAYS = new Set(ORDER);
const TOPICS = new Set(TOPIC_IDS);

const ID_RE = /^[a-z0-9]{1,32}$/i;

const DXY_MAX = 21; // matches the tap-offset clamp in app.js place()
const ROT_MAX = 20;

function clamp(n, max) {
  return Math.max(-max, Math.min(max, n));
}

// A name is exactly "<Adjective> <Noun>", both from the curated lists, and
// must also survive the junction blocklist - generateName() rejects those
// pairs, so a name that fails it did not come from an honest client.
//
// Exported because favourites.js reads names back out of localStorage, which is
// no more trustworthy than the room: same rule, same validator.
export function cleanWho(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(" ");
  if (parts.length !== 2) return null;
  const [adj, noun] = parts;
  if (!ADJ.has(adj) || !NOUN.has(noun)) return null;
  if (!isAllowed(adj, noun)) return null;
  return adj + " " + noun;
}

/**
 * Validate one record read from sync.
 *
 * @param {unknown} raw     the synced object - untrusted, never spread
 * @param {string}  dayKey  day derived from the square id, used only when the
 *                          record omits `day` (older writes did)
 * @returns {object|null}   a fresh sticker, or null if the record is rejected
 */
export function cleanSticker(raw, dayKey) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const id = raw.id;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;

  const emoji = raw.emoji;
  if (typeof emoji !== "string" || !EMOJI.has(emoji)) return null;

  const who = cleanWho(raw.who);
  if (who === null) return null;

  const day = DAYS.has(raw.day) ? raw.day : (DAYS.has(dayKey) ? dayKey : null);
  if (day === null) return null;

  const sq = raw.sq;
  if (!Number.isInteger(sq) || sq < 0 || sq > 24) return null;

  const t = raw.t;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;

  const dx = raw.dx, dy = raw.dy, rot = raw.rot;
  if (typeof dx !== "number" || !Number.isFinite(dx)) return null;
  if (typeof dy !== "number" || !Number.isFinite(dy)) return null;
  if (typeof rot !== "number" || !Number.isFinite(rot)) return null;

  return {
    id,
    day,
    sq,
    emoji,
    who,
    t,
    dx: clamp(dx, DXY_MAX),
    dy: clamp(dy, DXY_MAX),
    rot: clamp(rot, ROT_MAX)
  };
}

/**
 * Validate one feedback vote read from sync (ADR 0015).
 *
 * Same contract as cleanSticker, for the same reason: the votes array is
 * client-written and a tampered record must never reach the DOM. `topic` is an
 * id, not a string to display — the label is looked up in the reviewed list —
 * so the worst a forged vote can do is add one to a tally.
 *
 * @param {unknown} raw  the synced object - untrusted, never spread
 * @returns {object|null} a fresh vote, or null if the record is rejected
 */
export function cleanVote(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const id = raw.id;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;

  const topic = raw.topic;
  if (typeof topic !== "string" || !TOPICS.has(topic)) return null;

  const who = cleanWho(raw.who);
  if (who === null) return null;

  const t = raw.t;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;

  return { id, topic, who, t };
}

// Anything below space, plus the DEL/C1 block. Kept as a predicate rather than
// a regex literal so the range is readable at a glance.
function isControl(ch) {
  const c = ch.codePointAt(0);
  return c < 0x20 || (c >= 0x7f && c <= 0x9f);
}

// Longest note the beta accepts. Long enough for a real thought, short enough
// that one person cannot fill the room or the sheet.
export const NOTE_MAX = 280;

/**
 * Validate one free-text note read from sync (ADR 0016, beta only).
 *
 * This is the one record in the app whose text was typed by a person rather
 * than chosen from a reviewed list, so it is the one place the "nothing
 * attacker-chosen reaches the DOM" rule above does not hold. What holds
 * instead: the note is only ever written with `textContent`, never parsed as
 * markup, and the app has no HTML sink at all (addendum §2.2) - so a note that
 * looks like a tag renders as the literal characters of a tag.
 *
 * What is enforced here is shape and size. Control characters are stripped
 * rather than dropped, because a stray one is far more likely to be a paste
 * artefact than an attack, and dropping the note would lose honest feedback.
 *
 * @param {unknown} raw  the synced object - untrusted, never spread
 * @returns {object|null} a fresh note, or null if the record is rejected
 */
export function cleanNote(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const id = raw.id;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;

  const who = cleanWho(raw.who);
  if (who === null) return null;

  const t = raw.t;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;

  if (typeof raw.text !== "string") return null;
  // Strip C0/C1 controls and every flavour of line break, collapse runs of
  // whitespace: the sheet renders one paragraph per note, and a note made of
  // 200 newlines would otherwise push every other note off the screen.
  const text = Array.from(raw.text)
    .map((ch) => (isControl(ch) ? " " : ch))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, NOTE_MAX);
  if (text === "") return null;

  return { id, who, text, t };
}
