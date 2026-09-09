// playhtml sync layer (spec section 10, ADR 0002 / 0004).
//
// One can-play element per square per day, id `sq-<day>-<index>`. Shared data
// is `{ stickers: [] }`. Every write uses the merge-safe mutator form
// `setData(d => …)` — the value form is banned here (ADR 0004).
//
// setData is not on the DOM element. Each square's onMount captures the handle
// into `handles` so place / undo / (later) admin can write from outside the
// square's DOM.
//
// Connection state is phase work, not polish (spec 10.5): hotel wifi fails
// silently and that reads as "the app is broken". playhtml.init's onError is
// the hook; window online/offline covers the rest.
//
// Phase 4: cursors enabled for presence only (no rendered cursors). Identity
// is seeded from identity.js; LIVE NOW reads getPresences().size.
//
// playhtml is vendored, not loaded from a CDN (addendum §2.4, Phase 6b). The
// library ships three ES modules that import each other by relative path and
// nothing else, so copying them in is a copy, not a bundle step. See
// assets/vendor/playhtml-2.14.1/README.md.

import { playhtml } from "../vendor/playhtml-2.14.1/playhtml.es.js";
import { ORDER } from "../data/theme.js";
import { identityForInit, attachIdentity } from "./identity.js";
import { ROOM } from "./room.js";
import { isBeta } from "./edition.js";
import { cleanSticker, cleanVote, cleanNote } from "./validate.js";

/** @typedef {"connecting" | "live" | "offline"} ConnState */

const handles = new Map(); // squareKey -> setData
const getters = new Map(); // squareKey -> getData
const cache = new Map();   // squareKey -> sticker[]
const writeQueue = [];
const voteQueue = [];
const connListeners = new Set();
const dataListeners = new Set();
const liveListeners = new Set();

/** @type {ConnState} */
let conn = "connecting";
let ready = false;
let bootstrapped = false;
let presenceWired = false;

// Feedback lives in one shared element rather than one per topic: the whole
// list is read together and the tallies are small (ADR 0015).
const FEEDBACK_KEY = "feedback";
let votes = [];

// Free-text notes are a separate carrier, not a second field on the feedback
// element: the room already holds `{ votes }` snapshots written before notes
// existed, and a new element needs no migration (ADR 0016). Beta only — the
// con build never mounts it.
const NOTES_KEY = "notes";
const noteQueue = [];
let notes = [];

let readyResolve;

function dayFromKey(key) {
  // sq-thu-12 -> thu
  return key.split("-")[1];
}

export function squareKey(day, sq) {
  return `sq-${day}-${sq}`;
}

export function getConnection() { return conn; }

export function onConnection(fn) {
  connListeners.add(fn);
  fn(conn);
  return () => connListeners.delete(fn);
}

export function onData(fn) {
  dataListeners.add(fn);
  return () => dataListeners.delete(fn);
}

export function onLiveCount(fn) {
  liveListeners.add(fn);
  fn(liveCount());
  return () => liveListeners.delete(fn);
}

function liveCount() {
  if (!ready) return 1;
  try { return playhtml.presence.getPresences().size; }
  catch { return 1; }
}

function notifyLive() {
  const n = liveCount();
  for (const fn of liveListeners) fn(n);
}

function setConn(next) {
  if (conn === next) return;
  conn = next;
  for (const fn of connListeners) fn(conn);
}

function notifyData() {
  for (const fn of dataListeners) fn();
}

function ingest(key, stickers) {
  const dayKey = dayFromKey(key);
  // Snapshot out of the Yjs proxy — callers iterate these later and must not
  // hold live CRDT views that can shift under them. cleanSticker does that
  // snapshotting by construction (fresh literal, named fields, no spread) and
  // is the only gate between the room and the app: anything it rejects never
  // reaches the cache (addendum §2.1). It also stamps day from the square id
  // when older writes omitted it, so forDay() still finds them.
  const raw = Array.isArray(stickers) ? stickers : [];
  const list = raw.map((s) => cleanSticker(s, dayKey)).filter(Boolean);
  // A drop is either tampering or a shape change we did not plan for. Neither
  // is visible on the board (that is the point), so say it in the console —
  // silence here would hide a bug that eats honest stickers.
  if (list.length !== raw.length) {
    console.warn("[sync]", key, "dropped", raw.length - list.length, "invalid record(s)");
  }
  cache.set(key, list);
  notifyData();
}

function ingestVotes(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const clean = list.map(cleanVote).filter(Boolean);
  if (clean.length !== list.length) {
    console.warn("[sync] feedback dropped", list.length - clean.length, "invalid vote(s)");
  }
  votes = clean;
  notifyData();
}

export function allVotes() { return votes; }

function ingestNotes(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const clean = list.map(cleanNote).filter(Boolean);
  if (clean.length !== list.length) {
    console.warn("[sync] notes dropped", list.length - clean.length, "invalid note(s)");
  }
  notes = clean;
  notifyData();
}

