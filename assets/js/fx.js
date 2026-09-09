// Animation parameters — CSS custom properties + one-shot classes.
//
// The live tuning panel that used to live here was demo scaffolding and is
// gone (Phase 6b, addendum section 2.2): it was the app's only unsafe
// DOM sink, and the section 4 grep has to come back clean.
// The values it produced are baked into FX_DEFAULTS below.

const ROOT = document.documentElement;

export const FX_DEFAULTS = {
  // local place (pop) — tuned via FX panel
  popMs: 480,
  popScale: 1.5,
  popSpin: 32,
  // cell reaction
  shakeMs: 200,
  shakePx: 6,
  // remote arrival (crash)
  crashMs: 470,
  crashScale: 3.35,
  crashSpin: 48,
  crashBounce: 1.37,
  // day swap wash
  washMs: 480,
  washGlow: 0.42
};

let params = { ...FX_DEFAULTS };

export function getFx() { return { ...params }; }

export function applyFx(patch = {}) {
  Object.assign(params, patch);
  const s = ROOT.style;
  s.setProperty("--fx-pop-ms", params.popMs + "ms");
  s.setProperty("--fx-pop-scale", String(params.popScale));
  s.setProperty("--fx-pop-spin", params.popSpin + "deg");
  s.setProperty("--fx-shake-ms", params.shakeMs + "ms");
  s.setProperty("--fx-shake-px", params.shakePx + "px");
  s.setProperty("--fx-crash-ms", params.crashMs + "ms");
  s.setProperty("--fx-crash-scale", String(params.crashScale));
  s.setProperty("--fx-crash-spin", params.crashSpin + "deg");
  s.setProperty("--fx-crash-bounce", String(params.crashBounce));
  s.setProperty("--fx-wash-ms", params.washMs + "ms");
  s.setProperty("--fx-wash-glow", String(params.washGlow));
}

export function pulseClass(el, name) {
  if (!el) return;
  el.classList.remove(name);
  // Force reflow so re-adding restarts the animation.
  void el.offsetWidth;
  el.classList.add(name);
  const ms = name === "is-shake" ? params.shakeMs
    : name === "is-daywash" ? params.washMs
    : params.crashMs;
  window.setTimeout(() => el.classList.remove(name), ms + 40);
}
