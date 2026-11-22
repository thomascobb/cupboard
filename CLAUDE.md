# Cupboard

Shared store-cupboard inventory PWA (iPhone + Android), Firebase free tier, multi-household.

- **Read `docs/SPEC.md` first.** It is the agreed requirements and design.
- **`docs/prototype.html` is the UI and behaviour reference**, signed off after testing on an iPhone SE 2. Match it; ask before deviating.
- `firestore.rules` and `scripts/admin.mjs` are already designed. Membership is admin-script only; the app never writes `members` or the household doc.
- Keep it light: TypeScript + Vite, minimal dependencies. Target device is an iPhone SE 2 in Safari / home-screen mode.
- No barcode scanning, OCR, camera, Cloud Functions or Cloud Storage. These were tried or ruled out deliberately.
- Domain logic lives in `src/domain/` as pure functions with Vitest tests. The UI goes through a `Store` interface, never Firestore directly.
- Before calling something done: `npm test`, `npm run test:rules` (emulators), `npm run test:e2e` and `npm run test:e2e:emu` (Playwright), `npm run build`.
- Every change is a list of ops built by a pure function in `src/domain/actions.ts`; stores apply ops, and undo applies their inverse (`src/domain/ops.ts`). Add new behaviour there first, with tests.
- Choices made where the spec left room are in `docs/DECISIONS.md`; add to it rather than silently diverging from the prototype.

## Suggested order

1. Scaffold Vite + TS, Vitest, `npm test`, `npm run build` into `dist/`.
2. Port the domain logic from the prototype with tests (incl. the swap scenario in SPEC §10).
3. `MemoryStore` + UI ported from the prototype, runnable with `?demo`.
4. Auth + household selection + `FirestoreStore`; rules tests in the emulator.
5. PWA manifest/service worker, export JSON, README updates, deploy.
