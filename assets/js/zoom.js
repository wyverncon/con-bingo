// Pinch-zoom, pan, and wheel-zoom on the board stage.
//
// Ported from the mockup's componentDidMount pointer handling. Same clamps
// (1x - 3.4x), same behaviour: two pointers pinch and drag together, one
// pointer pans only once zoomed in, and dropping back to 1x recentres.
//
// `moved()` tells the square handlers to swallow the tap that ended a pan, so
// dragging across the board never opens the emoji picker.
//
// Perf: emoji under a live CSS scale are the main lag source. During a gesture
// we mark the stage `is-gesturing` so CSS can hide stickers and drop glows;
// onChange only fires when the zoomed/unzoomed chrome state flips (not every
// pointermove).

const MIN = 1;
const MAX = 3.4;
const PAN_THRESHOLD = 1.02;   // below this, treat as "not zoomed"

const clamp = (s) => Math.max(MIN, Math.min(MAX, s));

// `onChange` fires when the zoomed chrome state flips, so the reset-view tab
// can light up without a full board render — and without thrashing every frame.
export function createZoom(stage, pan, onChange = () => {}) {
  let scale = 1, tx = 0, ty = 0;
  let moved = false;
  const pts = new Map();
  let base = null;
  let gestureTimer = null;
  let wasZoomed = false;

  const apply = () => {
    // translate3d keeps the pan on its own compositor layer.
    pan.style.transform =
      `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    const zoomed = scale > PAN_THRESHOLD;
    stage.classList.toggle("is-zoomed", zoomed);
    if (zoomed !== wasZoomed) {
      wasZoomed = zoomed;
      onChange(scale);
    }
  };

  // CSS transition on transform fights every pointermove; kill it for the
  // duration of a gesture. Also used by +/- buttons so they share the fast path.
  const beginGesture = () => {
    stage.classList.add("is-gesturing");
    clearTimeout(gestureTimer);
  };
  const endGesture = () => {
    clearTimeout(gestureTimer);
    // Keep stickers hidden until the compositor catches up after the last frame.
    gestureTimer = setTimeout(() => stage.classList.remove("is-gesturing"), 120);
  };

  const two = () => [...pts.values()];
  const dist = () => { const [a, b] = two(); return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = two(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

  const set = (s, x, y) => {
    scale = s;
    if (s <= PAN_THRESHOLD) { tx = 0; ty = 0; } else { tx = x; ty = y; }
    apply();
  };

  stage.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture();
    if (pts.size === 2) base = { d: dist(), s: scale, m: mid(), tx, ty };
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && base) {
      moved = true;
      beginGesture();
      const m = mid();
      set(clamp(base.s * (dist() / base.d)), base.tx + (m.x - base.m.x), base.ty + (m.y - base.m.y));
    } else if (pts.size === 1 && scale > PAN_THRESHOLD && e.buttons !== 0) {
      moved = true;
      beginGesture();
      set(scale, tx + (e.clientX - prev.x), ty + (e.clientY - prev.y));
    }
  });

  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) base = null;
    if (pts.size === 0) endGesture();
    // Let the tap handler on the square see `moved` before it clears.
    setTimeout(() => { moved = false; }, 40);
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("pointerleave", up);

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    beginGesture();
    set(clamp(scale * (1 - e.deltaY / 420)), tx, ty);
    endGesture();
  }, { passive: false });

  apply();   // initial paint only; onChange deliberately not fired here, the
             // first render() has not run yet and would find nothing to update

  const bump = (next) => {
    beginGesture();
    set(next, tx, ty);
    endGesture();
  };

  return {
    isZoomed: () => scale > PAN_THRESHOLD,
    moved: () => moved,
    reset: () => bump(1),
    zoomIn: () => bump(clamp(scale * 1.35)),
    zoomOut: () => bump(clamp(scale / 1.35)),
    get scale() { return scale; }
  };
}
