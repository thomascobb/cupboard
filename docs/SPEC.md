# Cupboard: implementation spec

This is the handoff from the prototype phase. `docs/prototype.html` is a single-file, localStorage-only prototype that the household has tested on an iPhone SE 2 and signed off. **Its UI and behaviour are the reference.** Where this spec and the prototype disagree, ask; otherwise match the prototype.

The job is to turn it into the real app: a TypeScript PWA on Firebase Hosting, backed by Firestore, signed in with Google, multi-household, with the repo's existing `README.md`, `firestore.rules` and `scripts/admin.mjs`.

## 1. Goals and non-goals

**Goals**
- Shared store-cupboard inventory for a household, used from an iPhone (Safari / home-screen PWA) and an Android phone (Chrome).
- Fast entry: type-ahead product, month/year chips for best-before, quantity, cupboard.
- "Use" tells you which one to take (earliest date) and how many are left.
- Shopping list from per-product targets.
- Stock rotation between a product's front cupboard and reserve cupboards, done as a batch from Home.
- Free to run (Firebase Spark plan), one public repo, many households per deployment.

**Non-goals (decided, don't add)**
- No barcode scanning. No OCR or date scanning (tested on the iPhone, unreliable). No camera at all.
- No native apps, no app stores.
- No Cloud Functions or Cloud Storage (not on Spark).
- No in-app membership management; membership is admin-script only.

## 2. Stack

- **TypeScript + Vite**, building a static site into `dist/`. Keep the UI framework light: vanilla TS with small render functions (as the prototype does), Preact, or Lit are all fine. Avoid anything heavy; the target phone is an iPhone SE 2.
- **Firebase JS SDK v10+ (modular)**: Auth (Google provider) and Firestore with offline persistence (`persistentLocalCache`).
- **Firebase Hosting** (not GitHub Pages): needed so Google sign-in works in iOS Safari, and so the app can load its config from `/__/firebase/init.json` with nothing per-deployment in the repo.
- **PWA**: web app manifest + a simple service worker for app-shell caching (e.g. `vite-plugin-pwa`). Firestore's own cache handles data offline.
- **Tests**: Vitest for the pure domain logic; `@firebase/rules-unit-testing` against the Firestore emulator for the rules.

## 3. Architecture

Three layers, so the UI never talks to Firestore directly:

```
src/
  domain/     pure functions, no I/O: dates, sorting, rotation/swap planning, shop list
  store/      Store interface + FirestoreStore + MemoryStore (tests, and a ?demo mode)
  ui/         tabs, list, sheets, components
  auth.ts     sign-in, household selection
  main.ts
```

- `domain/` is a direct port of the prototype's logic (`lotsFor`, `byAge`, `reserveLots`, `plan`, `swapNeeds`, `swap`, `rotationNeeds`, shop calculation). Unit test it thoroughly; most bugs will be here.
- `store/` exposes something like: `subscribe(cb)`, `addStock`, `useStock`, `moveLot`, `swap`, `setTarget`, `setCupboardOrder`, `addCupboard`, `renameCupboard`, `deleteCupboard`, `createProduct`, `deleteProduct`, `undo`. Multi-document changes are a single `writeBatch` or transaction.
- The UI subscribes to the household's products, lots and settings with snapshot listeners and re-renders from that state.

## 4. Auth and households

Already designed and implemented in `firestore.rules` and `scripts/admin.mjs`; keep them.

- Users sign in with Google (`signInWithPopup`). Households typically share one Google account, but several accounts per household also work.
- Membership: `households/{hid}/members/{email}` exists ⇒ that verified email can read/write `households/{hid}/**` (products, lots, transactions, settings). Emails are stored lowercased; rules compare `request.auth.token.email.lower()`.
- Only the admin script creates households and members (Admin SDK bypasses rules). The app never writes members.
- **Choosing the household:** the link is `https://<project>.web.app/#h=<hid>`. On load:
  1. If `#h=` is present, store `hid` in localStorage.
  2. Else use the stored `hid`.
  3. Else show a one-field "Which household?" screen (iOS home-screen apps launch from the manifest start URL without the hash and have separate storage from Safari, so this screen is expected once per installed app).
- After sign-in, read `households/{hid}`. Permission denied ⇒ show "This Google account isn't in household *X*" with a sign-out / switch-account button.
- Sign-out lives in a small settings area (e.g. long-press the title or a gear on Home); don't add a fifth tab.

## 5. Data model

All under `households/{hid}/`.

### `settings/cupboards`
```ts
{ order: string[] }   // e.g. ["Pantry","Utility tall","Utility high","Box 1","Box 2"]
```
Cupboards are identified by **name** in the prototype. For the real app, prefer stable ids so renames don't rewrite every lot:
```ts
{ order: string[], names: Record<string, string> }  // ids in display order, id -> name
```
Seed a new household with the five default cupboards on first load if the doc doesn't exist.

### `products/{pid}`
```ts
{
  name: string,            // generic, e.g. "Chopped tomatoes 400g"
  nameLower: string,       // for dedupe
  target: number,          // "keep at least"; 0 = not on shop list
  cupboards: string[],     // ordered cupboard ids: [front, ...reserve]
  lastAddCupboard?: string,// default for the next Add of this product
  lastDate?: string,       // "YYYY-MM", default date for the next Add
  lastAdded?: Timestamp,   // Add tab recency order
}
```

### `lots/{lotId}`
```ts
{ pid: string, cupboard: string, date: string /* "YYYY-MM" */, qty: number }
```
- At most one lot per (pid, cupboard, date); adding merges into it. Use a deterministic id `${pid}_${cupboard}_${date}` so concurrent adds from two phones merge instead of duplicating, and change qty with `increment()`.
- Delete a lot when qty reaches 0.
- Dates are month precision; "best before Mar 2028" means end of March.

### `transactions/{autoId}` (append-only log)
```ts
{ at: Timestamp, by?: string, kind: "add"|"use"|"move"|"swap"|"adjust"|..., pid, details: {...} }
```
Used for history and undo. `by` is an optional per-device name ("Who's this phone?"), stored in localStorage, since a household may share one account.

### Undo
The prototype snapshots the whole DB. In the real app, undo the last action this device made by applying its inverse from the transaction record (e.g. re-increment lots), not by restoring a snapshot, so you don't clobber the other phone's concurrent changes. One level of undo, from the toast, is enough.

## 6. Domain rules (port exactly)

- **Status colours:** `expired` if date < this month; `soon` if within the next 2 months (inclusive); else `ok`.
- **Lot order (`byAge`)**: by date ascending, ties broken by the product's cupboard order (front first).
- **Front cupboard** = `cupboards[0]`. Reserve = the rest.
- **Cupboard list is learned:** adding or moving stock into a cupboard not in the product's list appends it.
- **Use:** take from lots in `byAge` order (within the cupboard filter if one is selected).
- **Shop:** products where total stock (all cupboards, reserve included) < target. Sort by shortfall desc, then name. The cupboard filter on Shop filters by the product's front cupboard.
- **Rotation / swap** (`swapNeeds`):
  - `f` (oldest to front) = qty of reserve lots older than the newest lot in front.
  - `r` (newest to back) = qty of front lots newer than the oldest reserve lot.
  - If the front is empty and reserve isn't: `f = min(reserveTotal, max(1, target))`, `r = 0`.
  - A product "needs rotation" if it has ≥2 cupboards and `f > 0 || r > 0`.
  - Executing a swap: take `f` oldest from reserve (`byAge`) into front; take `r` newest from front into the reserve cupboard holding the oldest reserve stock (`backTarget`). Compute both plans from the state *before* moving anything. One batch write.
- **Search:** case-insensitive; every whitespace-separated term must appear in the name.
- **Default cupboard for Add**, in order: product's `lastAddCupboard` → selected cupboard filter → household's last Add cupboard (localStorage is fine) → last cupboard in the product's list → first cupboard.
- **Default date for Add:** product's `lastDate` → the last date entered this session → nothing selected, year = next year. Months in the past (this year) are disabled.

## 7. UI

Match `docs/prototype.html` for layout, wording, sizes and colours (iOS system font and palette, light and dark). Summary:

**Shell**
- Header: large title, item count, cupboard filter chips (All + cupboards + "+"), search field.
- Bottom tab bar: Home, Use, Shop, Add. Always visible, including while a sheet is open (sheets sit above it).
- The search text and cupboard filter persist across tab switches.
- If an item's sheet is open when you switch tab, reopen the same item in the new tab's view (Home/Shop: detail; Use: take; Add: add). An unsaved Add sheet is restored when you come back to Add.
- Sheets slide up only when first opened, not on every re-render.
- Toasts with Undo after every change.

**Home:** stock alphabetical; row = name, cupboards it's in (front first), earliest date pill, total qty. A "Rotate stock" row at the top when any product needs rotation (hidden while searching). Tap row → detail sheet.

**Use:** in-stock products sorted by earliest date; row sub-text "Take from <cupboard>". Tap → take sheet: big date pill, "from <cupboard>", qty stepper, "N left after this", other lots listed, "Take N".

**Shop:** products below target; "Have X of Y", "Buy N". Tap → detail.

**Add:** matching products by recency, with an "Add “<text>”" new-item row *after* the matches. Tap → add sheet: (name field + "Keep at least" stepper if new), year chips (this year + 5), 4×3 month chips, quantity stepper, cupboard chips (product's cupboards first), "Add N to <cupboard>". No rotation in Add (deliberately removed: the boxes aren't accessible while unpacking).

**Detail sheet:** stock lots (date pill, cupboard select to move the lot, qty, − to remove one); Rotate panel with two pre-filled steppers (oldest to front / newest to back), date previews and a "Swap: …" button; cupboard order with ↑ ↓ × (× only for cupboards without stock, not the last one) and "Add a cupboard…"; "Keep at least" stepper; "Add more"; "Delete this item" when out of stock.

**Rotate stock sheet (from Home):** every product needing rotation, ticked, each with the same two steppers and previews; "Rotate N items".

**Cupboard management:** "+" chip → New cupboard (name, reject blank/duplicate case-insensitively). Long-press (and right-click) a cupboard chip → rename / delete; delete only when empty and not the last cupboard. Long-press must swallow the follow-up click (see prototype's `suppressClickUntil`) or the sheet closes immediately on iOS.

## 8. Things the prototype doesn't do that the app must

- Real-time sync between phones; offline edits that sync later.
- Concurrency-safe writes (`increment`, deterministic lot ids, batches/transactions for multi-lot operations).
- Loading, signed-out, wrong-account and no-household states.
- PWA manifest (name "Cupboard", icons, `display: standalone`, theme colours), iOS `apple-touch-icon`.
- An "Export JSON" button (backup; Spark has no scheduled exports).
- Remove "Reset sample data". Optionally keep a `?demo` mode using `MemoryStore` with the prototype's seed data.

## 9. Known open points (decide, don't block)

- Exact-day dates for short-dated items, and a "no date" option (e.g. salt). Not requested yet; design the date field so it could hold `YYYY-MM-DD` or null later.
- Duplicate products with similar names ("chopped toms" vs "Chopped tomatoes"): no merge feature yet.

## 10. Testing and done criteria

- Vitest unit tests for every function in `domain/`, including the swap scenario: Pantry 8 × Jan 2029, Box 1 3 × Nov 2027 ⇒ suggests f=3, r=8; executing f=3, r=6 leaves Pantry {Nov 2027 ×3, Jan 2029 ×2}, Box 1 {Jan 2029 ×6}.
- Rules tests in the emulator: stranger can't read; member of A can't read B; nobody can write `members` or the household doc from the client; unverified email denied; member can CRUD products/lots/transactions/settings.
- Manual check on an iPhone home-screen install: sign-in, household prompt, all four tabs, long-press, sheets above the tab bar, offline add then sync.
- `README.md` updated so `npm run build` and `npx firebase deploy` work as written; add `npm test`.
