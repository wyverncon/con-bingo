// Undo (spec section 4, ADR 0030).
//
// A standing control rather than a five-second window: it appears when this
// device places its first sticker and stays until there is nothing left to take
// back. Each press removes the most recent sticker this device placed, so a
// player can walk back a run of mis-taps instead of racing a timer.
//
// The stack is this session's placements on the day being viewed, in order. It
// is local on purpose: only the placer may undo their own sticker, so nothing
// here syncs. `onUndo` calls `store.remove()`, which is a mutator write.
//
// Stack entries are pruned against the store on every paint, so a sticker the
// admin cleared, or one from a day you have left, cannot be undone twice or
// removed from under someone else.

export function createUndo({ bar, count, btn, dismiss, onUndo, exists }) {
  /** @type {{id: string, day: string}[]} */
  let stack = [];
  let day = null;
  // The player has waved the control away. It stays away until this device
  // places again — the stack is untouched, so whatever was undoable still is.
  let dismissed = false;

  // Pruning and day-filtering are different things. A sticker that no longer
  // exists is dropped for good; a sticker on another day is merely not on offer
  // right now, and must survive the trip there and back.
  function onDay() {
    stack = stack.filter((e) => exists(e.id));
    return stack.filter((e) => e.day === day);
  }

  function paint() {
    const here = onDay();
    bar.hidden = dismissed || here.length === 0;
    if (count) count.textContent = here.length > 1 ? String(here.length) : "";
  }

  btn.addEventListener("click", () => {
    const here = onDay();
    const last = here[here.length - 1];
    if (!last) return;
    stack.splice(stack.lastIndexOf(last), 1);
    onUndo(last.id);
    paint();
  });

  dismiss?.addEventListener("click", () => {
    dismissed = true;
    paint();
  });

  return {
    /** Remember a sticker this device just placed. */
    push(sticker) {
      dismissed = false;
      day = sticker.day;
      stack.push({ id: sticker.id, day: sticker.day });
      paint();
    },
    /** The day on screen changed, or the board did: re-check what is undoable. */
    sync(nextDay) {
      day = nextDay;
      paint();
    },
    /** Hide the control and forget the stack (read-only days, day rollover). */
    clear() {
      stack = [];
      paint();
    }
  };
}
