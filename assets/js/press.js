// Press gestures shared by anything that reacts to a finger being held down:
// the squares on the board, and the sticker counter in the top bar.
//
// Both live here rather than in board.js so a second holdable control feels
// identical to the first — the same hold duration, and the same guard against
// the compatibility click a phone fires afterwards.

export const LONG_PRESS_MS = 520;

// How long to keep watching for the compatibility click after a touch tap.
// Browsers synthesize it within ~300ms of the finger lifting.
const GHOST_CLICK_MS = 600;

// A touch tap fires pointerdown/pointerup, and THEN the browser synthesizes a
// compatibility `click` up to ~300ms later — hit-tested fresh at the same
// screen point. By then the handler has opened or closed something, so that
// click lands on whatever is now under the finger — typically a scrim that was
// not there when the tap began, whose handler undoes the tap.
//
// Mouse clicks are immune: their target is resolved from the press/release
// pair, so a mouse click still targets the element pressed. That is why this
// only ever reproduced on a phone.
//
// Rather than rely on preventDefault() suppressing compatibility events (which
// varies by browser and by which event you call it on), swallow the one click
// that lands at the tap point inside the window. Matching on coordinates keeps
// this from eating any other click.
export function swallowGhostClick(x, y) {
  const t0 = performance.now();
  let timer = 0;

  const done = () => {
    document.removeEventListener("click", onClick, true);
    clearTimeout(timer);
  };

  const onClick = (ev) => {
    if (performance.now() - t0 > GHOST_CLICK_MS) return done();
    const samePlace = Math.abs(ev.clientX - x) <= 12 && Math.abs(ev.clientY - y) <= 12;
    if (!samePlace) return;
    ev.stopPropagation();
    ev.preventDefault();
    done();
  };

  timer = setTimeout(done, GHOST_CLICK_MS);
  document.addEventListener("click", onClick, true);
}
