// FirestoreStore against the Firestore + Auth emulators: two "phones" (separate app instances)
// signed in as household members. Run with `npm run test:rules`.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, getDocs, initializeFirestore, setDoc, terminate, waitForPendingWrites,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { total } from '../../src/domain/inventory';
import { DEFAULT_CUPBOARDS, lotId } from '../../src/domain/types';
import type { State } from '../../src/domain/types';
import { FirestoreStore } from '../../src/store/firestore';

const PROJECT = 'demo-cupboard';
const HID = 'home';
let env: RulesTestEnvironment;
const apps: FirebaseApp[] = [];
const stores: FirestoreStore[] = [];

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `households/${HID}`), { name: 'Home' });
    await setDoc(doc(db, `households/${HID}/members/shared@example.com`), {});
  });
});

afterEach(async () => {
  stores.splice(0).forEach((s) => s.close());
  for (const app of apps.splice(0)) await deleteApp(app);
});

/** A phone: its own app, signed in with Google via the auth emulator. */
async function phone(name: string, email = 'shared@example.com'): Promise<{ db: Firestore; store: FirestoreStore }> {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: name }, name + Math.random());
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const store = new FirestoreStore(db, HID, () => name);
  stores.push(store);
  return { db, store };
}

/** Resolve when the store's state satisfies `pred`. */
function until(store: FirestoreStore, pred: (s: State) => boolean, ms = 5000): Promise<State> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { off(); reject(new Error('timed out waiting for state')); }, ms);
    const off = store.subscribe((s) => {
      if (pred(s)) { clearTimeout(t); queueMicrotask(() => off()); resolve(s); }
    });
  });
}

const pantryAdd = (store: FirestoreStore, s: State, qty: number) =>
  store.addStock({ pid: null, name: 'Beans', target: 2, cupboard: s.cupboards.order[0], date: '2028-03', qty });

