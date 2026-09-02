// Beta feedback: a tally over the reviewed topic list (ADR 0015), plus the
// beta's free-text notes (ADR 0016).
//
// A vote is `{ id, topic, who, t }` and lives in one shared playhtml element
// (sync.js). One vote per topic per player: tapping a topic you already voted
// on takes the vote back, which is also the only delete path, so nobody can
// clear anyone else's.
//
// Everything here reads votes that already passed cleanVote at ingest
// (addendum §2.1); nothing on this path is spread or merged.

import * as sync from "./sync.js";
import { TOPIC_IDS } from "../data/feedback.js";
import { whoAmI } from "./identity.js";
import { NOTE_MAX } from "./validate.js";

/** Vote count per topic id, including topics nobody has voted on. */
export function counts(votes = sync.allVotes()) {
  const out = new Map(TOPIC_IDS.map((id) => [id, 0]));
  for (const v of votes) out.set(v.topic, (out.get(v.topic) || 0) + 1);
  return out;
}

/** The topic ids this device has already voted on. */
export function mine(who = whoAmI(), votes = sync.allVotes()) {
  return new Set(votes.filter((v) => v.who === who).map((v) => v.topic));
}

/** Toggle this device's vote on one topic. Returns the new state. */
export function toggle(topic) {
  if (!TOPIC_IDS.includes(topic)) return false;
  const who = whoAmI();
  const existing = sync.allVotes().find((v) => v.who === who && v.topic === topic);
  if (existing) {
    sync.deleteVote(existing.id);
    return false;
  }
  sync.pushVote({
    id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    topic,
    who,
    t: Date.now()
  });
  return true;
}

// --- free-text notes (ADR 0016, beta only) ---------------------------------

// A bound on one player rather than on the room: enough to say several things
// over a weekend, few enough that one bored tester cannot bury the rest.
export const MAX_NOTES_PER_PLAYER = 12;

/** Every note, newest first. Already cleaned at ingest. */
export function notes() {
  return [...sync.allNotes()].sort((a, b) => b.t - a.t);
}

export function myNoteCount(who = whoAmI()) {
  return sync.allNotes().reduce((n, x) => n + (x.who === who ? 1 : 0), 0);
}

export function canPostNote(who = whoAmI()) {
  return myNoteCount(who) < MAX_NOTES_PER_PLAYER;
}

/**
 * Post one note. Returns false when it is empty, over length, or the player is
 * at their limit — the caller shows why; nothing is silently truncated except
 * the trailing whitespace the field allows.
 */
export function postNote(text) {
  const body = String(text).trim();
  if (!body || body.length > NOTE_MAX) return false;
  const who = whoAmI();
  if (!canPostNote(who)) return false;
  sync.pushNote({
    id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    who,
    text: body,
    t: Date.now()
  });
  return true;
}

/** Delete one of this device's own notes. Other people's are not offered. */
export function removeNote(id) {
  const note = sync.allNotes().find((n) => n.id === id);
  if (!note || note.who !== whoAmI()) return false;
  sync.deleteNote(id);
  return true;
}
