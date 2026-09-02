// The bottom sheets: emoji picker, filter, archive, readability, owners and
// feedback.
//
// Each is a static container in index.html; this module fills its list and
// keeps exactly one sheet open at a time behind a shared scrim. The sheets
// mount and unmount their contents rather than staying built, because the
// emoji grid alone is 280 buttons.

import { CATS } from "../data/emoji.js";
import { TOPICS } from "../data/feedback.js";
import { SQUARES } from "../data/squares.js";
import { DAYCFG, ORDER, DOTS } from "../data/theme.js";
import { buildCell } from "./cell.js";
import { state, set } from "./state.js";
import { all, forDay } from "./store.js";
import { whoAmI } from "./identity.js";
import {
  counts as voteCounts, mine as myVotes, toggle as toggleVote,
  notes as allNotes, postNote, removeNote, canPostNote
} from "./feedback.js";
import { NOTE_MAX } from "./validate.js";
import { isBeta } from "./edition.js";
import { displayIndex } from "./perm.js";
import { isFav, toggleFav, favSet } from "./favourites.js";

// Fixed sample used by the readability previews, so the three modes are
// compared against identical content.
const SAMPLE_TEXT = "parade crowd five deep";
const SAMPLE = ["🦖", "🍕", "🔮", "🎭", "🌿"].map((emoji, i) => ({
  id: "sample" + i, emoji, who: "", dx: (i - 2) * 9, dy: ((i % 2) ? 1 : -1) * 7, rot: (i - 2) * 5
}));
const MANY = ["🦖", "🍕", "🔮", "🚀", "🎭", "🌿", "🦋", "🐙", "🍩", "⚔️", "🎪", "✦"]
  .map((emoji, i) => ({
    id: "many" + i, emoji, who: "",
    dx: Math.cos(i * 1.7) * 17, dy: Math.sin(i * 2.3) * 15, rot: (i % 5 - 2) * 6
  }));

const PREVIEW_K = 88 / 66;   // the mockup's preview cell is 88px

// Mockup coord chip: column letter + row number (A1 … E5). The argument is a
// DISPLAY position, not a stored square — a coordinate names a seat on the
// board you are looking at, and two players' boards differ (ADR 0024).
export function squareCoord(i) {
  return "ABCDE"[i % 5] + (Math.floor(i / 5) + 1);
}

