# Vendored playhtml 2.14.1

Copied verbatim from unpkg on 2026-08-26 (security addendum §2.4, Phase 6b):

    https://unpkg.com/playhtml@2.14.1/dist/playhtml.es.js
    https://unpkg.com/playhtml@2.14.1/dist/index-DlJfxvdB.js
    https://unpkg.com/playhtml@2.14.1/dist/leafEditor.es.js

Vendoring these is a **copy, not a build step** (hard rule 1). The three files
import each other by relative path and import nothing else — no bare
specifiers, no further CDN fetches — so dropping them in a directory together
is all the "bundling" required. Verified with:

    grep -ohE '(from|import)\s*"[^"]+"' *.js | sort -u

sha256, as fetched:

    f15fd0ee961b142522e3cec8d519a5d8eba3320cfd3b411820057e084102452f  index-DlJfxvdB.js
    44a368b257157a63fc01137ced680b568f04195b8da88da716a7dc422e05267e  leafEditor.es.js
    8a0593d3e03c73c7441c5c41ddba26605780847265b5d271d512b0b17080edbc  playhtml.es.js

## Do not edit these files

They are third-party build output. To move to a new playhtml version, re-run
the three curls against the new version tag into a new sibling directory (the
hashed chunk name changes per release), repeat the import check above, update
the import in `assets/js/sync.js`, and re-run the CSP click-through — the
library's own network calls are part of what the CSP has to allow.

## Known residual: one unpinned CDN request

The library itself requests `https://unpkg.com/playhtml@latest/dist/style.css`
at runtime — an unpinned URL baked into the chunk, which vendoring the JS does
not remove. It styles playhtml's own cursor/editor widgets, none of which this
app renders. The CSP does **not** allow it, so the browser blocks it and the
board is unaffected; this is the one expected violation in the console.
