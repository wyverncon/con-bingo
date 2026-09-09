// The stats screen: three tabs over one finished card.
//
//   DAY       what this player did on the card they are looking at
//   ALL DAYS  the same player across the whole run
//   EVERYONE  the room's totals for that card, plus its busiest squares
//
// Scoring lives in score.js and is pure; this module is presentation. Two
// pieces of it are worth knowing about before editing:
//
//   1. The "most-stickered squares" thumbnails are REAL cells. They call
//      buildCell() and are styled by app.css like every other square, so the
//      scatter, the shrink-with-count sizing and the heat tint are the board's
//      own, not a decorative copy that will drift.
//   2. Bar colour is sampled from the emoji itself (emojiColor). No palette
//      decides that 🍕 is orange; the glyph does.
//
// No HTML sinks (addendum §2.2): every node is createElement plus textContent,
// including the share card, which is painted on a canvas because a
// DOM-to-image library needs a build step and would violate script-src.

import { DAYCFG, ORDER } from "../data/theme.js";
import { buildCell, seatStickers } from "./cell.js";
import { SQUARES } from "../data/squares.js";
import { dayScore, forPlayer, runTotals, playerEmoji, LINES_PER_CARD } from "./score.js";
import { isBeta } from "./edition.js";

const SEEN_KEY = "dcb.stats.seen.v1";
const EMOJI_FONTS =
  '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","DM Sans",sans-serif';

// --- emoji → colour ---------------------------------------------------------
// Paint the glyph, bucket its pixels by hue, and take the heaviest bucket.
// Weighting by saturation SQUARED matters: a coffee cup is mostly pale
// near-grey pixels around a small brown pool, and a linear weight lets the
// washed-out area outvote the one colour a person would name.

const colorCache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** { c, alt } — the glyph's own colour, and the opposite hue for rank 1. */
export function emojiColor(ch) {
  if (colorCache.has(ch)) return colorCache.get(ch);
  const size = 28;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const x = cv.getContext("2d", { willReadFrequently: true });
  x.font = "24px " + EMOJI_FONTS;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(ch, size / 2, size / 2 + 1);
  const data = x.getImageData(0, 0, size, size).data;

  function dominant(minSat) {
    const BUCKETS = 18;
    const weight = new Array(BUCKETS).fill(0);
    const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < minSat || l < 0.1 || l > 0.94) continue;
      const b = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
      const w = s * s * (a / 255);
      weight[b] += w;
      sums[b][0] += data[i] * w;
      sums[b][1] += data[i + 1] * w;
      sums[b][2] += data[i + 2] * w;
    }
    let best = -1, bestW = 0;
    for (let b = 0; b < BUCKETS; b++) if (weight[b] > bestW) { bestW = weight[b]; best = b; }
    if (best < 0 || bestW < 1.5) return null;
    return [sums[best][0] / weight[best], sums[best][1] / weight[best], sums[best][2] / weight[best]];
  }

  // Some environments draw legacy BMP emoji (U+2615 COFFEE among them) as a
  // monochrome outline. All that is left then is the antialias fringe, which
  // reads as lilac — those must land on the neutral rather than have a hue
  // invented for them, so the second threshold stays high and the result is
  // checked for saturation before it is used.
  const rgb = dominant(0.34) || dominant(0.22);
  let out = { c: "#b7aecb", alt: "#f8d000" };
  if (rgb) {
    const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    if (s >= 0.28) {
      const [rr, gg, bb] = hslToRgb(h, Math.min(1, Math.max(0.62, s)), 0.56);
      const [ar, ag, ab] = hslToRgb((h + 0.5) % 1, 0.82, 0.6);
      out = {
        c: "rgb(" + rr + "," + gg + "," + bb + ")",
        alt: "rgb(" + ar + "," + ag + "," + ab + ")"
      };
    }
  }
  colorCache.set(ch, out);
  return out;
}

// --- small builders ---------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Tier thresholds for the bingo tile. A card holds twelve lines; three is a
// good day and eight is a remarkable one.
function bingoTier(n) {
  if (n <= 0) return "";
  if (n < 3) return "t1";
  if (n < 8) return "t2";
  return "t3";
}

// Tier for an all-days counter: how much of what was possible got claimed.
function ratioTier(n, possible) {
  if (n <= 0) return "";
  const r = n / Math.max(1, possible);
  if (r < 0.34) return "t1";
  if (r < 0.67) return "t2";
  return "t3";
}

function tile(cls, extra) {
  const t = el("div", "tile " + cls + (extra ? " " + extra : ""));
  return t;
}

