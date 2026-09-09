// Admin console bootstrap (spec section 9, ADR 0002 / 0003 / 0004).
//
// Gate first: nothing renders and playhtml is not loaded / init'd until unlock.
// sync.js (and its CDN import) is dynamically imported only after the gate
// passes so a wrong passphrase opens no collaboration network.
//
// Writes go through store.js — remove (mutator), clearSquare (mutator),
// nukeDay (value form, ADR 0004's sole exception).

import { DAYCFG, ORDER } from "../data/theme.js";
import { SQUARES } from "../data/squares.js";
import { currentDay, isFrozen, CLOSED_MESSAGE } from "./day.js";
import { EDITION } from "./edition.js";
import { isConfigured, isUnlocked, unlock, hasWebCrypto } from "./gate.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Same formula as sheets.squareCoord — inlined so this module does not import
// sheets.js (which pulls store → sync → playhtml before the gate opens).
function squareCoord(i) {
  return "ABCDE"[i % 5] + (Math.floor(i / 5) + 1);
}

const gateEl = $("[data-gate]");
const adminEl = $("[data-admin]");
const gateForm = $("[data-gate-form]");
const gateInput = $("[data-gate-input]");
const gateSubmit = $("[data-gate-submit]");
const gateErr = $("[data-gate-err]");
const gateUnset = $("[data-gate-unset]");
const gateInsecure = $("[data-gate-insecure]");
const gateWhere = $("[data-gate-where]");

// Which board is about to be administered, in the terms the organizer thinks
// in: the host and the project path off the address bar, plus which build this
// is. Never the room id — that string is the whole of this app's privacy
// (ADR 0002) and does not belong on a screen anyone can be looking over.
if (gateWhere) {
  const seg = location.pathname.split("/").filter(Boolean);
  const project = seg.length > 1 ? "/" + seg[0] : "";
  gateWhere.textContent = location.host + project + " · " + EDITION;
}

const dayNameEl = $("[data-day-name]");
const heatEl = $("[data-heat]");
const listEl = $("[data-list]");
const listLabelEl = $("[data-list-label]");
const pickedEl = $("[data-picked]");
const pickedCoord = $("[data-picked-coord]");
const pickedText = $("[data-picked-text]");
const clearBtn = $("[data-clear]");
const nukeBtn = $("[data-nuke]");
const nukeFill = $("[data-nuke-fill]");
const closedEl = $("[data-closed]");
const closedLabel = $("[data-closed-label]");
const nukeLabel = $("[data-nuke-label]");
const connBar = $("[data-conn]");
const connLabel = $("[data-conn-label]");
const exportEl = $("[data-export]");
const exportBtn = $("[data-export-btn]");

const NUKE_MS = 1600;
const LIST_CAP = 30;

/** @type {typeof import("./store.js") | null} */
let store = null;
/** @type {typeof import("./sync.js") | null} */
let sync = null;

let day = currentDay();
let adminSq = null; // number | null
let entered = false;
let nukeTimer = null;

function applyPalette(d) {
  const c = DAYCFG[d];
  const root = document.documentElement.style;
  root.setProperty("--accent", c.accent);
  root.setProperty("--cell", c.cell);
  root.setProperty("--cell-on", c.cellOn);
  document.documentElement.dataset.day = d;
}

function ago(t, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 60) return mins + "m";
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return hrs + "h";
  return Math.floor(hrs / 24) + "d";
}

function dayList() {
  return store.forDay(day);
}

function stepDay(n) {
  const i = ORDER.indexOf(day);
  const j = Math.max(0, Math.min(ORDER.length - 1, i + n));
  if (j === i) return;
  day = ORDER[j];
  adminSq = null;
  applyPalette(day);
  render();
}