export function allNotes() { return notes; }

function refreshAll() {
  for (const [key, getData] of getters) {
    try {
      ingest(key, getData()?.stickers);
    } catch { /* element torn down */ }
  }
}

// One handle per square, plus the feedback carrier, plus the beta's notes
// carrier — a full house counted rather than merely reached.
async function waitForHandles(n = ORDER.length * 25 + 1 + (isBeta ? 1 : 0), ms = 10000) {
  const t0 = Date.now();
  while (handles.size < n && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 40));
  }
  if (handles.size < n) {
    console.warn("[sync] only", handles.size, "of", n, "square handles ready");
  }
}

function flushWriteQueue() {
  for (const sticker of writeQueue.splice(0)) pushStickerNow(sticker);
  for (const vote of voteQueue.splice(0)) pushVoteNow(vote);
  for (const note of noteQueue.splice(0)) pushNoteNow(note);
}

// Snapshot of every sticker across every square. Used by store.js.
export function allStickers() {
  const out = [];
  for (const list of cache.values()) out.push(...list);
  return out;
}

export function stickersFor(day, sq) {
  return cache.get(squareKey(day, sq)) || [];
}

// Mutator-form append. Callers must strip device-local fields (e.g. `fresh`)
// before handing a sticker in — those must not enter the CRDT.
function pushStickerNow(sticker) {
  const key = squareKey(sticker.day, sticker.sq);
  const setData = handles.get(key);
  if (!setData) {
    console.warn("[sync] no handle for", key, "— write dropped");
    return false;
  }
  // Mutator form only — value form is banned (ADR 0004).
  setData((d) => { d.stickers.push(sticker); });
  return true;
}

export function pushSticker(sticker) {
  if (!ready) {
    writeQueue.push(sticker);
    return true;
  }
  return pushStickerNow(sticker);
}

// Feedback writes. Same mutator discipline as stickers (ADR 0004) — the value
// form would wipe every other player's votes.
function pushVoteNow(vote) {
  const setData = handles.get(FEEDBACK_KEY);
  if (!setData) {
    console.warn("[sync] no feedback handle — vote dropped");
    return false;
  }
  setData((d) => { d.votes.push(vote); });
  return true;
}

export function pushVote(vote) {
  if (!ready) {
    voteQueue.push(vote);
    return true;
  }
  return pushVoteNow(vote);
}

export function deleteVote(id) {
  const setData = handles.get(FEEDBACK_KEY);
  if (!setData) {
    console.warn("[sync] no feedback handle — vote removal dropped");
    return false;
  }
  setData((d) => {
    const i = d.votes.findIndex((v) => v.id === id);
    if (i >= 0) d.votes.splice(i, 1);
  });
  return true;
}

function pushNoteNow(note) {
  const setData = handles.get(NOTES_KEY);
  if (!setData) {
    console.warn("[sync] no notes handle — note dropped");
    return false;
  }
  setData((d) => { d.notes.push(note); });
  return true;
}

export function pushNote(note) {
  if (!ready) {
    noteQueue.push(note);
    return true;
  }
  return pushNoteNow(note);
}

export function deleteNote(id) {
  const setData = handles.get(NOTES_KEY);
  if (!setData) {
    console.warn("[sync] no notes handle — note removal dropped");
    return false;
  }
  setData((d) => {
    const i = d.notes.findIndex((n) => n.id === id);
    if (i >= 0) d.notes.splice(i, 1);
  });
  return true;
}

// Mutator-form delete-by-id. Find-then-splice in one mutator so the index is
// never held across a yield (ADR 0004).
export function deleteSticker(day, sq, id) {
  const key = squareKey(day, sq);
  const setData = handles.get(key);
  if (!setData) {
    console.warn("[sync] no handle for", key, "— remove dropped");
    return false;
  }
  // Mutator form only — value form is banned (ADR 0004).
  setData((d) => {
    const i = d.stickers.findIndex((s) => s.id === id);
    if (i >= 0) d.stickers.splice(i, 1);
  });
  return true;
}

// Mutator-form empty of one square. Not the value form — that is reserved for
// the admin nuke (ADR 0004).
export function clearSquare(day, sq) {
  const key = squareKey(day, sq);
  const setData = handles.get(key);
  if (!setData) {
    console.warn("[sync] no handle for", key, "— clear dropped");
    return false;
  }
  setData((d) => { d.stickers.splice(0, d.stickers.length); });
  return true;
}

// Admin nuke for one con day (spec section 9). The ONLY permitted use of the
// value form: replace the snapshot with an empty stickers array so every peer
// converges on a wiped square (ADR 0004).
export function nukeDay(day) {
  let ok = true;
  for (let sq = 0; sq < 25; sq++) {
    const key = squareKey(day, sq);
    const setData = handles.get(key);
    if (!setData) {
      console.warn("[sync] no handle for", key, "— nuke skipped");
      ok = false;
      continue;
    }
    // Value form — intentional wipe (ADR 0004).
    setData({ stickers: [] });
  }
  return ok;
}

