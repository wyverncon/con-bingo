// Board wiring: local UI state + playhtml-backed sticker store.
//
// playhtml.init({ room: ROOM }) lives in sync.js (ADR 0002). Everything else
// re-renders from a single render() driven by two subscriptions (view state,
// sticker store) plus the connection banner (spec 10.5).

import { DAYCFG, ORDER } from "../data/theme.js";
import { currentDay, msUntilRollover, dateLabel, msUntilFreeze, isFrozen, CLOSED_MESSAGE, isPreOpen, msUntilOpen } from "./day.js";
import { state, set, subscribe as onState, isReadOnly, isFuture, stepDay } from "./state.js";
import * as store from "./store.js";
import * as sync from "./sync.js";
import { whoAmI, reroll, myColor } from "./identity.js";
import { createBoard } from "./board.js";
import { createZoom } from "./zoom.js";
import { createSheets } from "./sheets.js";
import { createUndo } from "./undo.js";
import { enableArrivalMotion } from "./cell.js";
import { applyFx, pulseClass } from "./fx.js";
import { arm as armBingo, evaluate as evaluateBingo } from "./bingo.js";
import { blockedReason, remaining } from "./cap.js";
import { createStats } from "./stats.js";
import { createInstall } from "./install.js";
import { isBeta } from "./edition.js";
import { defaultEmoji, setDefaultEmoji } from "./sticker.js";

const $ = (sel) => document.querySelector(sel);

const stage = $("[data-stage]");
const pan = $("[data-pan]");
const grid = $("[data-grid]");

const zoom = createZoom(stage, pan, () => syncTabs());

const undo = createUndo({
  bar: $("[data-undo]"),
  count: $("[data-undo-count]"),
  btn: $("[data-undo-btn]"),
  dismiss: $("[data-undo-dismiss]"),
  onUndo: (id) => store.remove(id),
  // Asked on every paint: a sticker the admin cleared is no longer undoable,
  // and the control must not offer to remove something that is already gone.
  exists: (id) => store.all().some((s) => s.id === id)
});

const board = createBoard({
  pan, grid, stage, zoom,
  hdr: $("[data-hdr]"),
  // Clear any stale notice: it referred to the square that was open before.
  //
  // With a sticker already chosen, a tap places it — that is the whole point of
  // the default (ADR 0027). The picker opens only when there is nothing chosen
  // yet, or when the tap cannot land, because a blocked placement needs the
  // sheet to explain itself in.
  onPick: (sq) => {
    hideNotes();
    const em = defaultEmoji();
    const blocked = blockedReason(store.forDay(state.day), whoAmI(), sq);
    if (em && !blocked && !isReadOnly()) {
      set({ activeSq: sq });
      place(em);
      return;
    }
    set({ activeSq: sq, sheet: "emoji" });
    if (blocked) showNote(blocked);
  }
});

const sheets = createSheets({
  scrim: $("[data-scrim]"),
  sheets: {
    emoji: $('[data-sheet="emoji"]'),
    filter: $('[data-sheet="filter"]'),
    archive: $('[data-sheet="archive"]'),
    read: $('[data-sheet="read"]'),
    feedback: $('[data-sheet="feedback"]'),
    owners: $('[data-sheet="owners"]')
  },
  cats: $("[data-cats]"),
  catLabel: $("[data-cat-label]"),
  emojis: $("[data-emojis]"),
  players: $("[data-players]"),
  playerFind: $("[data-player-find]"),
  favsOnly: $("[data-favs-only]"),
  days: $("[data-days]"),
  readModes: $("[data-read-modes]"),
  stackModes: $("[data-stack-modes]"),
  ownerCoord: $("[data-owner-coord]"),
  ownerText: $("[data-owner-text]"),
  ownerList: $("[data-owner-list]"),
  feedback: $("[data-feedback]"),
  notebox: $("[data-notebox]"),
  noteInput: $("[data-note-input]"),
  noteSend: $("[data-note-send]"),
  noteCount: $("[data-note-count]"),
  noteFull: $("[data-note-full]"),
  notes: $("[data-notes]"),
  onPlace: place
});