function wireChrome() {
  $("[data-day-prev]").addEventListener("click", () => stepDay(-1));
  $("[data-day-next]").addEventListener("click", () => stepDay(1));

  clearBtn.addEventListener("click", () => {
    if (adminSq == null) return;
    store.clearSquare(day, adminSq);
    adminSq = null;
    render();
  });

  const stopNuke = () => {
    if (nukeTimer != null) {
      clearInterval(nukeTimer);
      nukeTimer = null;
    }
    nukeFill.style.width = "0%";
    nukeLabel.textContent = "NUKE";
  };

  const startNuke = (e) => {
    e.preventDefault();
    stopNuke();
    const t0 = Date.now();
    nukeLabel.textContent = "HOLD…";
    nukeTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / NUKE_MS);
      nukeFill.style.width = (p * 100) + "%";
      if (p >= 1) {
        clearInterval(nukeTimer);
        nukeTimer = null;
        // Value-form wipe lives inside store.nukeDay → sync.nukeDay (ADR 0004).
        store.nukeDay(day);
        adminSq = null;
        stopNuke();
        render();
      }
    }, 40);
  };

  nukeBtn.addEventListener("pointerdown", startNuke);
  nukeBtn.addEventListener("pointerup", stopNuke);
  nukeBtn.addEventListener("pointerleave", stopNuke);
  nukeBtn.addEventListener("pointercancel", stopNuke);
  nukeBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  // Tap outside the heat map to show all stickers again (mockup: adminSq clears).
  adminEl.addEventListener("click", (e) => {
    if (adminSq == null) return;
    if (e.target.closest(".admin__heat")) return;
    adminSq = null;
    render();
  });
}

function renderHeat(list) {
  const counts = Array.from({ length: 25 }, () => 0);
  for (const s of list) counts[s.sq]++;

  if (!heatEl.childElementCount) {
    for (let i = 0; i < 25; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin__heat-cell";
      btn.dataset.sq = String(i);
      btn.addEventListener("click", () => {
        adminSq = adminSq === i ? null : i;
        render();
      });
      heatEl.appendChild(btn);
    }
  }

  $$(".admin__heat-cell", heatEl).forEach((btn, i) => {
    const n = counts[i];
    btn.textContent = n ? String(n) : "";
    btn.classList.toggle("is-picked", adminSq === i);
    btn.classList.toggle("is-hot", n > 0 && adminSq !== i);
    if (adminSq === i) {
      btn.style.background = "";
      btn.style.color = "";
    } else if (n > 0) {
      const a = Math.min(1, 0.3 + n * 0.14);
      btn.style.background = "rgba(247, 209, 23, " + a + ")";
      btn.style.color = "#2a0b3d";
    } else {
      btn.style.background = "";
      btn.style.color = "";
    }
  });
}

function renderList(list) {
  const scoped = adminSq == null ? list : list.filter((s) => s.sq === adminSq);
  // Newest first (label + ADR 0006 spirit); mockup sort was inverted.
  const rows = scoped.slice().sort((a, b) => b.t - a.t).slice(0, LIST_CAP);
  const texts = SQUARES[day];

  listLabelEl.textContent = adminSq == null
    ? "ALL STICKERS · NEWEST FIRST"
    : "SQUARE " + squareCoord(adminSq) + " · " + scoped.length + " STICKERS";

  listEl.replaceChildren();
  for (const s of rows) {
    const row = document.createElement("div");
    row.className = "admin__row";

    const emoji = document.createElement("span");
    emoji.className = "admin__row-emoji";
    emoji.textContent = s.emoji;

    const body = document.createElement("div");
    body.className = "admin__row-body";
    const who = document.createElement("div");
    who.className = "admin__row-who";
    who.textContent = s.who || "—";
    const where = document.createElement("div");
    where.className = "admin__row-where";
    where.textContent = texts[s.sq] || "";
    body.append(who, where);

    const agoEl = document.createElement("span");
    agoEl.className = "admin__row-ago";
    agoEl.textContent = ago(s.t);

    const x = document.createElement("button");
    x.type = "button";
    x.className = "admin__row-x";
    x.setAttribute("aria-label", "Remove sticker");
    x.textContent = "×";
    x.disabled = isFrozen();
    x.addEventListener("click", () => {
      store.remove(s.id);
      render();
    });

    row.append(emoji, body, agoEl, x);
    listEl.appendChild(row);
  }
}

function renderStats(list) {
  const players = new Set(list.map((s) => s.who).filter(Boolean));
  const filled = new Set(list.map((s) => s.sq)).size;
  $("[data-stat-stickers]").textContent = String(list.length);
  $("[data-stat-players]").textContent = String(players.size);
  $("[data-stat-filled]").textContent = filled + "/25";
}

