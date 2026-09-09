// End-of-con results prompt (ADR 0040).
//
// Shows the results modal once per device, then never again; the persistent
// button over the day heading is the way back after that. This module is
// deliberately tiny and independent of app.js: the board must come up whether
// or not this runs, so nothing here reads game state, and a throw here cannot
// take the board down.
//
// It touches only [hidden], classList, localStorage and addEventListener — no
// HTML sink of any kind (hard rule 10). Every string the modal shows is
// authored markup in index.html, not built here.

const SEEN_KEY = "dcb.results.seen.v1";

const modal = document.querySelector("[data-results-modal]");
if (modal) {
  const dismiss = modal.querySelector("[data-results-dismiss]");
  const go = modal.querySelector(".resultsmodal__go");

  const markSeen = () => {
    // localStorage can throw in private mode or when storage is disabled; a
    // failure just means the prompt may show again, which is harmless.
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) {}
  };

  const close = () => {
    modal.hidden = true;
    markSeen();
  };

  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch (e) {}
  if (!seen) modal.hidden = false;

  if (dismiss) dismiss.addEventListener("click", close);
  // Following the link into the results counts as having seen the prompt.
  if (go) go.addEventListener("click", markSeen);
  // A tap on the backdrop, outside the panel, closes it like the skip button.
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
}
