// Loading the reviewed data files.
//
// The lists the organizer signs off — emoji, names, squares, palettes, feedback
// topics, facts — live in JSON next to this file rather than inside ES modules,
// so a review pass diffs as data instead of as code. `connect-src 'self'`
// already permits the fetch and hard rule 1 still holds: JSON is native, so
// this costs no parser, no dependency and no build step.
//
// What it costs instead is that BOOT IS NOW ASYNC. Each data module awaits its
// file at the top level, so the whole module graph waits — and a failed fetch
// takes the board with it. A blank screen is a worse failure than a bad import
// caught at review, so a failure is made visible here rather than left silent.

const FAILED = new Set();

// Reveals the panel index.html and admin.html keep hidden for this. Built from
// markup, not written by code: there is no HTML sink anywhere in assets/
// (addendum section 2.2), and this path runs when things are already wrong.
function showFailure(name) {
  FAILED.add(name);
  const box = document.querySelector("[data-loadfail]");
  if (!box) return;                     // a tool page; the console is enough
  const list = box.querySelector("[data-loadfail-list]");
  if (list) list.textContent = [...FAILED].join(", ");
  // app.js may never run — the module graph it sits in is the thing that
  // failed — so the retry is wired here, by the module that did run.
  const retry = box.querySelector("[data-loadfail-retry]");
  if (retry && !retry.dataset.wired) {
    retry.dataset.wired = "1";
    retry.addEventListener("click", () => location.reload());
  }
  box.hidden = false;
}

/**
 * Fetch one data file, or fail loudly.
 *
 * Resolved against this module's own URL so every page — the board, admin, the
 * tools one directory down — asks for the same file.
 *
 * @param {string} name  file name, e.g. "emoji.json"
 */
export async function loadJson(name) {
  const url = new URL(name, import.meta.url);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    showFailure(name);
    throw err;
  }
  if (!res.ok) {
    showFailure(name);
    throw new Error(`${name}: ${res.status} ${res.statusText}`);
  }
  try {
    return await res.json();
  } catch (err) {
    // A file that arrives but does not parse is the same outcome as one that
    // never arrived, and is worth saying so rather than throwing a SyntaxError
    // from somewhere three modules away.
    showFailure(name);
    throw err;
  }
}