// The scores screen (ADR 0020). It reads the same store everything else does;
// nothing about a finished card is stored anywhere, it is graded on open.
const stats = createStats({
  root: $("[data-stats]"),
  body: $("[data-stats-body]"),
  tabs: document.querySelectorAll("[data-stats-tab]"),
  viewBtn: $("[data-stats-view]"),
  shareBtn: $("[data-stats-share]"),
  shareView: $("[data-shareview]"),
  canvas: $("[data-sharecanvas]"),
  shareNote: $("[data-share-note]"),
  getDay: () => state.day,
  getToday: () => state.today,
  getStickers: () => store.all(),
  getMe: whoAmI
});

createInstall({
  wrap: $("[data-a2hs]"),
  btn: $("[data-a2hs-btn]"),
  ios: $("[data-a2hs-ios]")
});

// The beta drops the readability selector: phase 6d settled the look, so its
// options are now one default (ADR 0023). Hidden rather than deleted, because
// the con build still mounts it and the sheet's own wiring stays valid either
// way. The sheet becomes unreachable with the tab gone.
if (isBeta) {
  for (const el of document.querySelectorAll("[data-beta-hide]")) el.hidden = true;
}

// The feedback feature (tab + sheet + topic vote) is the beta dry run's, not
// the con's. Hide it in the con build; with the tab gone the sheet is
// unreachable, and state.sheet can never become "feedback". The beta's own
// free-text notebox inside that sheet is gated the other way (isBeta) in
// sheets.js, so nothing here affects the beta.
if (!isBeta) {
  for (const el of document.querySelectorAll("[data-con-hide]")) el.hidden = true;
}

// --- placement --------------------------------------------------------------

// Mockup: the tap point inside the square becomes up to +/-21px of offset, so
// stickers land where the finger did and a stack spreads out on its own.
function place(emoji) {
  // The picker opened with no square attached: the player is choosing which
  // sticker to carry, not placing one (ADR 0027).
  if (state.activeSq == null) {
    if (setDefaultEmoji(emoji)) renderCounter();
    set({ sheet: null });
    return;
  }
  if (isReadOnly()) return;
  // 25 a day, and one per square (ADR 0010 / 0012). Both counted from today's
  // board, so they reset themselves at the rollover. The sheet stays open:
  // closing it would look like the sticker landed.
  const blocked = blockedReason(store.forDay(state.day), whoAmI(), state.activeSq);
  if (blocked) {
    showNote(blocked);
    return;
  }
  const p = board.tapPoint();
  const sticker = {
    id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    day: state.day,
    sq: state.activeSq,
    emoji,
    who: whoAmI(),
    t: Date.now(),
    dx: Math.max(-21, Math.min(21, (p.u - 0.5) * 64)),
    dy: Math.max(-21, Math.min(21, (p.v - 0.5) * 64)),
    rot: (Math.random() - 0.5) * 16,
    fresh: true
  };
  // Close the sheet first: both calls re-render, and adding the sticker last
  // means the pop animation starts once rather than being restarted.
  // The first thing you place is what you carry from then on (ADR 0027).
  setDefaultEmoji(emoji);
  set({ sheet: null, activeSq: null });
  store.add(sticker);
  undo.push(sticker);
  // `fresh` only drives the pop animation on the placing device; clear it so a
  // later re-render does not replay it. Never synced (store strips it).
  setTimeout(() => { delete sticker.fresh; }, 520);
}

// The async clipboard needs a secure context, which `https://` Pages is and a
// `http://192.168.x.x` dev server on a phone is not. The textarea fallback is
// the old synchronous copy, kept for exactly that case.
async function copyLink(url) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch { /* denied, or the document is not focused */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// --- toast ------------------------------------------------------------------

// One authored line in markup (spec section 1). Re-triggering restarts the
// animation, which needs the element out of the document for a frame.
const toast = $("[data-toast]");
let toastTimer = 0;
function showToast() {
  toast.hidden = true;
  void toast.offsetWidth;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1800);
}

