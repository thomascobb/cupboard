# Implementation decisions

Choices made while building the app from `SPEC.md` and the prototype, where the spec left room or said "ask". Each is easy to revisit.

## Agreed with the owner (Nov 2026)

- **Deploys:** done by the owner, not by the build agent.
- **Branching:** commits go straight to `main`.
- **Undo of "Delete this item":** fine either way. In practice undo recreates the product with the **same id** (Firestore allows re-creating a deleted doc id), so nothing changes for the user.
- **New household seed:** one cupboard called "Cupboard", not the prototype's five. `?demo` keeps the prototype's five cupboards and sample data.

## Data and sync

- **Every change is a list of primitive ops** (`src/domain/ops.ts`): lot delta, product set/patch/delete, cupboard list. Pure functions in `src/domain/actions.ts` turn a user action into ops. Both stores apply ops the same way, as one Firestore `writeBatch` plus a `transactions/` log doc.
- **Undo** applies the inverse ops, computed from local state just before the change and stored in the transaction record. Lot inverses are deltas (`increment()`), so undoing doesn't clobber the other phone's adds or uses. Product and cupboard-list inverses restore the previous field values, which is last-writer-wins. That's acceptable for a 6-second undo.
- **Undo is tied to the toast.** Changes the prototype makes without a toast (target stepper, ↑ ↓ × on cupboard order) don't replace the pending undo. The Undo button always undoes what its toast describes.
- **Lots at zero are deleted.** When a delta would take a lot to ≤ 0 according to local state, the batch deletes the doc rather than incrementing it. If the other phone added to that same lot in the same instant, that add is lost. This is rare, and a transaction would break offline writes. Lots with qty ≤ 0 are ignored everywhere in case one slips through.
- **Writes don't wait for the server.** The UI updates from Firestore's local snapshot at once. Commit errors (e.g. permission revoked) show in a toast.
- **Cupboard ids** are short random ids; names live in `settings/cupboards.names`, so renames touch one doc. The default cupboard's id is the fixed `cupboard`, so two phones seeding a brand-new household at once write identical docs.
- **Seeding** happens only when the server (not the offline cache) says `settings/cupboards` is missing.
- **`lastAdded`** is stored as a Firestore `Timestamp` and handled as epoch millis in the domain.
- **Dates** stay `YYYY-MM` strings. `status()` compares the first 7 characters, so `YYYY-MM-DD` would also work later.

## Behaviour differences from the prototype (bug fixes)

- **Default Add date in a past year** (e.g. a product last added in 2024): the prototype selected a year that isn't among the chips. Now it falls back to next year with no month, like a fresh product.
- **Use sheet stepper:** the prototype's "uqty" had no upper bound in its click handler (the button was disabled at the max). Same for the new code, but clamped in code too.
- **Toast blocked the sheet underneath.** The toast covers the bottom of an open sheet for 6 s, so tapping e.g. “Delete this item” straight after “Removed one” did nothing. Taps now pass through the toast except on Undo. It looks the same.
- **Right-click on a cupboard chip** opened the rename sheet and then swallowed the next click for 700 ms (the long-press guard). The guard now applies only when a finger or the main button is still down, which also covers Android Chrome’s long-press `contextmenu`.
- **Prototype dead code** (`move-front`, `mqty`) is not ported. The Rotate panel replaced it.

## Auth

- **`authDomain`** is overridden to the page's own host when served from Firebase Hosting (`*.web.app` / `*.firebaseapp.com`), so the sign-in helper runs first-party. Without this, iOS Safari's storage partitioning breaks `signInWithPopup` / redirect on some versions. This is Firebase's documented "option 1" for redirect best practices. Hosting serves `/__/auth/*` on every hosting domain. The cost is one setup step: adding `https://<project-id>.web.app/__/auth/handler` to the OAuth client's redirect URIs (README step 2.5).
- The service worker never handles `/__/` URLs (auth handler, `init.json`).

## Dependencies

- Packages that ship in the app (`firebase`) and the build tools (`vite`) are pinned to releases at least two weeks old at the time of writing. `vitest` is 5.1.1 (a few days old): pinning 5.1.0 crashed npm 10's resolver (`edgesOut` of null). It's a dev-only test runner.
- `@playwright/test` is pinned to 1.63.0 to match the browsers installed in the dev sandbox.
- Icons are drawn by `scripts/make-icons.mjs` (no image dependencies). Run `npm run icons` after changing it; the PNGs are committed.
