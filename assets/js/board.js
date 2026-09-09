// The 5x5 grid: builds it once, updates cells in place, and owns the tap and
// long-press gestures on a square.
//
// Sizing: the mockup was pinned to a 390px-wide phone with a 366px grid. Here
// the natural content box (header row + grid) is measured against the real
// stage and expressed as `--k` on .stage__pan, so the board fills whatever
// phone it lands on without ever scrolling (spec section 3). Every size in
// app.css is a multiple of --k.

import { SQUARES } from "../data/squares.js";
import { buildCell, updateCell, seatStickers } from "./cell.js";
import { state, isReadOnly } from "./state.js";
import { forDay } from "./store.js";
import { whoAmI } from "./identity.js";
import { LONG_PRESS_MS, swallowGhostClick } from "./press.js";
import { isBeta } from "./edition.js";
import { permFor } from "./perm.js";
import { favSet } from "./favourites.js";

export const NATURAL_W = 366;   // grid width at --k: 1
export const NATURAL_H = 415;   // header row + gap + grid height at --k: 1

// The undo pill is an overlay on the stage, so it lives in the slack under the
// board (ADR 0030). On a short phone there is no slack and it lands on the
// bottom row. Reserve its strip out of the height the board is fitted into —
// always, whether or not the pill is showing, so appearing and disappearing
// still never retunes --k.
const UNDO_RESERVE = 42;   // pill height + its 10px offset, at --k: 1

// Five letters, one per grid column. The beta card is not about the con, so it
// says what it is instead (ADR 0014); both strings are exactly five characters
// or the header stops lining up with the columns.
const HEADER = (isBeta ? "BINGO" : "D-CON").split("");