function mountSquare(day, sq, root) {
  const key = squareKey(day, sq);
  const el = document.createElement("div");
  el.id = key;
  root.appendChild(el);

  // register() keys on the string id — not the element (playhtml 2.14.1).
  playhtml.register(key, {
    defaultData: { stickers: [] },
    // Hidden carrier elements — no DOM painting, only data fan-out.
    updateElement: ({ data }) => { ingest(key, data.stickers); },
    onMount: ({ setData, getData }) => {
      handles.set(key, setData);
      getters.set(key, getData);
      // Seed the cache from whatever is already known (default or pre-sync).
      ingest(key, getData().stickers);
    }
  });
}

function mountFeedback(root) {
  const el = document.createElement("div");
  el.id = FEEDBACK_KEY;
  root.appendChild(el);
  playhtml.register(FEEDBACK_KEY, {
    defaultData: { votes: [] },
    updateElement: ({ data }) => { ingestVotes(data.votes); },
    onMount: ({ setData, getData }) => {
      handles.set(FEEDBACK_KEY, setData);
      ingestVotes(getData().votes);
    }
  });
}

function mountNotes(root) {
  const el = document.createElement("div");
  el.id = NOTES_KEY;
  root.appendChild(el);
  playhtml.register(NOTES_KEY, {
    defaultData: { notes: [] },
    updateElement: ({ data }) => { ingestNotes(data.notes); },
    onMount: ({ setData, getData }) => {
      handles.set(NOTES_KEY, setData);
      ingestNotes(getData().notes);
    }
  });
}

function wirePresence() {
  if (presenceWired) return;
  presenceWired = true;
  playhtml.ready.then(() => {
    notifyLive();
    playhtml.presence.onPresenceChange("cursor", notifyLive);
    playhtml.users.onChange(notifyLive);
  }).catch(() => { /* offline — count stays at 1 */ });
}

// Try to load the post-con snapshot. Returns the parsed object, or null if
// the file does not exist (live mode). Callers pass the result to
// initFromArchive when non-null.
export async function loadArchive() {
  try {
    const res = await fetch(new URL("../data/archive-2026.json", import.meta.url));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Load a static snapshot instead of joining a room (ADR 0036). The board,
// scores, and player lookup all work; writes are impossible because no handles
// exist. Connection reports "live" so no offline banner.
export function initFromArchive(archive) {
  for (const day of ORDER) {
    const stickers = archive.days[day] || [];
    for (let sq = 0; sq < 25; sq++) {
      const key = squareKey(day, sq);
      const mine = stickers.filter((s) => s.sq === sq);
      ingest(key, mine);
    }
  }
  ready = true;
  setConn("live");
  readyResolve?.();
}

// Creates one carrier element per square, connects the room, and resolves once the
// initial sync finishes (or rejects on hard failure). Safe to call once;
// carriers and window listeners are only wired on the first attempt.
export async function init() {
  if (ready) return;

  if (!bootstrapped) {
    bootstrapped = true;

    let root = document.getElementById("dcb-sync");
    if (!root) {
      root = document.createElement("div");
      root.id = "dcb-sync";
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      document.body.appendChild(root);
    }

    for (const day of ORDER) {
      for (let sq = 0; sq < 25; sq++) mountSquare(day, sq, root);
    }
    mountFeedback(root);
    if (isBeta) mountNotes(root);

    window.addEventListener("offline", () => setConn("offline"));
    window.addEventListener("online", () => {
      // PartyKit reconnects on its own; surface "connecting" until the next
      // data tick (or a short grace) flips us back to live.
      if (conn === "offline") setConn("connecting");
      window.setTimeout(() => {
        if (navigator.onLine && conn === "connecting") setConn("live");
      }, 1200);
    });

    // A sticker update while marked offline means the pipe is open again.
    // Do not use this to leave "connecting" — mount-time ingest would flip us
    // live before playhtml.ready resolves.
    onData(() => {
      if (conn === "offline") setConn("live");
    });
  }

  setConn("connecting");

  try {
    const playerIdentity = identityForInit();
    await playhtml.init({
      room: ROOM,
      onError: () => setConn("offline"),
      cursors: {
        enabled: true,
        shouldRenderCursor: () => false,
        // Only seed when we already have a playhtml publicKey. Passing a
        // partial playerIdentity throws in 2.14.1 ("must have publicKey").
        ...(playerIdentity ? { playerIdentity } : {})
      }
    });
    attachIdentity(playhtml);
    wirePresence();
    await playhtml.ready;
    await waitForHandles();
    refreshAll();
    ready = true;
    flushWriteQueue();
    readyResolve?.();
    if (conn !== "offline") setConn("live");
  } catch (err) {
    console.warn("[sync] playhtml.init failed", err);
    setConn("offline");
    throw err;
  }
}