// The notice text lives in index.html — code only picks which one shows
// (spec section 1). Keyed by the reason blockedReason() returns.
const notes = {
  day: $('[data-note="day"]'),
  square: $('[data-note="square"]')
};
let noteTimer = 0;

function hideNotes() {
  for (const el of Object.values(notes)) el.hidden = true;
}

function showNote(which) {
  hideNotes();
  notes[which].hidden = false;
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(hideNotes, 4000);
}

// --- palette ----------------------------------------------------------------

// A day change is a variable swap, not a re-render (Phase 2 plan). Every colour
// in app.css reads from these, and the cell frame reads only the two hues.
let paintedDay = null;
function applyPalette(day) {
  const c = DAYCFG[day];
  const root = document.documentElement.style;
  root.setProperty("--accent", c.accent);
  root.setProperty("--cell", c.cell);
  root.setProperty("--cell-on", c.cellOn);
  root.setProperty("--day-hue", String(c.hue));
  root.setProperty("--day-hue-own", String(c.hueOwn));
  document.documentElement.dataset.day = day;
}

// --- connection banner (spec 10.5) ------------------------------------------

const connBar = $("[data-conn]");
const connLabel = $("[data-conn-label]");

const CONN_COPY = {
  connecting: "Connecting…",
  offline: "Offline — will sync when back",
  live: ""
};

// --- identity chip + reroll (spec section 5) ------------------------------

const idChip = $("[data-id-chip]");
const idMenu = $("[data-id-menu]");
const idMenuName = $("[data-id-menu-name]");
const idDot = $("[data-id-dot]");
const liveN = $("[data-live-n]");

sync.onConnection((s) => {
  connBar.dataset.state = s;
  connBar.hidden = s === "live";
  connLabel.textContent = CONN_COPY[s] || "";
  board.fit();
});

sync.onLiveCount((n) => { liveN.textContent = String(n); });

function syncIdentityUi() {
  const name = whoAmI();
  $("[data-me]").textContent = name;
  idMenuName.textContent = name;
  introName.textContent = name;
  idDot.style.background = `linear-gradient(145deg, ${myColor()}, #9b5dc4)`;
}

// --- first run (ADR 0025) ---------------------------------------------------

// Shown once per device, and reachable for good from the name menu. The flag is
// the only thing stored; a private-mode browser that refuses simply sees the
// card again, which is the harmless failure.
const INTRO_KEY = "dcb.intro.v1";
const introBox = $("[data-intro]");
const introName = $("[data-intro-name]");

function introSeen() {
  try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; }
}

function openIntro() {
  syncIdentityUi();
  introBox.hidden = false;
}

function closeIntro() {
  introBox.hidden = true;
  try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ }
}

$("[data-intro-close]").addEventListener("click", closeIntro);
introBox.addEventListener("click", (e) => { if (e.target === introBox) closeIntro(); });
$("[data-intro-open]").addEventListener("click", (e) => {
  e.stopPropagation();
  closeIdMenu();
  openIntro();
});

// Waits for the name: the card says who you are, and "You are undefined" is
// worse than a beat of nothing.
if (!introSeen()) {
  const showWhenNamed = () => {
    if (!whoAmI()) return false;
    openIntro();
    return true;
  };
  if (!showWhenNamed()) {
    const t = setInterval(() => { if (showWhenNamed()) clearInterval(t); }, 250);
    setTimeout(() => clearInterval(t), 15000);
  }
}

function closeIdMenu() {
  idMenu.hidden = true;
  idChip.setAttribute("aria-expanded", "false");
}

function openIdMenu() {
  syncIdentityUi();
  idMenu.hidden = false;
  idChip.setAttribute("aria-expanded", "true");
}

idChip.addEventListener("click", (e) => {
  e.stopPropagation();
  if (idMenu.hidden) openIdMenu();
  else closeIdMenu();
});

$("[data-id-reroll]").addEventListener("click", (e) => {
  e.stopPropagation();
  const { prev, next } = reroll();
  if (state.filter === prev) set({ filter: null });
  syncIdentityUi();
  closeIdMenu();
  render();
  if (prev !== next) pulseClass(idChip, "is-rerolled");
});

