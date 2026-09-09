// Admin passphrase gate (spec section 9, ADR 0003).
//
// Friction, not auth: the repo is public and the room is writable directly.
// Never describe this as security in comments, docs, or UI.
//
// Nothing on admin.html may render its console or call playhtml.init until
// unlock() succeeds (or a still-valid 12h cache is present).
//
// Only SALT_B64 and HASH_B64 live in source. The passphrase never does.
// Derive fresh constants with tools/gate-hash.html after the organizer picks
// a long random passphrase and stores it out of band.

export const ITERATIONS = 310_000;
export const HASH_ALG = "SHA-256";
export const CACHE_MS = 12 * 60 * 60 * 1000;
export const CACHE_KEY = "dcb.admin.gate.v1";

// Filled from tools/gate-hash.html. An empty hash means no passphrase unlocks
// at all — intentional, not a default secret — and `isConfigured()` is what
// reports which state this is; do not read it off this comment.
//
// SEALED, with the con's own constants. The beta's are never reused here and
// these are never reused there: a shared passphrase would mean unlocking one
// console unlocks the other, and this is the board that matters. The
// passphrase itself is the organizer's and lives out of band.
export const SALT_B64 = "3XhV/QbOpxGzdAYSwcEQkQ==";
export const HASH_B64 = "T/7kIVJvSV4HExNyW5WSsyVCgPSFzuqYzIDtItBM5X8=";

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// PBKDF2 lives in SubtleCrypto, which browsers expose only to secure contexts:
// https, or localhost. A phone pointed at `http://192.168.x.x:8000` therefore
// has no `crypto.subtle` at all, and every call here throws rather than
// returning false — which reads on screen as a hang. Callers check this first
// and say so. Nothing about the gate itself changes; this is the browser's
// rule about where the maths may run.
export function hasWebCrypto() {
  return Boolean(globalThis.crypto && globalThis.crypto.subtle);
}

export async function deriveHash(passphrase, saltBytes, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: HASH_ALG, salt: saltBytes, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export function isConfigured() {
  return Boolean(SALT_B64 && HASH_B64);
}

export function isUnlocked(now = Date.now()) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const { until } = JSON.parse(raw);
    return typeof until === "number" && until > now;
  } catch {
    return false;
  }
}

export function cacheUnlock(now = Date.now()) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ until: now + CACHE_MS }));
  } catch { /* private mode — unlock still works for this page load */ }
}

export function clearUnlock() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

// Returns true on match. Wrong passphrase: false, no cache write.
export async function unlock(passphrase) {
  if (!isConfigured()) return false;
  if (typeof passphrase !== "string" || !passphrase) return false;
  const salt = b64ToBytes(SALT_B64);
  const expected = b64ToBytes(HASH_B64);
  const got = await deriveHash(passphrase, salt);
  if (!timingSafeEqual(got, expected)) return false;
  cacheUnlock();
  return true;
}

// Exported for tools/gate-hash.html — not used by the gate itself.
export { bytesToB64, b64ToBytes };