export function createSheets(els) {
  const {
    scrim, sheets, cats, catLabel, emojis, players, playerFind, favsOnly,
    days, readModes, stackModes,
    ownerCoord, ownerText, ownerList, feedback,
    notebox, noteInput, noteSend, noteCount, noteFull, notes
  } = els;
  let activeCat = CATS[0].id;
  let catSpy = null;

  function close() {
    if (state.sheet) set({ sheet: null, activeSq: null });
  }

  scrim.addEventListener("click", close);

  // Search and the favourites toggle (ADR 0026).
  if (playerFind) {
    playerFind.addEventListener("input", () => {
      query = playerFind.value;
      fillFilter();
    });
  }
  if (favsOnly) {
    favsOnly.addEventListener("click", () => {
      // Turning it on while a single player is picked would do nothing visible,
      // so the pick is cleared: the player asked for the group instead.
      const next = !state.favOnly;
      set({ favOnly: next, filter: next ? null : state.filter });
      fillFilter();
    });
  }

  // --- emoji picker -------------------------------------------------------
  function setActiveCat(id) {
    activeCat = id;
    for (const b of cats.querySelectorAll(".cats__btn"))
      b.classList.toggle("is-on", b.dataset.cat === id);
    if (catLabel) catLabel.textContent = CATS.find((c) => c.id === id)?.label || "";
  }

  function jumpToCat(id) {
    const sec = emojis.querySelector(`[data-cat-section="${id}"]`);
    if (sec) {
      sec.scrollIntoView({ block: "start" });
      setActiveCat(id);
    }
  }

  function wireCatSpy() {
    catSpy?.disconnect();
    const heads = emojis.querySelectorAll("[data-cat-head]");
    if (!heads.length) return;
    catSpy = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveCat(visible[0].target.dataset.catHead);
    }, { root: emojis, rootMargin: "-2px 0px -72% 0px", threshold: 0 });
    for (const h of heads) catSpy.observe(h);
  }

  function fillEmoji() {
    if (emojis.dataset.built) {
      wireCatSpy();
      setActiveCat(activeCat);
      return;
    }
    emojis.dataset.built = "1";

    cats.replaceChildren();
    for (const c of CATS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cats__btn";
      b.dataset.cat = c.id;
      // The word, not the category's emoji. An emoji on a control in a sheet
      // full of tappable emoji reads as one of them, and people tried to place
      // it. `icon` stays in the data; nothing draws it.
      b.textContent = c.label;
      b.addEventListener("click", () => jumpToCat(c.id));
      cats.appendChild(b);
    }

    emojis.replaceChildren();
    for (const c of CATS) {
      const sec = document.createElement("section");
      sec.className = "emojiscroll__sec";
      sec.dataset.catSection = c.id;
      const head = document.createElement("h3");
      head.className = "emojiscroll__head";
      head.dataset.catHead = c.id;
      head.textContent = c.label;
      sec.appendChild(head);
      const grid = document.createElement("div");
      grid.className = "emojigrid";
      for (const ch of c.list) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emojigrid__btn";
        btn.textContent = ch;
        btn.addEventListener("click", () => els.onPlace(ch));
        grid.appendChild(btn);
      }
      sec.appendChild(grid);
      emojis.appendChild(sec);
    }

    setActiveCat(CATS[0].id);
    wireCatSpy();
  }

  // --- filter -------------------------------------------------------------
  // What the search box holds. Never stored, never synced, never rendered —
  // it only decides which curated names stay on screen (ADR 0026).
  let query = "";

  function fillFilter() {
    const list = forDay(state.day);
    const me = whoAmI();
    const favs = favSet();
    const counts = new Map();
    for (const s of list) counts.set(s.who, (counts.get(s.who) || 0) + 1);
    // Always list this device first, even with zero stickers today.
    if (!counts.has(me)) counts.set(me, 0);
    // You, then your favourites, then everyone else by how much they played.
    // A room gets long at the con and short in a friend beta, which is exactly
    // when the ordering starts to matter.
    const names = [...counts.keys()].sort((a, b) => {
      if (a === me) return -1;
      if (b === me) return 1;
      const fa = favs.has(a), fb = favs.has(b);
      if (fa !== fb) return fa ? -1 : 1;
      return counts.get(b) - counts.get(a);
    });

    const q = query.trim().toLowerCase();
    const shown = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;

    players.replaceChildren();
    for (const [i, name] of shown.entries()) {
      const row = document.createElement("div");
      row.className = "player";
      row.classList.toggle("is-on", state.filter === name);
      row.classList.toggle("is-me", name === me);
      row.style.setProperty("--dot", DOTS[i % DOTS.length]);

      // The row is a div holding two buttons rather than one button holding
      // another: a button inside a button is invalid, and the star and the
      // filter are genuinely two different actions on one line.
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "player__pick";
      const dot = document.createElement("span"); dot.className = "player__dot";
      const nm = document.createElement("span"); nm.className = "player__name"; nm.textContent = name;
      const peek = document.createElement("span"); peek.className = "player__peek";
      for (const s of list.filter((x) => x.who === name).slice(0, 3)) {
        const e = document.createElement("span");
        e.className = "player__peek-em";
        e.textContent = s.emoji;
        peek.appendChild(e);
      }
      const n = document.createElement("span");
      n.className = "player__count";
      n.textContent = String(counts.get(name));
      pick.append(dot, nm, peek, n);
      pick.addEventListener("click", () => {
        set({ filter: state.filter === name ? null : name, sheet: null });
      });

      const star = document.createElement("button");
      star.type = "button";
      star.className = "player__star";
      star.textContent = "\u2605";
      star.classList.toggle("is-on", isFav(name));
      star.setAttribute("aria-pressed", isFav(name) ? "true" : "false");
      star.setAttribute("aria-label", "Favourite " + name);
      star.addEventListener("click", () => {
        toggleFav(name);
        fillFilter();
        // The board may be showing favourites only, so it has to follow.
        set({});
      });

      // Star first: in a room-length list you scan for your friends, not for
      // the counts (ADR 0026).
      row.append(star, pick);
      players.appendChild(row);
    }
    players.classList.toggle("is-empty", shown.length === 0);
    players.classList.toggle("is-nomatch", shown.length === 0 && names.length > 0);
    if (favsOnly) {
      favsOnly.classList.toggle("is-on", state.favOnly);
      favsOnly.setAttribute("aria-pressed", state.favOnly ? "true" : "false");
    }
  }

  // --- archive ------------------------------------------------------------
  function fillArchive() {
    const everything = all();
    days.replaceChildren();
    for (const id of ORDER) {
      const cfg = DAYCFG[id];
      const ds = everything.filter((s) => s.day === id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      b.classList.toggle("is-on", id === state.day);
      b.classList.toggle("is-live", id === state.today);
      b.style.setProperty("--accent", cfg.accent);
      const label = document.createElement("span");
      label.className = "day__label";
      label.textContent = cfg.name.slice(0, 3);   // mockup: THU / FRI / SAT ...
      const mini = document.createElement("span");
      mini.className = "day__mini";
      for (let i = 0; i < 25; i++) {
        const n = ds.filter((s) => s.sq === i).length;
        const c = document.createElement("span");
        c.className = "day__cell";
        // Mockup: a filled minigrid cell is the day accent at .32 + .16 per
        // sticker; an empty one is flat lavender, not a faded accent.
        c.classList.toggle("is-on", n > 0);
        c.style.setProperty("--fill", n ? Math.min(1, 0.32 + n * 0.16).toFixed(2) : "1");
        mini.appendChild(c);
      }
      const count = document.createElement("span");
      count.className = "day__count";
      count.textContent = String(ds.length);
      b.append(label, mini, count);
      b.addEventListener("click", () => {
        set({ day: id, filter: null, sheet: null, activeSq: null });
      });
      days.appendChild(b);
    }
  }

  // --- owner list (spec section 6) ----------------------------------------
  // Open question 3: scroll, newest first. No cap — the sheet scrolls.
  function fillOwners() {
    const sq = state.activeSq;
    if (sq == null) return;
    const stickers = forDay(state.day)
      .filter((s) => s.sq === sq)
      .sort((a, b) => b.t - a.t);
    ownerCoord.textContent = squareCoord(displayIndex(whoAmI(), sq));
    ownerText.textContent = SQUARES[state.day][sq];
    ownerList.replaceChildren();
    for (const s of stickers) {
      const row = document.createElement("div");
      row.className = "owner";
      const em = document.createElement("span");
      em.className = "owner__emoji";
      em.textContent = s.emoji;
      const who = document.createElement("span");
      who.className = "owner__name";
      who.textContent = s.who;
      row.append(em, who);
      ownerList.appendChild(row);
    }
    ownerList.classList.toggle("is-empty", stickers.length === 0);
  }

  // --- readability --------------------------------------------------------
  function modeButton(container, { id, label, cellOpts, onClick, on }) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode";
    b.classList.toggle("is-on", on);
    b.dataset.mode = id;
    const preview = document.createElement("span");
    preview.className = "mode__preview";
    preview.appendChild(buildCell({ ...cellOpts, k: PREVIEW_K }));
    const l = document.createElement("span");
    l.className = "mode__label";
    l.textContent = label;
    b.append(preview, l);
    b.addEventListener("click", onClick);
    container.appendChild(b);
  }

  function fillRead() {
    readModes.replaceChildren();
    for (const [id, label] of [["halo", "HALO"], ["caption", "CAPTION"], ["dim", "FADED"]]) {
      modeButton(readModes, {
        id, label, on: state.textMode === id,
        cellOpts: { text: SAMPLE_TEXT, stickers: SAMPLE, mode: id, stack: "shrink" },
        onClick: () => { set({ textMode: id }); fillRead(); }
      });
    }
    stackModes.replaceChildren();
    for (const [id, label] of [["shrink", "SHRINK TO FIT"], ["overflow", "FIRST 4 + COUNT"]]) {
      modeButton(stackModes, {
        id, label, on: state.stackMode === id,
        cellOpts: { text: "", stickers: MANY, mode: "halo", stack: id },
        onClick: () => { set({ stackMode: id }); fillRead(); }
      });
    }
  }

  // --- feedback (ADR 0015) ------------------------------------------------
  // Tallies are public, like everything else on the board: this is a friend
  // group, and seeing that two other people already said "text too small" is
  // the thing that makes a third person bother to tap it.
  function fillFeedback() {
    notebox.hidden = !isBeta;
    if (isBeta) {
      wireNotes();
      fillNotes();
      syncNoteControls();
    }
    const tally = voteCounts();
    const chosen = myVotes();
    feedback.replaceChildren();
    for (const topic of TOPICS) {
      const n = tally.get(topic.id) || 0;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fb";
      b.classList.toggle("is-on", chosen.has(topic.id));
      b.setAttribute("aria-pressed", chosen.has(topic.id) ? "true" : "false");
      const icon = document.createElement("span");
      icon.className = "fb__icon";
      icon.textContent = topic.icon;
      const label = document.createElement("span");
      label.className = "fb__label";
      label.textContent = topic.label;
      const count = document.createElement("span");
      count.className = "fb__count";
      count.classList.toggle("is-zero", n === 0);
      count.textContent = String(n);
      b.append(icon, label, count);
      // No re-fill here: the write lands in sync, which notifies the store,
      // which re-renders this sheet. Refilling now would double-paint.
      b.addEventListener("click", () => { toggleVote(topic.id); });
      feedback.appendChild(b);
    }
  }

  // --- free-text notes (ADR 0016, beta only) ------------------------------
  // The field is wired once; only its contents are refilled. Rebuilding a
  // textarea on every sync frame would eat the keystroke the player is
  // halfway through typing.
  let notesWired = false;

  function syncNoteControls() {
    const text = noteInput.value.trim();
    const room = canPostNote();
    noteSend.disabled = text === "" || !room;
    noteFull.hidden = room;
    noteInput.disabled = !room;
    const left = NOTE_MAX - noteInput.value.length;
    // Only worth saying when it is nearly spent; a permanent 280 is noise.
    noteCount.textContent = left <= 40 ? String(left) : "";
  }

  function wireNotes() {
    if (notesWired) return;
    notesWired = true;
    noteInput.addEventListener("input", syncNoteControls);
    noteInput.addEventListener("keydown", (e) => {
      // Enter sends, shift+enter is not offered: notes collapse to one line at
      // ingest anyway, so a multi-line note would not survive the round trip.
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      send();
    });
    noteSend.addEventListener("click", send);
  }

  function send() {
    if (!postNote(noteInput.value)) return;
    noteInput.value = "";
    syncNoteControls();
  }

  function fillNotes() {
    notes.replaceChildren();
    const me = whoAmI();
    for (const n of allNotes()) {
      const row = document.createElement("div");
      row.className = "note";
      row.classList.toggle("is-mine", n.who === me);
      const who = document.createElement("span");
      who.className = "note__who";
      who.textContent = n.who;
      const body = document.createElement("p");
      body.className = "note__text";
      // textContent, never markup. This is the one string in the app that a
      // person typed (ADR 0016).
      body.textContent = n.text;
      row.append(who, body);
      if (n.who === me) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "note__del";
        del.setAttribute("aria-label", "Delete this note");
        del.textContent = "×";
        del.addEventListener("click", () => { removeNote(n.id); });
        row.appendChild(del);
      }
      notes.appendChild(row);
    }
    notes.classList.toggle("is-empty", allNotes().length === 0);
  }

  const FILL = {
    emoji: fillEmoji, filter: fillFilter, archive: fillArchive,
    read: fillRead, owners: fillOwners, feedback: fillFeedback
  };

  // Called on every state or store change. The open sheet is refilled each
  // time so its contents stay live (a new sticker changes the filter counts
  // and the archive minigrids); closed sheets are emptied so 280 emoji
  // buttons are not sitting in the document.
  function render() {
    const open = state.sheet;
    scrim.hidden = !open;
    for (const [name, el] of Object.entries(sheets)) {
      el.hidden = name !== open;
    }
    if (open) FILL[open]();
    else if (catSpy) { catSpy.disconnect(); catSpy = null; }
  }

  return { render, close, squareText: (i) => SQUARES[state.day][i] };
}