document.addEventListener("click", (e) => {
  if (!idMenu.hidden && !e.target.closest(".idwrap")) closeIdMenu();
});

document.addEventListener("square:longpress", (e) => {
  set({ sheet: "owners", activeSq: e.detail.sq });
});

// --- render -----------------------------------------------------------------

const dayName = $("[data-day-name]");
const archiveBadge = $("[data-archive-badge]");
const filterChip = $("[data-filter-chip]");
const filterName = $("[data-filter-name]");
const closedBar = $("[data-closed]");
const closedLabel = $("[data-closed-label]");
const opensBox = $("[data-opens]");
const opensDay = $("[data-opens-day]");
const opensDate = $("[data-opens-date]");
const countdownPanel = $("[data-countdown-panel]");
const countdownBox = $("[data-countdown]");
const prevBtn = $("[data-day-prev]");
const nextBtn = $("[data-day-next]");

// Seven-segment countdown for the pre-open lock (Thursday). Which segments
// light for each digit; letters are the classic a-g (a top, then clockwise
// b c d e, f top-left, g middle). Built with createElement + class toggles
// only — no markup strings (hard rule 10).
const SEG_ON = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
  "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg"
};
const SEG_LETTERS = "abcdefg";

function buildDigit() {
  const d = document.createElement("span");
  d.className = "seg7";
  for (const s of SEG_LETTERS) {
    const el = document.createElement("span");
    el.className = "seg7__s seg7__" + s;
    d.appendChild(el);
  }
  return d;
}

let cdDigits = null;
function buildCountdown() {
  countdownBox.textContent = "";
  cdDigits = [];
  // HH:MM:SS — six digits with a colon after the hours and the minutes.
  for (const t of ["d", "d", ":", "d", "d", ":", "d", "d"]) {
    if (t === ":") {
      const c = document.createElement("span");
      c.className = "seg7-colon";
      countdownBox.appendChild(c);
    } else {
      const d = buildDigit();
      countdownBox.appendChild(d);
      cdDigits.push(d);
    }
  }
}

function paintCountdown(ms) {
  if (!cdDigits) buildCountdown();
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const hh = Math.min(99, Math.floor(total / 3600));
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const str =
    String(hh).padStart(2, "0") +
    String(mm).padStart(2, "0") +
    String(ss).padStart(2, "0");
  for (let i = 0; i < 6; i++) {
    const on = SEG_ON[str[i]] || "";
    const segs = cdDigits[i].children;
    for (let j = 0; j < 7; j++)
      segs[j].classList.toggle("is-on", on.includes(SEG_LETTERS[j]));
  }
}

function playDayTransition(dir) {
  dayName.style.setProperty("--day-dir", String(dir));
  stage.style.setProperty("--day-dir", String(dir));
  dayName.classList.remove("is-day-slide");
  stage.classList.remove("is-board-nudge");
  void dayName.offsetWidth;
  dayName.classList.add("is-day-slide");
  stage.classList.add("is-board-nudge");
  window.setTimeout(() => {
    dayName.classList.remove("is-day-slide");
    stage.classList.remove("is-board-nudge");
  }, 380);
}

// The sheet tabs light up when open; the filter tab also while a filter is
// active. Nothing lights up for zoom any more — the toolbar is gone and pinch
// is the control (ADR 0023).
function syncTabs() {
  const on = {
    archive: state.sheet === "archive",
    filter: state.sheet === "filter" || !!state.filter,
    read: state.sheet === "read",
    feedback: state.sheet === "feedback"
  };
  for (const btn of document.querySelectorAll("[data-open]"))
    btn.classList.toggle("is-on", !!on[btn.dataset.open]);
}

