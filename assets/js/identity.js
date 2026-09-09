// Per-device generated name (spec section 5).
//
// Names are fed into playhtml's durable identity (playhtml_player_identity in
// localStorage) via init's playerIdentity option and playhtml.users.me — no
// parallel store (phase-4.md). Stickers stamp `who` at placement time, so a
// reroll only affects future placements; past stickers keep the old name.

import { generateName } from "../data/names.js";
import { DOTS } from "../data/theme.js";

const LEGACY_KEY = "dcb.identity.v1";
const PH_KEY = "playhtml_player_identity";

let me = null;
let ph = null;

function readPlayhtmlRecord() {
  try {
    const raw = localStorage.getItem(PH_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* private mode / corrupt */ }
  return null;
}

function readStoredName() {
  const rec = readPlayhtmlRecord();
  if (rec?.name) return rec.name;
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      localStorage.removeItem(LEGACY_KEY);
      return legacy;
    }
  } catch { /* private */ }
  return null;
}

function defaultPalette() {
  const i = Math.floor(Math.random() * DOTS.length);
  return [DOTS[i], DOTS[(i + 1) % DOTS.length], DOTS[(i + 2) % DOTS.length]];
}

function ensureName() {
  if (me) return me;
  me = readStoredName() || generateName();
  return me;
}

export function whoAmI() {
  if (ph?.users?.me?.name) return ph.users.me.name;
  return ensureName();
}

/** Seed for playhtml.init({ cursors: { playerIdentity } }).
 *  playhtml 2.14.1 throws if playerIdentity is set without publicKey. On a
 *  first visit there is no stored key yet — return null so sync omits the
 *  option and playhtml mints one; attachIdentity then applies our name. */
export function identityForInit() {
  const name = ensureName();
  const stored = readPlayhtmlRecord();
  if (!stored?.publicKey) return null;
  return {
    ...stored,
    name,
    playerStyle: stored.playerStyle?.colorPalette?.length
      ? stored.playerStyle
      : { colorPalette: defaultPalette() }
  };
}

/** Call once after playhtml.init resolves. */
export function attachIdentity(playhtml) {
  ph = playhtml;
  const name = ensureName();
  if (!playhtml.users.me.name) playhtml.users.me.name = name;
  else me = playhtml.users.me.name;
  return playhtml.users.onChange(() => {
    if (playhtml.users.me.name) me = playhtml.users.me.name;
  });
}

export function reroll() {
  const prev = whoAmI();
  const next = generateName();
  me = next;
  if (ph) ph.users.me.name = next;
  return { prev, next };
}

export function myColor() {
  return ph?.users?.me?.color || DOTS[0];
}
