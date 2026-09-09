// Bingo easter egg overlays — silly, loud, respects reduced motion.

const WRONG_CONFETTI = ["🍜", "🍕", "🧵", "🦄", "🛎️", "🧳", "🚦", "🎭", "🛗", "📋"];
const CORNERS = [0, 4, 20, 24];
const CORNER_GUARD = {
  0: { rot: -18, ox: "12% 88%", tx: "-6px" },
  4: { rot: 18, ox: "88% 88%", tx: "6px" },
  20: { rot: 18, ox: "12% 12%", tx: "-6px" },
  24: { rot: -18, ox: "88% 12%", tx: "6px" }
};
const PERIMETER = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24];
const PERIM_ORDER = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function screenLayer() {
  const el = document.createElement("div");
  el.className = "bingo-fx bingo-fx--screen";
  document.body.appendChild(el);
  return el;
}

function stageLayer(stage) {
  const el = document.createElement("div");
  el.className = "bingo-fx";
  stage.appendChild(el);
  return el;
}

function banner(root, text, cls) {
  const el = document.createElement("div");
  el.className = `bingo-fx__banner ${cls || ""}`;
  el.textContent = text;
  root.appendChild(el);
  return el;
}

function confetti(root, n = 42, delay = 0) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.className = "bingo-fx__bit";
    p.textContent = WRONG_CONFETTI[i % WRONG_CONFETTI.length];
    p.style.setProperty("--x", `${(Math.random() - 0.5) * 130}vw`);
    p.style.setProperty("--delay", `${delay + Math.random() * 0.25}s`);
    p.style.setProperty("--spin", `${(Math.random() - 0.5) * 720}deg`);
    p.style.setProperty("--dur", `${2.4 + Math.random() * 1.4}s`);
    frag.appendChild(p);
  }
  root.appendChild(frag);
}

function cells(grid) {
  return [...grid.querySelectorAll(".cell")];
}

async function playLine() {
  const root = screenLayer();
  banner(root, "BINGO", "bingo-fx__banner--bingo");
  if (!reduced()) confetti(root, 42, 0.95);
  await wait(reduced() ? 1200 : 3400);
  root.remove();
}

async function playCorners(stage, grid) {
  const root = screenLayer();
  banner(root, "FOUR CORNERS!", "bingo-fx__banner--corners");
  const all = cells(grid);
  stage.classList.add("is-corner-guard");
  for (const i of CORNERS) {
    const cfg = CORNER_GUARD[i];
    const el = all[i];
    if (!el || !cfg) continue;
    el.classList.add("is-corner-turret");
    el.style.setProperty("--guard-rot", `${cfg.rot}deg`);
    el.style.setProperty("--guard-ox", cfg.ox);
    el.style.setProperty("--guard-tx", cfg.tx);
  }
  await wait(reduced() ? 1400 : 3200);
  stage.classList.remove("is-corner-guard");
  for (const i of CORNERS) {
    all[i]?.classList.remove("is-corner-turret");
    all[i]?.style.removeProperty("--guard-rot");
    all[i]?.style.removeProperty("--guard-ox");
    all[i]?.style.removeProperty("--guard-tx");
  }
  root.remove();
}

async function playPerimeter(stage, grid) {
  const root = screenLayer();
  banner(root, "BORDER!", "bingo-fx__banner--border");
  const all = cells(grid);
  stage.classList.add("is-bingo-frame");
  for (const i of PERIMETER) {
    all[i]?.classList.add("is-frame-edge");
    const seq = PERIM_ORDER.indexOf(i);
    if (seq >= 0) all[i]?.style.setProperty("--frame-i", String(seq));
  }
  for (let i = 0; i < 25; i++) {
    if (!PERIMETER.includes(i)) all[i]?.classList.add("is-frame-center");
  }
  await wait(reduced() ? 1200 : 3400);
  root.remove();
  stage.classList.remove("is-bingo-frame");
  for (const el of all) {
    el.classList.remove("is-frame-edge", "is-frame-center");
    el.style.removeProperty("--frame-i");
  }
}

async function playBlackout(stage, grid) {
  const all = cells(grid);
  stage.classList.add("is-bingo-blackout");
  const root = stageLayer(stage);
  root.classList.add("bingo-fx--blackout");

  for (let i = 0; i < 25; i++) {
    const col = i % 5, row = Math.floor(i / 5);
    all[i]?.style.setProperty("--bx", `${(col - 2) * 32}px`);
    all[i]?.style.setProperty("--by", `${(row - 2) * 32}px`);
    all[i]?.classList.add("is-blackout-cell");
  }

  const dragon = document.createElement("div");
  dragon.className = "bingo-fx__dragon";
  dragon.textContent = "🐉";
  root.appendChild(dragon);

  const title = document.createElement("div");
  title.className = "bingo-fx__blackout";
  title.textContent = "BLACKOUT";
  root.appendChild(title);

  await wait(reduced() ? 2200 : 7600);

  stage.classList.remove("is-bingo-blackout");
  for (const el of all) {
    el.classList.remove("is-blackout-cell");
    el.style.removeProperty("--bx");
    el.style.removeProperty("--by");
    el.style.removeProperty("transform");
    el.style.removeProperty("opacity");
  }
  root.remove();
}

export function playBingoFx(kind, { stage, grid }) {
  switch (kind) {
    case "line": return playLine();
    case "corners": return playCorners(stage, grid);
    case "perimeter": return playPerimeter(stage, grid);
    case "blackout": return playBlackout(stage, grid);
    default: return Promise.resolve();
  }
}