function bingoTile(n, tier, sub) {
  const t = tile("tile--bingo", tier);
  const rays = el("span", "tile__rays");
  rays.setAttribute("aria-hidden", "true");
  t.append(rays, el("span", "tile__n", String(n)), el("span", "tile__label", "bingos"));
  if (sub) t.appendChild(el("span", "tile__sub", sub));
  return t;
}

function badgeTile(kind, label, icon, on) {
  const t = tile("tile--" + kind, on ? "is-on" : "");
  t.append(el("span", "tile__ico", icon), el("span", "tile__label", label));
  return t;
}

function countTile(kind, label, n, possible) {
  const t = tile("tile--count", ratioTier(n, possible));
  const num = el("span", "tile__n", String(n));
  num.appendChild(el("span", "tile__of", "/" + possible));
  t.append(num, el("span", "tile__label", label));
  return t;
}

function statTile(kind, n, label) {
  const s = el("div", "stat stat--" + kind);
  s.append(el("span", "stat__n", String(n)), el("span", "stat__label", label));
  return s;
}

function barChart(rows) {
  const host = el("div", "bars");
  if (!rows.length) return host;
  const max = rows[0][1];
  rows.forEach(([emoji, n], i) => {
    const row = el("div", "bar" + (i === 0 ? " bar--top" : ""));
    const { c, alt } = emojiColor(emoji);
    row.style.setProperty("--c", c);
    row.style.setProperty("--alt", alt);
    const track = el("span", "bar__track");
    const fill = el("span", "bar__fill");
    fill.style.setProperty("--w", Math.max(8, (n / max) * 100).toFixed(1) + "%");
    track.appendChild(fill);
    row.append(el("span", "bar__emoji", emoji), track, el("span", "bar__n", String(n)));
    host.appendChild(row);
  });
  return host;
}

// --- the module -------------------------------------------------------------

