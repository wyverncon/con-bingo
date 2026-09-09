// The playhtml room every page joins. See ADR 0002.
//
// playhtml derives the room from the URL by default, which would put
// admin.html in a different room than index.html. Both pages must pass this
// constant to playhtml.init({ room: ROOM }).
//
// playhtml prefixes the room with the page's hostname AND port, so a local
// dev server is automatically isolated from the deployed site. You do not
// need to change anything here to develop safely.
//
// This string is the only thing keeping strangers off the board (spec section
// 10.3). It ships publicly — GitHub Pages on a free account requires a public
// repo — so it is obscurity of the repo, not of the string, doing the work.
//
// Rotate it freely before launch. NEVER rotate it during the con: every
// sticker already placed lives under the old room and would be abandoned.
// Rotated 2026-08-28, before the con build was published to its public host
// (ADR 0018). The previous id had only ever held test stickers, and it must not
// be the one that ships in a public repo after people start playing.
//
// Safe to rotate again any time before Thursday 2026-09-03. NEVER during the
// con: every sticker already placed lives under the old room and is abandoned.
export const ROOM = "ry2uzha84yoa4lybosr38xp9yl8rtnmd";