function render() {
  if (paintedDay != null && paintedDay !== state.day) {
    const oldI = ORDER.indexOf(paintedDay);
    const newI = ORDER.indexOf(state.day);
    playDayTransition(newI > oldI ? 1 : -1);
  }
  applyPalette(state.day);
  paintedDay = state.day;
  dayName.textContent = DAYCFG[state.day].name;
  document.body.classList.toggle("is-readonly", isReadOnly());
  document.body.classList.toggle("is-closed", state.frozen);
  closedBar.hidden = !state.frozen;
  if (state.frozen) closedLabel.textContent = CLOSED_MESSAGE;
  // Two kinds of read-only. A past card keeps the ARCHIVE badge and stays
  // fully readable; a card that has not opened yet is covered instead, and
  // says when it opens (spec section 8 keeps the archive viewable).
  const future = isFuture();
  // Before the con opens: the live card (Thursday) is covered by a countdown
  // instead of a date. Same blur as a future card; a genuinely future day still
  // shows its own OPENS panel above.
  const preopen = state.preOpen && !state.frozen && state.day === state.today;
  document.body.classList.toggle("is-future", future);
  document.body.classList.toggle("is-preopen", preopen);
  // The ARCHIVE badge means "a past card". A future day and the pre-open lock
  // are read-only too, but neither is an archive, so keep it off for both.
  archiveBadge.hidden = !isReadOnly() || future || preopen;
  opensBox.hidden = !future;
  if (future) {
    opensDay.textContent = DAYCFG[state.day].name;
    opensDate.textContent = dateLabel(state.day);
  }
  countdownPanel.hidden = !preopen;
  if (preopen) paintCountdown(msUntilOpen());
  filterChip.hidden = !state.filter;
  if (state.filter) filterName.textContent = state.filter;
  renderCounter();
  // Ends of the run: no wrap-around control. Keep the slot so the day name
  // stays centred. Read off ORDER rather than naming days, so the three-day
  // beta gets its arrows in the right places (ADR 0014).
  const atStart = state.day === ORDER[0];
  const atEnd = state.day === ORDER[ORDER.length - 1];
  prevBtn.style.visibility = atStart ? "hidden" : "";
  nextBtn.style.visibility = atEnd ? "hidden" : "";
  prevBtn.disabled = atStart;
  nextBtn.disabled = atEnd;
  // The undo stack is per day and per device: leaving a day (or landing on a
  // read-only one) puts the control away without forgetting anything.
  if (isReadOnly()) undo.sync(null);
  else undo.sync(state.day);
  syncIdentityUi();
  syncTabs();
  board.render();
  sheets.render();
  stats.render();
  evaluateBingo(state.day, { stage, grid });
}

onState(render);
store.subscribe(render);

// --- controls ---------------------------------------------------------------

prevBtn.addEventListener("click", () => { if (stepDay(-1)) zoom.reset(); });
nextBtn.addEventListener("click", () => { if (stepDay(1)) zoom.reset(); });

for (const btn of document.querySelectorAll("[data-open]")) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.open;
    set({ sheet: state.sheet === name ? null : name, activeSq: null });
  });
}

filterChip.addEventListener("click", () => set({ filter: null }));

$("[data-stats-open]").addEventListener("click", () => {
  if (stats.isOpen()) stats.close(); else stats.open();
});

// Share the board's URL, not a picture of it. `navigator.share` opens the
// platform's own app menu and is the whole implementation on a phone; on a
// desktop browser without it, copying the link is the honest fallback. The
// blurb is authored copy, so spec section 1 is untouched.
const SHARE_TEXT = "Come play emoji bingo with us.";
$("[data-share]").addEventListener("click", async () => {
  // Origin + path only. A hash or a cache-busting query is this device's
  // business, and a shared link should be the board, not this visit to it.
  const url = location.origin + location.pathname;
  const data = { title: document.title, text: SHARE_TEXT, url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    // A copy is invisible otherwise: nothing on screen changes, and the tab
    // lighting up for a moment does not say what happened.
    if (await copyLink(url)) showToast();
  } catch { /* dismissed, or no clipboard permission */ }
});

// --- sticker counter (spec section 7, ADR 0010/0012) ------------------------