export function createStats(els) {
  const {
    root, body, tabs, viewBtn, shareBtn, shareView, canvas, shareNote,
    getDay, getToday, getStickers, getMe
  } = els;

  let tab = "day";

  let lastCard = null;      // model for the share painter
  const liveCells = [];     // thumbnails that re-measure their own --k

  function seenDays() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); }
    catch { return []; }
  }

  function markSeen(day) {
    try {
      const seen = seenDays();
      if (!seen.includes(day)) {
        seen.push(day);
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      }
    } catch { /* private mode */ }
  }

  function isOpen() { return !root.hidden; }

  function open() {
    root.hidden = false;
    render();
  }

  function close() {
    root.hidden = true;
  }

  // A finished card announces itself once. Only a day that is over — never the
  // live one, never one that has not opened — and only if anything happened on
  // it. After that the tab bar is the way back in.
  function maybeAutoOpen() {
    const day = getDay();
    if (day === getToday()) return;
    if (ORDER.indexOf(day) > ORDER.indexOf(getToday())) return;
    if (seenDays().includes(day)) return;
    const stickers = getStickers().filter((s) => s.day === day);
    if (!stickers.length) return;
    markSeen(day);
    open();
  }

  // --- panes ----------------------------------------------------------------

  function dayHead(title, sub) {
    const frag = document.createDocumentFragment();
    frag.append(el("p", "daytag", title), el("p", "whotag", sub));
    return frag;
  }

  function paneDay() {
    const day = getDay();
    const me = getMe();
    const stickers = getStickers().filter((s) => s.day === day);
    const score = dayScore(stickers);
    const mine = forPlayer(score, me);
    const bars = playerEmoji(stickers, me, 5);

    const frag = document.createDocumentFragment();
    frag.appendChild(dayHead(DAYCFG[day].name, me));

    const row = el("div", "tilerow");
    row.append(
      bingoTile(mine.bingos, bingoTier(mine.bingos)),
      badgeTile("corners", "4 square", "◈", !!mine.corners),
      badgeTile("border", "border", "▣", !!mine.border),
      badgeTile("blackout", "blackout", "★", !!mine.blackout)
    );
    frag.append(row);

    frag.appendChild(barChart(bars));

    lastCard = {
      title: DAYCFG[day].name,
      sub: me,
      big: mine.bingos,
      bigLabel: "BINGOS",
      badges: [
        ["4 SQUARE", !!mine.corners],
        ["BORDER", !!mine.border],
        ["BLACKOUT", !!mine.blackout]
      ],
      bars
    };
    return frag;
  }

  function paneAll() {
    const me = getMe();
    const all = getStickers();
    const scores = ORDER.map((d) => dayScore(all.filter((s) => s.day === d)));
    const totals = runTotals(scores, me);
    const possibleLines = LINES_PER_CARD * ORDER.length;
    const bars = playerEmoji(all, me, 5);
    const span = DAYCFG[ORDER[0]].name.slice(0, 3) + "–" +
      DAYCFG[ORDER[ORDER.length - 1]].name.slice(0, 3);

    const frag = document.createDocumentFragment();
    frag.appendChild(dayHead(isBeta ? "THE WEEKEND" : "THE CON", me + " · " + span));

    const row = el("div", "tilerow");
    row.append(
      bingoTile(totals.bingos, bingoTier(totals.bingos), "of " + possibleLines),
      countTile("corners", "4 square", totals.corners, ORDER.length),
      countTile("border", "border", totals.border, ORDER.length),
      countTile("blackout", "blackout", totals.blackout, ORDER.length)
    );

    frag.append(row, barChart(bars));

    lastCard = {
      title: isBeta ? "THE WEEKEND" : "THE CON",
      sub: me + " · " + span,
      big: totals.bingos,
      bigLabel: "BINGOS",
      badges: [
        ["4 SQUARE ×" + totals.corners, totals.corners > 0],
        ["BORDER ×" + totals.border, totals.border > 0],
        ["BLACKOUT ×" + totals.blackout, totals.blackout > 0]
      ],
      bars
    };
    return frag;
  }

  // Everyone is the ROOM, not a scoreboard (ADR 0024, amended by 0035). Once
  // each player has their own card in their own order there is no shared card
  // to describe, and ranking people against each other is a different game from
  // the one being played — so there is still no per-player list here.
  //
  // The pattern counts are not a ranking, though, and ADR 0024 dropped them by
  // association: they are sums over everyone's own cards, "nine bingos happened
  // in this room today". `dayScore` has always returned them. The labels stay
  // bare — the tab is called EVERYONE, so nothing needs to say "in the room".
  function paneEvery() {
    const day = getDay();
    const stickers = getStickers().filter((s) => s.day === day);
    const score = dayScore(stickers);

    const frag = document.createDocumentFragment();
    frag.appendChild(dayHead(DAYCFG[day].name, "everyone who played"));

    const r1 = el("div", "trow trow--2");
    r1.append(statTile("players", score.players, "players"),
      statTile("stickers", score.stickers, "stickers"));
    const r2 = el("div", "trow trow--4");
    r2.append(
      statTile("bingos", score.bingos, "bingos"),
      statTile("corners", score.corners, "4 square"),
      statTile("border", score.border, "border"),
      statTile("blackout", score.blackout, "blackout")
    );
    frag.append(r1, r2);

    // The busiest squares, rendered by the board's own cell builder.
    if (score.topSquares.length) {
      const tops = el("div", "tops");
      const busiest = score.topSquares[0][1];
      for (const [sq, n] of score.topSquares) {
        const col = el("div");
        col.append(el("span", "top__n", String(n)),
          el("span", "top__unit", n === 1 ? "sticker" : "stickers"));
        const slot = el("div", "topcell");
        const cell = buildCell({
          text: SQUARES[day][sq] || "",
          stickers: stickers.filter((s) => s.sq === sq),
          mode: "halo",
          stack: "shrink",
          k: 1
        });
        slot.appendChild(cell);
        col.appendChild(slot);
        tops.appendChild(col);
        liveCells.push(cell);
      }
      frag.appendChild(tops);
    }

    frag.appendChild(barChart(score.topEmoji));

    lastCard = {
      // The one thing the Everyone tab has that the other two do not: the
      // busiest squares. The thumbnails are real cells on screen and DOM cannot
      // be screenshotted onto a canvas, so they are painted a second time in
      // canvas terms below.
      tops: score.topSquares.map(([sq, n]) => ({
        n,
        text: SQUARES[day][sq] || "",
        emoji: stickers.filter((x) => x.sq === sq).slice(-6).map((x) => x.emoji)
      })),
      title: DAYCFG[day].name,
      sub: "everyone who played",
      big: score.bingos,
      bigLabel: "BINGOS",
      badges: [
        [score.players + " PLAYERS", score.players > 0],
        [score.stickers + " STICKERS", score.stickers > 0],
        ["BLACKOUT", score.blackout > 0]
      ],
      bars: score.topEmoji
    };
    return frag;
  }

  // A thumbnail sizes itself the way the board does: measure, then set --k
  // against the mockup's 66px cell.
  // A thumbnail's box is decided by the grid, so watch it rather than guessing
  // when layout has settled: a single rAF after replaceChildren can still read
  // a zero width, and a thumbnail stuck at --k: 1 renders its label and its
  // sticker ring at the wrong scale inside a full-size cell.
  const cellRO = new ResizeObserver((entries) => {
    for (const e of entries) sizeK(e.target, e.contentRect.width || e.target.getBoundingClientRect().width);
  });

  function sizeK(cell, w) {
    if (w <= 0) return;
    cell.style.setProperty("--k", (w / 66).toFixed(3));
    // Same rule as the board: --k moved, so the sticker ring is re-measured.
    seatStickers(cell);
  }

  // Measure once now and keep watching. The immediate pass is what makes the
  // thumbnails right in the common case; the observer catches the layout that
  // had not settled yet, and a rotation later on.
  function sizeCells() {
    for (const cell of liveCells) {
      sizeK(cell, cell.getBoundingClientRect().width);
      cellRO.observe(cell);
    }
  }

  function render() {
    if (root.hidden) return;
    cellRO.disconnect();
    liveCells.length = 0;
    for (const b of tabs) b.classList.toggle("is-on", b.dataset.statsTab === tab);
    const pane = tab === "day" ? paneDay() : tab === "all" ? paneAll() : paneEvery();
    body.replaceChildren(pane);
    sizeCells();
  }

  // --- share ----------------------------------------------------------------

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Painted by hand rather than screenshotted: no DOM-to-image library can run
  // here (no build step, and CSP script-src is 'self'). Fonts must be resolved
  // first or Firefox paints the emoji as nothing at all.
  async function paintShare(card) {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#2a0b3d");
    bg.addColorStop(0.46, "#3d1152");
    bg.addColorStop(1, "#24092f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f8d000";
    ctx.font = "700 96px 'Space Grotesk', monospace";
    ctx.fillText(card.title, W / 2, 170);
    ctx.fillStyle = "rgba(231,220,244,0.8)";
    ctx.font = "500 42px 'DM Sans', sans-serif";
    ctx.fillText(card.sub, W / 2, 232);

    const hot = ctx.createLinearGradient(80, 300, 500, 620);
    hot.addColorStop(0, "#f8d000");
    hot.addColorStop(0.55, "#ff5c18");
    hot.addColorStop(1, "#f02888");
    ctx.fillStyle = card.big > 0 ? hot : "rgba(231,220,244,0.08)";
    roundRect(ctx, 80, 300, 420, 320, 34);
    ctx.fill();
    ctx.fillStyle = card.big > 0 ? "#ffffff" : "rgba(231,220,244,0.45)";
    ctx.font = "700 190px 'Space Grotesk', monospace";
    ctx.fillText(String(card.big), 290, 500);
    ctx.font = "700 34px 'Space Grotesk', monospace";
    ctx.fillText(card.bigLabel, 290, 560);

    const tint = [["#18dcc0", "#44d018"], ["#ffb020", "#ff5c18"], ["#f02888", "#2a9dff"]];
    card.badges.forEach(([label, on], i) => {
      const y = 300 + i * 112;
      if (on) {
        const g = ctx.createLinearGradient(540, y, 1000, y + 96);
        g.addColorStop(0, tint[i][0]);
        g.addColorStop(1, tint[i][1]);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = "rgba(231,220,244,0.08)";
      }
      roundRect(ctx, 540, y, 460, 96, 26);
      ctx.fill();
      ctx.fillStyle = on ? "#1a0722" : "rgba(231,220,244,0.4)";
      ctx.font = "700 36px 'Space Grotesk', monospace";
      ctx.fillText(label, 770, y + 60);
    });

    ctx.textAlign = "left";
    // The card is 1080x1350 and the thumbnails need real room, so the tab that
    // carries them trades two bar rows for them rather than running off the
    // bottom edge.
    const rows = card.bars.slice(0, card.tops && card.tops.length ? 3 : 5);
    const max = rows.length ? rows[0][1] : 1;
    rows.forEach(([emoji, n], i) => {
      const y = 730 + i * 90;
      const { c, alt } = emojiColor(emoji);

      ctx.font = "56px " + EMOJI_FONTS;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(emoji, 80, y + 50);

      ctx.fillStyle = "rgba(231,220,244,0.1)";
      roundRect(ctx, 180, y + 10, 740, 48, 24);
      ctx.fill();

      const w = Math.max(48, 740 * (n / max));
      if (i === 0) {
        const g = ctx.createLinearGradient(180, 0, 180 + w, 0);
        g.addColorStop(0, c);
        g.addColorStop(1, alt);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = c;
      }
      roundRect(ctx, 180, y + 10, w, 48, 24);
      ctx.fill();

      ctx.fillStyle = "rgba(231,220,244,0.9)";
      ctx.font = "700 34px 'Space Grotesk', monospace";
      ctx.fillText(String(n), 950, y + 48);
    });

    if (card.tops && card.tops.length) paintTops(ctx, card.tops, 1010, 200);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(231,220,244,0.45)";
    ctx.font = "500 32px 'DM Sans', sans-serif";
    ctx.fillText(location.host, 80, 1290);
  }

  // Wrap by measuring, because the strings are authored content of unknown
  // length and canvas has no line breaking of its own.
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (ctx.measureText(next).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // The board's cell, painted rather than screenshotted: the day frame, the
  // label, and the stickers ringed around it — the same three things the real
  // cell shows, at the one size this card needs.
  function paintTops(ctx, tops, y, w) {
    const hue = getComputedStyle(document.documentElement).getPropertyValue("--day-hue").trim() || "265";
    const gap = 30;
    const startX = (canvas.width - (tops.length * w + (tops.length - 1) * gap)) / 2;

    tops.forEach((top, i) => {
      const x = startX + i * (w + gap);
      ctx.fillStyle = `hsl(${hue} 35% 13%)`;
      roundRect(ctx, x, y, w, w, 22);
      ctx.fill();
      ctx.save();
      roundRect(ctx, x, y, w, w, 22);
      ctx.clip();
      ctx.strokeStyle = `hsl(${hue} 95% 55%)`;
      ctx.lineWidth = 14;
      roundRect(ctx, x, y, w, w, 22);
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.font = "700 21px 'DM Sans', sans-serif";
      const lines = wrap(ctx, top.text, w - 74).slice(0, 4);
      const top0 = y + w / 2 - ((lines.length - 1) * 24) / 2;
      ctx.save();
      ctx.shadowColor = "rgba(6, 3, 10, 0.95)";
      ctx.shadowBlur = 10;
      lines.forEach((l, n) => ctx.fillText(l, x + w / 2, top0 + n * 24));
      ctx.restore();

      // Ring the emoji outside the label block, the way the board seats them.
      ctx.font = "32px " + EMOJI_FONTS;
      const r = w / 2 - 36;
      top.emoji.forEach((em, n) => {
        const a = n * 137.5 * Math.PI / 180;
        ctx.fillText(em, x + w / 2 + Math.cos(a) * r, y + w / 2 + Math.sin(a) * r + 11);
      });

      ctx.fillStyle = "rgba(231,220,244,0.75)";
      ctx.font = "700 24px 'Space Grotesk', monospace";
      ctx.fillText(top.n + (top.n === 1 ? " STICKER" : " STICKERS"), x + w / 2, y + w + 36);
    });
  }

  function canvasBlob() {
    return new Promise((res) => canvas.toBlob(res, "image/png"));
  }

  // Share sheet where there is one, download where there is not. Both paths
  // hand over the same PNG; neither uploads anything.
  async function share() {
    if (!lastCard) return;
    shareView.hidden = false;
    shareNote.dataset.state = "painting";
    await paintShare(lastCard);
    shareNote.dataset.state = "ready";

    const blob = await canvasBlob();
    if (!blob) return;
    const file = new File([blob], "bingo.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        shareView.hidden = true;
        return;
      } catch { /* dismissed — leave the preview up */ }
      return;
    }
    // No share sheet — mainly desktop. Copying the image beats a file landing
    // in Downloads: "paste it anywhere" is the thing people actually wanted.
    // The download stays as the third rung, for browsers with neither.
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        shareNote.dataset.state = "copied";
        return;
      }
    } catch { /* no permission, or not focused */ }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bingo.png";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- wiring ---------------------------------------------------------------

  for (const b of tabs) {
    b.addEventListener("click", () => { tab = b.dataset.statsTab; render(); });
  }
  // "VIEW BOARD" closes outright. It used to minimize to a floating puck, but
  // the tab bar already opens this screen, so the puck was a second control for
  // one action and went with the rest of the board chrome (ADR 0023).
  viewBtn.addEventListener("click", close);

  // Every other sheet in the app dismisses on a scrim tap; this one reads as
  // stuck without it. The panel stops the event, so only the surround closes.
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  shareBtn.addEventListener("click", share);
  shareView.addEventListener("click", () => { shareView.hidden = true; });
  // The observer already covers resize for the thumbnails themselves.

  return { open, close, isOpen, render, maybeAutoOpen };
}
