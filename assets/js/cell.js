// The one place that decides how a square looks.
//
// Ported from the mockup's `cell()` method, which returned inline style
// objects. Here the *decisions* stay in JS (which stickers are shown, how big
// the emoji are, whether there is an overflow badge) and the *appearance*
// moves to app.css, addressed through classes and three custom properties:
//
//   --k    scale factor. 1 == the mockup's 66px cell. Set on .stage__pan for
//          the board; set per-cell for the readability previews.
//   --fs   emoji font size in mockup pixels, before --k. Set per sticker:
//          ownership is carried by size, so yours and everyone else's differ
//          on the same cell.
//   --dx/--dy/--rot  per-sticker placement, also in mockup pixels. dx/dy are
//          the ring seat when the cell has a usable band, the mockup's pile
//          jitter when it does not.
//
// Modes are classes on the cell itself, not on an ancestor, so a preview cell
// in the readability sheet can render a different mode than the board.

export const TEXT_MODES = ["halo", "caption", "dim"];
export const STACK_MODES = ["shrink", "overflow"];

// Ring capacity: your own sticker plus the ten most recent from other players.
// The eleventh onward collapse into the +N badge, so a busy square stays
// legible and the ten on show rotate as people keep playing (phase 6d).
const RING_SHOWN = 10;

// Golden angle. Distributing by it means a half-filled ring still looks
// deliberate rather than clustered.
const GOLDEN = 137.5 * Math.PI / 180;

// Where in the band between the label and the cell's inner bound a sticker
// sits. 0 hugs the label, 1 hugs the frame.
const BAND_SEAT = 0.55;
// How far off that seat a sticker may wander, as a fraction of the band and of
// the angular step. A ring on exact golden angles at one exact radius reads as
// a machine part; the point of this board is a friend group slapping stickers
// on a card, so every seat is nudged in and out and around by a fixed amount
// derived from the sticker's own id — the same sticker lands in the same place
// on every re-seat and on every device, it just does not land on the lattice.
const JITTER_T = 0.55;
const JITTER_A = 0.42;
// How far past the label a seat may be squeezed, as a fraction of the cell's
// half width, before the ring gives up and the stickers pile instead.
const SQUEEZE = 0.2;

// How long the slide from the finger to the ring takes, and where to read the
// pop's duration from — the readability sheet can retune it, so it is read at
// use rather than captured.
const SLIDE_MS = 420;
function popMs(el) {
  const v = parseFloat(getComputedStyle(el).getPropertyValue("--fx-pop-ms"));
  return Number.isFinite(v) && v > 0 ? v : 520;
}

// Arrival motion (crash / shake) stays off until the first sync snapshot has
// been painted silently — otherwise every sticker in the room crash-lands on
// open.
let arrivalMotion = false;
export function enableArrivalMotion() { arrivalMotion = true; }

// Ownership, first channel: your sticker is twice the size of everyone else's
// (phase 6d). Other players' stickers shrink as a square fills so ten of them
// still fit the ring; yours is pinned to double the current other size, capped
// so it cannot outgrow the cell. Mockup px, before --k.
function otherSize(others) {
  return Math.max(10, 17 - Math.max(0, others - 1) * 0.7);
}

function ownSize(others) {
  return Math.min(30, otherSize(others) * 2);
}

// How much bigger labels are than the original mockup ladder (phase 6d). One
// dial, because it trades directly against the sticker ring: a taller label
// eats the band the emoji sit in, and past a point there is no band left and
// every square falls back to the pile. Measured at a 66px cell against the
// beta's squares, the dial alone barely moves that count — 1.0 and 1.4 both
// ring 19 of 25 — because the ladder is bucketed by string length and a
// smaller face just wraps to wider lines. So the size is set for reading and
// the ring is bought back by SQUEEZE below.
export const TEXT_SCALE = 1.25;

// Scale label type so the full string fits without mid-word orphans. Values are
// mockup px before --k. The ladders are the mockup's, times TEXT_SCALE.
const STEPS_DIM = [10.0, 9.0, 8.0, 7.2, 6.4];
const STEPS_TEXT = [10.0, 9.2, 8.4, 7.6, 6.8, 6.2, 5.6];

function labelFontSize(text, mode) {
  const n = text.length;
  if (mode === "dim") {
    const i = n <= 14 ? 0 : n <= 22 ? 1 : n <= 32 ? 2 : n <= 44 ? 3 : 4;
    return STEPS_DIM[i] * TEXT_SCALE;
  }
  // halo + caption share the same scale; caption was tuned first.
  const i = n <= 10 ? 0 : n <= 16 ? 1 : n <= 24 ? 2 : n <= 34 ? 3
    : n <= 46 ? 4 : n <= 60 ? 5 : 6;
  return STEPS_TEXT[i] * TEXT_SCALE;
}