// How many of today's 25 are left, and a shortcut to the squares already
// marked. The highlight is not a new mechanism: it is the existing player
// filter (sheets.js, cell.js `is-filter-muted`) pointed at this device's own
// name.
//
// Hold peeks — the filter is on only while the finger is down, and whatever
// was there before comes back on release. A plain click pins that same filter,
// which is what a keyboard or mouse has instead of a hold.
//
// Always today's board: the chip is hidden on archive days, where "left" has
// no meaning.

const capChip = $("[data-cap-chip]");
const capN = $("[data-cap-n]");
const capEmoji = $("[data-cap-emoji]");

function renderCounter() {
  const left = remaining(store.forDay(state.today), whoAmI());
  capN.textContent = String(left);
  capEmoji.textContent = defaultEmoji() || "";
  capChip.classList.toggle("is-spent", left === 0);
  capChip.classList.toggle("is-empty", !defaultEmoji());
}

// One gesture, one meaning (ADR 0027, retiring 0013). The chip used to hold two
// — a hold peeked at your own squares and a click pinned that filter — and the
// sticker it now carries needs the tap. The peek is not lost, only its
// shortcut: the player list still filters to any one player, including you.
capChip.addEventListener("click", () => {
  hideNotes();
  set({ activeSq: null, sheet: "emoji" });
});

// --- the close (ADR 0036) ---------------------------------------------------

// A device open across the cutoff flips without a reload; one that opens after
// it reads isFrozen() at boot in state.js. Null means the freeze is already
// past, or further out than a timer should hold.
function scheduleFreeze() {
  const ms = msUntilFreeze();
  if (ms == null) return;
  setTimeout(() => {
    set({ frozen: isFrozen() });
    scheduleFreeze();
  }, ms + 1000);
}
scheduleFreeze();

// --- 4am rollover -----------------------------------------------------------

// Recomputed after each fire rather than cached, because msUntilRollover is
// only correct relative to now (day.js).
function scheduleRollover() {
  setTimeout(() => {
    const today = currentDay();
    // Only follow the rollover if the viewer is on the live card; someone
    // reading an archive day at 4am should stay where they are.
    const follow = state.day === state.today;
    set({ today, ...(follow ? { day: today, filter: null } : {}) });
    scheduleRollover();
  }, msUntilRollover() + 1000);
}
scheduleRollover();

// --- pre-open countdown -----------------------------------------------------

// Tick the seven-segment display once a second while the board is still locked.
// The unlock is the wall clock, not the timer: when isPreOpen() flips false we
// clear preOpen and follow the rollover, which re-renders into the live board.
// A device open across midnight opens without a reload; one that opens later
// reads isPreOpen() at boot in state.js.
if (state.preOpen) {
  const cdTimer = setInterval(() => {
    if (isPreOpen()) {
      paintCountdown(msUntilOpen());
    } else {
      clearInterval(cdTimer);
      set({ preOpen: false, today: currentDay() });
    }
  }, 1000);
}

// --- go ---------------------------------------------------------------------

board.fit();
render();
applyFx();
// Embedded browsers (Cursor panel) can settle viewport metrics one frame late.
requestAnimationFrame(() => { board.fit(); });
requestAnimationFrame(() => requestAnimationFrame(() => { board.fit(); }));

// Connect after the first paint so the connecting banner is visible rather
// than a blank page. Stickers arrive via store.subscribe → render. Arrival
// motion stays off until the first synced snapshot is painted silently.
// Archive mode (ADR 0036): if the post-con snapshot exists, load it instead of
// joining a room — no playhtml, no websocket, read-only by construction.
(sync.loadArchive().then((a) => a ? sync.initFromArchive(a) : sync.init())).then(() => {
  for (const el of document.querySelectorAll(".grid .cell")) {
    el._primed = false;
    el._seenIds = new Set();
  }
  board.render();
  enableArrivalMotion();
  // Snapshot after the first synced paint so existing bingos never replay on
  // refresh or when another device opens the room.
  armBingo();
  // Only once the real board has arrived: grading an empty pre-sync card would
  // announce a finished day as a blank one, and mark it seen.
  stats.maybeAutoOpen();
}).catch(() => {
  enableArrivalMotion();
  armBingo();
});
