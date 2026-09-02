// Add to Home Screen (ADR 0021).
//
// One label over two different mechanisms, which is why this is a module and
// not three lines in app.js:
//
//   Android / Chrome  fires `beforeinstallprompt`. Stash the event, show a
//                     button, and calling prompt() on it does the install.
//   iOS / Safari      has no such event and no API. The only honest control is
//                     a sentence telling the player where Apple put it.
//
// Neither is shown once the app is already installed — a running standalone
// window offering to install itself is the kind of detail that makes an app
// feel unfinished. The strings live in index.html (spec section 1).

let deferred = null;

function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

// Safari on iPad reports as a Mac unless touch is checked, so test for the
// touch-capable Apple platforms rather than trusting the UA string alone.
function isIOS() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function createInstall(els) {
  const { wrap, btn, ios } = els;
  if (!wrap) return { refresh() {} };

  function refresh() {
    if (standalone()) {
      wrap.hidden = true;
      return;
    }
    const canPrompt = !!deferred;
    btn.hidden = !canPrompt;
    ios.hidden = canPrompt || !isIOS();
    // Nothing useful to offer on a desktop browser that never fired the event.
    wrap.hidden = btn.hidden && ios.hidden;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    // Chrome shows its own mini-infobar otherwise; the sheet is a calmer place
    // to ask, and the player is already in settings when they see it.
    e.preventDefault();
    deferred = e;
    refresh();
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    refresh();
  });

  btn.addEventListener("click", async () => {
    if (!deferred) return;
    const e = deferred;
    // The event is single-use whatever the player chooses.
    deferred = null;
    try { await e.prompt(); } catch { /* dismissed */ }
    refresh();
  });

  refresh();
  return { refresh };
}