function stickerEl(s, i, dimmed, kind, own, size) {
  const el = document.createElement("span");
  el.className = "cell__sticker";
  el.classList.add(own ? "is-own" : "is-other");
  if (dimmed) el.classList.add("is-dimmed");
  if (kind === "fresh") el.classList.add("is-fresh");
  if (kind === "crash") el.classList.add("is-crash");
  // The pile offsets stay on the element as the fallback seating; seatRing()
  // overwrites them when the cell has a usable band.
  el.dataset.sid = s.id || "";
  el.style.setProperty("--fs", size.toFixed(1));
  el.style.setProperty("--dx", s.dx.toFixed(1));
  el.style.setProperty("--dy", s.dy.toFixed(1));
  el.style.setProperty("--rot", s.rot.toFixed(1) + "deg");
  el.style.zIndex = String(2 + i);
  // Color glyph + grey twin. The twin is clip-path'd to the label overlap so
  // only the part under the words greys out (true per-pixel emoji masks aren't
  // available for system emoji).
  const color = document.createElement("span");
  color.className = "cell__sticker-face cell__sticker-face--color";
  color.textContent = s.emoji;
  const grey = document.createElement("span");
  grey.className = "cell__sticker-face cell__sticker-face--grey";
  grey.setAttribute("aria-hidden", "true");
  grey.textContent = s.emoji;
  el.append(color, grey);
  el._grey = grey;
  return el;
}

/**
 * Seat this cell's stickers in the band between the label and the frame.
 *
 * Measured, not guessed: the label's real rect decides the inner bound, so a
 * three-line square pushes its stickers outward and a two-word one lets them
 * in. For a candidate angle `a` the label edge is at
 * `t0 = min(hw / |cos a|, hh / |sin a|)`, the cell's inner bound at
 * `t1 = half - inset - size / 2`, and the sticker sits at
 * `t0 + (t1 - t0) * BAND_SEAT`.
 *
 * The radius is computed from the *other-player* size for every sticker, so
 * your doubled one shares the ring's geometry and simply draws bigger from the
 * same seat. Without that the ring would deform around whichever sticker is
 * yours.
 *
 * Two fallbacks, both deliberate: below two stickers a lone emoji on a ring
 * reads as misplaced where a lone emoji in the middle reads as placed, and a
 * long label at large text can leave no band at all. Either way the pile
 * offsets already on the element stand.
 *
 * Must re-run whenever --k changes, because the label box scales with it.
 */
// The label's block box is as wide as the cell whatever the words are, because
// the stack is centred at max-width 100%. Seating against that box says there
// is no room when there plainly is, so measure the line boxes the text really
// occupies — the union of the fill element's client rects.
function inkRect(el) {
  const fill = el._textEl;
  if (!fill || !fill.textContent) return null;
  const range = document.createRange();
  range.selectNodeContents(fill);
  const rects = range.getClientRects();
  if (!rects.length) return null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const r of rects) {
    if (!r.width && !r.height) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!(right > left) || !(bottom > top)) return null;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