function renderPicked() {
  if (adminSq == null) {
    pickedEl.hidden = true;
    clearBtn.disabled = true;
    clearBtn.textContent = "SELECT A SQUARE";
    return;
  }
  pickedEl.hidden = false;
  pickedCoord.textContent = "SQUARE " + squareCoord(adminSq);
  pickedText.textContent = SQUARES[day][adminSq] || "";
  clearBtn.disabled = false;
  clearBtn.textContent = "CLEAR " + squareCoord(adminSq);
}

function render() {
  dayNameEl.textContent = DAYCFG[day].name;
  dayNameEl.style.color = DAYCFG[day].accent;
  const list = dayList();
  renderStats(list);
  renderHeat(list);
  renderPicked();
  renderList(list);
  renderClosed();
  renderExport();
}

// After the freeze the console reads the board and writes nothing (ADR 0036).
// store.js refuses the writes anyway; this is so the buttons stop lying about
// what they will do. Moderating a sticker from here on means editing the
// exported snapshot.
function renderClosed() {
  const closed = isFrozen();
  closedEl.hidden = !closed;
  if (closed) closedLabel.textContent = CLOSED_MESSAGE;
  document.body.classList.toggle("is-closed", closed);
  if (closed) {
    clearBtn.disabled = true;
    nukeBtn.disabled = true;
  }
}

function renderExport() {
  const frozen = isFrozen();
  exportEl.hidden = !frozen;
}

function doExport() {
  const all = sync.allStickers();
  const byDay = {};
  for (const k of ORDER) byDay[k] = [];
  for (const s of all) {
    if (byDay[s.day]) byDay[s.day].push(s);
  }
  const year = new Date().getFullYear();
  const payload = { exported: new Date().toISOString(), days: byDay };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "archive-" + year + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

function wireConn() {
  const COPY = {
    connecting: "Connecting…",
    offline: "Offline — will sync when back",
    live: ""
  };
  sync.onConnection((c) => {
    connBar.dataset.state = c;
    connLabel.textContent = COPY[c] || "";
    connBar.hidden = c === "live";
  });
}

async function enterAdmin() {
  if (entered) return;
  entered = true;

  // Load playhtml only after unlock (ADR 0003 exit: wrong passphrase → no net).
  store = await import("./store.js");
  sync = await import("./sync.js");

  gateEl.hidden = true;
  adminEl.hidden = false;
  applyPalette(day);
  wireChrome();
  exportBtn.addEventListener("click", doExport);
  wireConn();
  store.subscribe(render);
  sync.onLiveCount((n) => {
    $("[data-stat-live]").textContent = String(n);
  });
  render();

  try {
    const archive = await sync.loadArchive();
    if (archive) {
      sync.initFromArchive(archive);
    } else {
      await sync.init();
    }
  } catch {
    // Banner already shows offline; console still usable once data arrives.
  }
  render();
}

function showGate() {
  gateEl.hidden = false;
  adminEl.hidden = true;
  if (!isConfigured()) {
    gateUnset.hidden = false;
    gateSubmit.disabled = true;
    gateInput.disabled = true;
  } else {
    gateInput.focus();
  }
}

gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  gateErr.hidden = true;
  // Said before the wait, not after it: on a LAN address there is no
  // crypto.subtle, so the derivation cannot even start.
  if (!hasWebCrypto()) {
    gateInsecure.hidden = false;
    return;
  }
  if (!isConfigured()) {
    gateUnset.hidden = false;
    return;
  }
  gateSubmit.disabled = true;
  gateSubmit.textContent = "Checking…";
  try {
    let ok = false;
    try {
      ok = await unlock(gateInput.value);
    } catch {
      // Nothing here should throw once crypto.subtle exists — but a thrown
      // unlock that says nothing is indistinguishable from a hang.
      gateInsecure.hidden = false;
      return;
    }
    if (!ok) {
      gateErr.hidden = false;
      gateInput.select();
      return;
    }
    gateSubmit.textContent = "Opening…";
    await enterAdmin();
  } finally {
    if (!entered) {
      gateSubmit.disabled = false;
      gateSubmit.textContent = "Unlock";
    }
  }
});

// Boot: cached unlock skips the form; otherwise only the gate is visible and
// playhtml is not loaded.
if (isUnlocked() && isConfigured()) {
  enterAdmin();
} else {
  showGate();
}