describe('FirestoreStore', () => {
  it('seeds a new household with one cupboard', async () => {
    const { store, db } = await phone('A');
    const s = await until(store, (x) => x.cupboards.order.length > 0);
    expect(s.cupboards).toEqual(DEFAULT_CUPBOARDS);
    // The seed is written once the server confirms the doc is missing.
    await expect.poll(async () => {
      await waitForPendingWrites(db);
      return env.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDocs(collection(ctx.firestore(), `households/${HID}/settings`));
        expect(snap.docs.map((d) => [d.id, d.data()])).toEqual([['cupboards', DEFAULT_CUPBOARDS]]);
      }).then(() => true, () => false);
    }, { timeout: 5000 }).toBe(true);
  });

  it('syncs an add to the other phone, with a transaction log entry', async () => {
    const a = await phone('Kitchen');
    const b = await phone('Hall');
    const s = await until(a.store, () => true);
    await until(b.store, () => true);
    pantryAdd(a.store, s, 3);
    const seen = await until(b.store, (x) => Object.values(x.products).some((p) => p.name === 'Beans' && total(x, p.id) === 3));
    const p = Object.values(seen.products).find((x) => x.name === 'Beans')!;
    expect(p).toMatchObject({ nameLower: 'beans', target: 2, cupboards: ['cupboard'], lastDate: '2028-03', lastAddCupboard: 'cupboard' });
    expect(typeof p.lastAdded).toBe('number');
    await waitForPendingWrites(a.db);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const log = await getDocs(collection(ctx.firestore(), `households/${HID}/transactions`));
      expect(log.size).toBe(1);
      expect(log.docs[0].data()).toMatchObject({ kind: 'add', by: 'Kitchen', pid: p.id });
      expect(log.docs[0].data().details.inverse.length).toBeGreaterThan(0);
    });
  });

  it('concurrent adds of the same lot from two phones merge (increment on a deterministic id)', async () => {
    const a = await phone('A');
    const b = await phone('B');
    const s = await until(a.store, () => true);
    pantryAdd(a.store, s, 1);
    const sb = await until(b.store, (x) => Object.keys(x.products).length === 1);
    const pid = Object.keys(sb.products)[0];
    // Both phones add 2 of the same date and cupboard at the same moment.
    const sa = a.store.current!;
    a.store.addStock({ pid, cupboard: sa.cupboards.order[0], date: '2028-03', qty: 2 });
    b.store.addStock({ pid, cupboard: sb.cupboards.order[0], date: '2028-03', qty: 2 });
    await Promise.all([waitForPendingWrites(a.db), waitForPendingWrites(b.db)]);
    const id = lotId(pid, 'cupboard', '2028-03');
    const fa = await until(a.store, (x) => x.lots[id]?.qty === 5);
    const fb = await until(b.store, (x) => x.lots[id]?.qty === 5);
    expect(Object.keys(fa.lots)).toEqual([id]);
    expect(fb.lots[id].qty).toBe(5);
  });

  it('undo reverses only this phone’s change, keeping the other phone’s', async () => {
    const a = await phone('A');
    const b = await phone('B');
    const s = await until(a.store, () => true);
    pantryAdd(a.store, s, 4);
    const sb = await until(b.store, (x) => Object.keys(x.lots).length === 1);
    const pid = Object.keys(sb.products)[0];
    const id = lotId(pid, 'cupboard', '2028-03');
    // A uses 3; B adds 10 to the same lot; then A undoes its use.
    const tok = a.store.useStock(pid, 3, null)!;
    await waitForPendingWrites(a.db);
    await until(b.store, (x) => x.lots[id]?.qty === 1);
    b.store.addStock({ pid, cupboard: 'cupboard', date: '2028-03', qty: 10 });
    await waitForPendingWrites(b.db);
    await until(a.store, (x) => x.lots[id]?.qty === 11);
    a.store.undo(tok);
    await waitForPendingWrites(a.db);
    await until(b.store, (x) => x.lots[id]?.qty === 14);
  });

  it('a lot used up is deleted, and undo brings it back', async () => {
    const a = await phone('A');
    const s = await until(a.store, () => true);
    pantryAdd(a.store, s, 2);
    const pid = Object.keys(a.store.current!.products)[0];
    const tok = a.store.useStock(pid, 2, null)!;
    await waitForPendingWrites(a.db);
    await env.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDocs(collection(ctx.firestore(), `households/${HID}/lots`))).size).toBe(0);
    });
    a.store.undo(tok);
    await waitForPendingWrites(a.db);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const lots = await getDocs(collection(ctx.firestore(), `households/${HID}/lots`));
      expect(lots.docs.map((d) => d.data())).toEqual([{ pid, cupboard: 'cupboard', date: '2028-03', qty: 2 }]);
    });
  });

  it('swap is one batch and matches the SPEC scenario', async () => {
    const a = await phone('A');
    await until(a.store, () => true);
    a.store.addCupboard('Box 1');
    const box = a.store.current!.cupboards.order[1];
    const pantry = 'cupboard';
    a.store.addStock({ pid: null, name: 'Toms', target: 4, cupboard: pantry, date: '2029-01', qty: 8 });
    const pid = Object.keys(a.store.current!.products)[0];
    a.store.addStock({ pid, cupboard: box, date: '2027-11', qty: 3 });
    a.store.swap(pid, 3, 6);
    await waitForPendingWrites(a.db);
    const b = await phone('B');
    const s = await until(b.store, (x) => Object.keys(x.lots).length === 3);
    const where = Object.values(s.lots).map((l) => [s.cupboards.names[l.cupboard], l.date, l.qty]).sort();
    expect(where).toEqual([['Box 1', '2029-01', 6], ['Cupboard', '2027-11', 3], ['Cupboard', '2029-01', 2]]);
  });

  it('delete product and undo keeps the same id; cupboard rename is one doc', async () => {
    const a = await phone('A');
    const s = await until(a.store, () => true);
    pantryAdd(a.store, s, 1);
    const pid = Object.keys(a.store.current!.products)[0];
    a.store.useStock(pid, 1, null);
    const tok = a.store.deleteProduct(pid)!;
    expect(a.store.current!.products[pid]).toBeUndefined();
    a.store.undo(tok);
    a.store.renameCupboard('cupboard', 'Pantry');
    await waitForPendingWrites(a.db);
    const b = await phone('B');
    const sb = await until(b.store, (x) => !!x.products[pid] && x.cupboards.names.cupboard === 'Pantry');
    expect(sb.products[pid].name).toBe('Beans');
  });

  it('a non-member gets permission-denied', async () => {
    const { store } = await phone('X', 'stranger@example.com');
    const err = await new Promise<{ code?: string }>((resolve) => store.onError((e) => resolve(e as { code?: string })));
    expect(err.code).toBe('permission-denied');
  });

  it('cleans up', async () => {
    // Make sure terminate works for apps created in tests (no hanging listeners).
    const a = await phone('A');
    await until(a.store, () => true);
    a.store.close();
    await terminate(a.db);
  });
});