// A stable [0,1) from a sticker's id: the scatter has to survive a re-seat
// (every `fit()` calls one) without the stickers hopping around.
function jitterOf(st, salt) {
  const key = (st.dataset.sid || "") + salt;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function seatStickers(el) {
  const all = [...el.querySelectorAll(".cell__sticker")];
  // A sticker mid-pop holds the position the finger put it at; it slides out to
  // its seat when the pop finishes (see the re-seat scheduled in updateCell).
  const shown = all.filter((st) => !st.classList.contains("is-fresh"));
  if (!shown.length) return;
  const label = el.querySelector(".cell__text-stack");
  const cr = el.getBoundingClientRect();
  if (!label || !cr.width) return;
  // Read --k rather than deriving it from the width. Every length the cell
  // draws is `calc(px * var(--k))`, and the sticker offsets are multiplied by
  // it too, so the seat has to be expressed in the same unit. A thumbnail
  // whose --k has not caught up with its box would otherwise seat its ring at
  // the wrong radius.
  const k = parseFloat(getComputedStyle(el).getPropertyValue("--k")) || cr.width / 66;
  if (!(k > 0)) return;

  const lr = inkRect(el) || label.getBoundingClientRect();
  const pad = 2 * k;
  const hw = lr.width / 2 + pad;
  const hh = lr.height / 2 + pad;
  const half = cr.width / 2;
  // The frame's solid ring, plus a hair so nothing sits on the edge itself.
  const inset = 4.3 * k + 1;
  const size = Number(el.dataset.otherFs || 0) * k;
  const t1 = half - inset - size / 2;

  // Walk the golden sequence and keep only the angles that have a band. A
  // square's stickers must be all ringed or all piled: seating some and piling
  // the rest on the same cell looks like a bug rather than a layout, and at
  // phone scale with large labels that mixed case is the common one.
  //
  // A four-line label misses the band by a hair rather than by a lot — it wants
  // a radius a couple of px past where the frame allows. Rather than dump those
  // squares back into the pile, a seat within SQUEEZE of fitting is pushed all
  // the way out to the frame and allowed to graze the words: the overlap is
  // already handled, since the part of a sticker that lies over the label greys
  // out. Past that tolerance the pile is still the honest answer.
  const squeeze = SQUEEZE * half;
  const seats = [];
  for (let i = 0; seats.length < shown.length && i < shown.length * 8; i++) {
    const a = i * GOLDEN + (jitterOf(shown[seats.length], "a") - 0.5) * GOLDEN * JITTER_A;
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    const t0 = Math.min(
      ca > 1e-6 ? hw / ca : Infinity,
      sa > 1e-6 ? hh / sa : Infinity
    );
    // Radial jitter rides on the band, so a wide band scatters and a squeezed
    // one stays put — there is nowhere for it to go.
    const j = (jitterOf(shown[seats.length], "t") - 0.5) * JITTER_T;
    if (t1 > t0) seats.push([a, t0 + (t1 - t0) * (BAND_SEAT + j)]);
    else if (t0 - t1 < squeeze) seats.push([a, t1]);
  }
  if (seats.length < shown.length) return;   // no room for everyone: keep the pile

  shown.forEach((st, i) => {
    const [a, t] = seats[i];
    st.style.setProperty("--dx", ((Math.cos(a) * t) / k).toFixed(2));
    st.style.setProperty("--dy", ((Math.sin(a) * t) / k).toFixed(2));
  });
}

function markStickerOverlap(el) {
  // Use the actual label stack, not the full-cell textwrap, so corner stickers
  // that only graze the padding stay colorful.
  const label = el.querySelector(".cell__text-stack") || el.querySelector(".cell__textwrap");
  if (!label || el.classList.contains("is-blank")) {
    for (const st of el.querySelectorAll(".cell__sticker")) {
      st.classList.remove("is-under-text");
      if (st._grey) st._grey.style.clipPath = "inset(100%)";
    }
    return;
  }
  const tr = label.getBoundingClientRect();
  for (const st of el.querySelectorAll(".cell__sticker")) {
    const sr = st.getBoundingClientRect();
    const x1 = Math.max(sr.left, tr.left);
    const y1 = Math.max(sr.top, tr.top);
    const x2 = Math.min(sr.right, tr.right);
    const y2 = Math.min(sr.bottom, tr.bottom);
    const under = x2 > x1 && y2 > y1;
    st.classList.toggle("is-under-text", under);
    const grey = st._grey;
    if (!grey) continue;
    if (!under || sr.width < 1 || sr.height < 1) {
      grey.style.clipPath = "inset(100%)";
      continue;
    }
    const top = ((y1 - sr.top) / sr.height) * 100;
    const right = ((sr.right - x2) / sr.width) * 100;
    const bottom = ((sr.bottom - y2) / sr.height) * 100;
    const left = ((x1 - sr.left) / sr.width) * 100;
    grey.style.clipPath = `inset(${top.toFixed(1)}% ${right.toFixed(1)}% ${bottom.toFixed(1)}% ${left.toFixed(1)}%)`;
  }
}

// Build a fresh cell element. `opts`:
//   text, stickers, mode, stack, filter (player name or null), me (this
//   device's name, or null), k (optional)
export function buildCell(opts) {
  const el = document.createElement("div");
  el.className = "cell";
  const wrap = document.createElement("span");
  wrap.className = "cell__textwrap";
  const stack = document.createElement("span");
  stack.className = "cell__text-stack";
  const outline = document.createElement("span");
  outline.className = "cell__text cell__text--outline";
  outline.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "cell__text cell__text--fill";
  stack.append(outline, fill);
  wrap.appendChild(stack);
  const over = document.createElement("span");
  over.className = "cell__over";
  over.hidden = true;
  el.append(wrap, over);
  el._textOutline = outline;
  el._textEl = fill;
  el._overEl = over;
  el._seenIds = new Set();
  updateCell(el, opts);
  return el;
}

// Re-render one cell in place. Cheap enough to call per square on any state
// change: 25 cells, a handful of spans each.
export function updateCell(el, opts) {
  const { text = "", stickers = [], mode = "halo", stack = "shrink",
          filter = null, me = null, k = null } = opts;

  const total = stickers.length;
  const mineCount = filter
    ? stickers.reduce((n, s) => n + (s.who === filter ? 1 : 0), 0)
    : total;

  // Your own sticker always shows (ADR 0012 caps it at one per square); the
  // rest of the ring is the ten most recent from other players, so the visible
  // set rotates as people keep playing rather than freezing on whoever was
  // first. `t` is the placement time and is validated at ingest.
  const own = me ? stickers.filter((s) => s.who === me) : [];
  const others = me ? stickers.filter((s) => s.who !== me) : stickers.slice();
  others.sort((a, b) => (b.t || 0) - (a.t || 0));
  const shownOthers = others.slice(0, RING_SHOWN);
  const shown = own.concat(shownOthers);
  const hidden = others.length - shownOthers.length;
  const fsOther = otherSize(shownOthers.length);
  const fsOwn = ownSize(shownOthers.length);
  const prev = el._seenIds || new Set();
  let landed = false;

  el.classList.toggle("cell--halo", mode === "halo");
  el.classList.toggle("cell--caption", mode === "caption");
  el.classList.toggle("cell--dim", mode === "dim");
  el.classList.toggle("cell--stack-overflow", stack === "overflow");
  // Filter view: heat only on the selected player's squares; everything else
  // fades to grey so their board reads at a glance.
  el.classList.toggle("is-filled", false);
  el.classList.toggle("is-filter-muted", !!filter && mineCount === 0);
  // "Mine": the day's contrast hue on every square this device has marked, so
  // the player can see their own coverage without opening a filter.
  // Independent of the filter — both can be on at once.
  el.classList.toggle("is-mine", own.length > 0);
  el.classList.toggle("is-blank", text === "");
  // --fs is set per sticker now (ownership is carried by size); this is the
  // fallback for anything that renders a sticker outside updateCell.
  el.style.setProperty("--fs", fsOther.toFixed(1));
  el.dataset.otherFs = fsOther.toFixed(1);
  el.style.setProperty("--label-fs", labelFontSize(text, mode).toFixed(1));
  if (k != null) el.style.setProperty("--k", String(k));

  if (el._textEl.textContent !== text) {
    el._textEl.textContent = text;
    el._textOutline.textContent = text;
  }

  el._overEl.hidden = hidden === 0;
  if (hidden) el._overEl.textContent = "+" + hidden;

  // Stickers are the only variable-length part. Skip a full rebuild when the
  // same ids are already mounted (heat/mode-only updates) — destroying emoji
  // on every sync is what made zoom + busy boards feel sticky.
  const idKey = shown.map((s) => s.id).join("\0") + "\0" + (filter || "") +
    "\0" + (me || "") + "\0" + stack + "\0" + hidden;
  const sameStickers = el._idKey === idKey && el._primed;
  if (sameStickers) return;

  const priming = !el._primed;
  for (const old of el.querySelectorAll(".cell__sticker")) old.remove();
  const frag = document.createDocumentFragment();
  shown.forEach((s, i) => {
    const isNew = arrivalMotion && !priming && !prev.has(s.id);
    if (isNew) landed = true;
    // Local place → pop. First sighting without fresh → remote crash-in.
    const kind = s.fresh ? "fresh" : (isNew ? "crash" : null);
    const isOwn = !!me && s.who === me;
    frag.appendChild(stickerEl(s, i, !!filter && s.who !== filter, kind, isOwn,
      isOwn ? fsOwn : fsOther));
  });
  el.insertBefore(frag, el.firstChild);
  // A sticker you just placed pops where your finger landed and then slides out
  // to join the ring. seatStickers() leaves .is-fresh alone, so the two motions
  // do not fight; this is what hands it over when the pop is done.
  for (const st of el.querySelectorAll(".cell__sticker.is-fresh")) {
    window.setTimeout(() => {
      st.classList.remove("is-fresh");
      st.classList.add("is-sliding");
      seatStickers(el);
      markStickerOverlap(el);
      window.setTimeout(() => st.classList.remove("is-sliding"), SLIDE_MS + 60);
    }, popMs(el));
  }
  el._seenIds = new Set(stickers.map((s) => s.id));
  el._idKey = idKey;
  el._primed = true;
  seatStickers(el);
  markStickerOverlap(el);
  requestAnimationFrame(() => { seatStickers(el); markStickerOverlap(el); });

  if (landed) {
    el.classList.remove("is-shake");
    void el.offsetWidth;
    el.classList.add("is-shake");
  }
}
