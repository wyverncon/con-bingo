// Which build this is: the DragonCon card, or the beta.
//
// The beta is not a fork (ADR 0014). It is this codebase with one constant
// flipped: three days instead of five, everyday-life squares instead of con
// ones, and its own dates. Everything else — sync, identity, the cap, the
// admin console, validation — is shared, so a fix made during the beta is
// already made for the con.
//
// A beta deployment MUST also regenerate `room.js` (a new ROOM) and
// `gate.js` (a new salt/hash from an organizer-chosen passphrase). Neither is
// derived from this flag, because getting them wrong must be a deliberate act
// rather than a forgotten one.
//
// "con"  — five cards, Thursday to Monday, DragonCon squares.
// "beta" — three cards, Friday to Sunday, everyday-life squares.
// Committed as "con" on purpose. A beta repo that forgets to flip this shows
// con squares — noticed in seconds. A con repo that forgot to flip it back
// would run the real event on the wrong 75 squares.
export const EDITION = "con";

export const isBeta = EDITION === "beta";