export function createBoard({ pan, grid, hdr, stage, zoom, onPick }) {
  for (const ch of HEADER) {
    const s = document.createElement("span");
    s.className = "hdr__ch";
    s.textContent = ch;
    hdr.appendChild(s);
  }

  // `dataset.sq` is the STORED square index, not the position in the grid — the
  // two differ once the board is permuted (ADR 0024). render() rewrites it, so
  // placement, the caps and the owner sheet all keep working in stored space
  // and never need to know about the permutation.
  const cells = [];
  for (let i = 0; i < 25; i++) {
    const el = buildCell({ text: "", stickers: [], mode: state.textMode, stack: state.stackMode });
    el.dataset.sq = String(i);
    grid.appendChild(el);
    cells.push(el);
  }

  // Where inside the square the finger landed, so the sticker lands there
  // rather than dead centre. Mockup: +/-21px of jitter at k = 1.
  let tapPt = { u: 0.5, v: 0.5 };
  // Screen coordinates of the current press, for the ghost-click guard above.
  let pressXY = { x: 0, y: 0 };
  let pressTimer = null;
  let longPressed = false;

  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };

  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    tapPt = { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
    pressXY = { x: e.clientX, y: e.clientY };
    longPressed = false;
    cancelPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      // The owner sheet opens while the finger is still down, so the click that
      // follows the lift needs the same guard as a tap.
      if (e.pointerType !== "mouse") swallowGhostClick(pressXY.x, pressXY.y);
      // Phase 4 listens for this to show the owner list (spec section 6).
      cell.dispatchEvent(new CustomEvent("square:longpress", {
        bubbles: true, detail: { sq: Number(cell.dataset.sq) }
      }));
    }, LONG_PRESS_MS);
  });

  grid.addEventListener("pointerup", (e) => {
    cancelPress();
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (longPressed) { longPressed = false; return; }
    if (zoom.moved() || isReadOnly()) return;
    // Arm the guard before onPick, because onPick opens the sheet synchronously.
    if (e.pointerType !== "mouse") swallowGhostClick(e.clientX, e.clientY);
    onPick(Number(cell.dataset.sq), tapPt);
  });

  grid.addEventListener("pointerleave", cancelPress);
  grid.addEventListener("pointercancel", cancelPress);

  // Pin the shell to the *visible* viewport. Cursor/Electron webviews often
  // report innerHeight larger than the painted panel; visualViewport is tighter.
  function visibleBottom() {
    // Cursor Simple Browser embeds the page in an iframe; frameElement is the
    // actual painted panel — more reliable than innerHeight when they diverge.
    const frame = window.frameElement;
    if (frame) return frame.getBoundingClientRect().bottom;
    const vv = window.visualViewport;
    return vv ? vv.offsetTop + vv.height : window.innerHeight;
  }

  function syncShell() {
    const app = document.querySelector(".app");
    const vv = window.visualViewport;
    if (!app) return;
    const top = vv?.offsetTop ?? 0;
    const left = vv?.offsetLeft ?? 0;
    const w = vv?.width ?? window.innerWidth;
    let h = vv?.height ?? window.innerHeight;
    const frame = window.frameElement;
    if (frame) h = Math.min(h, frame.getBoundingClientRect().height);
    // Publish the visual viewport for anything anchored to the bottom of the
    // screen: a fixed sheet at `bottom: 0` sits behind the software keyboard,
    // because the keyboard moves the visual viewport and leaves the layout one
    // alone. --vv-bottom is how far the keyboard (or a browser bar) has pushed
    // the visible bottom up; --vv-h is what is left to be seen.
    const root = document.documentElement;
    root.style.setProperty("--vv-bottom", `${Math.max(0, Math.round(window.innerHeight - (top + h)))}px`);
    root.style.setProperty("--vv-h", `${Math.round(h)}px`);
    app.style.top = `${top}px`;
    app.style.left = `${left}px`;
    app.style.width = `${w}px`;
    app.style.height = `${h}px`;
  }

  // Embedded panels (Cursor Simple Browser) can report a height that still
  // clips the tab bar. Shrink the shell until IO sees the bar fully visible.
  let clipPasses = 0;
  function shrinkShellForClip(hiddenPx) {
    if (clipPasses > 12 || hiddenPx <= 0) return;
    const app = document.querySelector(".app");
    if (!app) return;
    clipPasses++;
    const cur = parseFloat(app.style.height) || window.innerHeight;
    app.style.height = `${Math.max(320, cur - hiddenPx - 2)}px`;
    void app.offsetHeight;
    fit();
  }

  function correctShellClip(entry) {
    if (!entry || entry.intersectionRatio >= 0.99) return;
    const hidden = entry.boundingClientRect.bottom - entry.intersectionRect.bottom;
    shrinkShellForClip(hidden);
  }

  // Height the day name takes out of the stage, measured rather than assumed:
  // it wraps differently at small widths.
  function dayStepH() {
    const el = stage.querySelector(".daystep");
    return el ? el.getBoundingClientRect().height : 0;
  }

  // The disclaimer sits in a fixed-height slot (app.css) and must never grow
  // out of it: every pixel it took would come off the board. Shrink the type
  // until the sentence fits the slot it was given. Widths and font settings
  // both change what fits, so this is re-run on every fit.
  const DISC_MAX = 8.2;   // px, the size the mockup asked for
  const DISC_MIN = 5.8;   // px, below this it is decoration rather than notice
  function fitDisclaimer() {
    const box = document.querySelector(".disclaimer");
    const txt = box?.querySelector(".disclaimer__txt");
    if (!box || !txt) return;
    const s = getComputedStyle(box);
    const avail = box.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
    if (avail <= 0) return;
    let fs = DISC_MAX;
    box.style.setProperty("--disclaimer-fs", `${fs}px`);
    while (fs > DISC_MIN && txt.getBoundingClientRect().height > avail) {
      fs = Math.round((fs - 0.2) * 10) / 10;
      box.style.setProperty("--disclaimer-fs", `${fs}px`);
    }
  }

  function fit() {
    syncShell();
    fitDisclaimer();
    void stage.offsetHeight; // reflow after shell resize
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const visBottom = visibleBottom();
    let availW = r.width;
    // The day name is a flex child of the stage now, so the board only gets
    // what is left under it.
    let availH = r.height - (dayStepH());
    if (r.bottom > visBottom + 1) availH = Math.max(0, visBottom - r.top);
    // Keep the undo pill's strip clear of the board (see UNDO_RESERVE).
    availH = Math.max(0, availH - UNDO_RESERVE);
    let k = Math.min(availW / NATURAL_W, availH / NATURAL_H);
    pan.style.setProperty("--k", k.toFixed(4));
    const tab = document.querySelector(".tabbar");
    const bottom = tab?.getBoundingClientRect().bottom ?? 0;
    if (bottom > visBottom + 1) shrinkShellForClip(bottom - visBottom);
    // The sticker ring is measured off the label box, and the label box scales
    // with --k, so every fit has to re-seat (phase 6d).
    for (const c of cells) seatStickers(c);
  }

  function fitAndClip() {
    clipPasses = 0;
    fit();
  }

  function render() {
    const texts = SQUARES[state.day];
    const day = forDay(state.day);
    const filter = state.filter;
    // Recomputed per render rather than captured once: a reroll changes it,
    // and the "mine" ring has to follow the name the player has now.
    const me = whoAmI();
    // Your board order (ADR 0024). Display position i shows square perm[i] —
    // its text and its stickers travel together, only the seat moves.
    const perm = permFor(me);
    // Favourites filter (ADR 0026): the board keeps your own stickers and your
    // favourites' and drops the rest. A single-player filter wins outright —
    // picking one person is a more specific request than picking a group, and
    // stacking the two would answer neither.
    const favs = favSet();
    const showAll = !!filter || !state.favOnly;
    const bySq = Array.from({ length: 25 }, () => []);
    for (const s of day) {
      if (!showAll && s.who !== me && !favs.has(s.who)) continue;
      bySq[s.sq]?.push(s);
    }

    for (let i = 0; i < 25; i++) {
      const el = cells[i];
      const sq = perm[i];
      // Day swap, or a reroll that moved this seat to a different square:
      // reseat seen-ids so the stickers arriving are not all read as new and
      // crash-landed.
      if (el.dataset.day !== state.day || el.dataset.sq !== String(sq)) {
        el.dataset.day = state.day;
        el.dataset.sq = String(sq);
        el._primed = false;
        el._seenIds = new Set();
        el._idKey = "";
      }
      updateCell(el, {
        text: texts[sq],
        stickers: bySq[sq],
        mode: state.textMode,
        stack: state.stackMode,
        filter,
        me
      });
    }
  }

  // Belt and braces. ResizeObserver catches layout changes that never touch
  // the window (a sheet opening, the disclaimer rewrapping); visualViewport
  // catches the mobile URL bar sliding away, which changes the usable height
  // without a classic resize; window resize/orientationchange catch the rest.
  // All three are cheap and fit() is idempotent, so the redundancy costs
  // nothing. It could not be exercised in the Phase 2 browser harness, whose
  // emulated viewport resizes dispatch no signal of any kind - which is
  // exactly why this does not rest on one of them.
  new ResizeObserver(fit).observe(stage);
  const app = document.querySelector(".app");
  if (app) new ResizeObserver(fit).observe(app);
  const tab = document.querySelector(".tabbar");
  if (tab && "IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) correctShellClip(e);
    }, { threshold: [0, 0.5, 0.99, 1] }).observe(tab);
  }
  addEventListener("resize", fitAndClip);
  addEventListener("orientationchange", fitAndClip);
  visualViewport?.addEventListener("resize", fitAndClip);
  visualViewport?.addEventListener("scroll", fit);

  return { fit: fitAndClip, render, tapPoint: () => tapPt };
}
