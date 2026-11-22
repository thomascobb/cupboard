// firestore.rules against the emulator. Run with `npm run test:rules`.
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

/** A signed-in Google user (the emulator trusts these claims). */
const as = (uid: string, email: string, verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cupboard',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households/a'), { name: 'House A' });
    await setDoc(doc(db, 'households/b'), { name: 'House B' });
    await setDoc(doc(db, `households/a/members/${ALICE}`), {});
    await setDoc(doc(db, `households/b/members/${BOB}`), {});
    await setDoc(doc(db, 'households/a/products/p1'), { name: 'Beans', nameLower: 'beans', target: 1, cupboards: ['c'] });
    await setDoc(doc(db, 'households/b/products/p1'), { name: 'Rice', nameLower: 'rice', target: 1, cupboards: ['c'] });
  });
});

describe('strangers', () => {
  it('signed-out users can read nothing', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'households/a')));
    await assertFails(getDoc(doc(db, 'households/a/products/p1')));
    await assertFails(getDocs(collection(db, 'households/a/products')));
    await assertFails(setDoc(doc(db, 'households/a/products/x'), { name: 'X' }));
  });

  it('a signed-in non-member can read or write nothing', async () => {
    const db = as('eve', 'eve@example.com');
    await assertFails(getDoc(doc(db, 'households/a')));
    await assertFails(getDocs(collection(db, 'households/a/lots')));
    await assertFails(getDocs(collection(db, 'households/a/members')));
    await assertFails(setDoc(doc(db, 'households/a/lots/l1'), { qty: 1 }));
  });

  it('households cannot be listed', async () => {
    await assertFails(getDocs(collection(as('alice', ALICE), 'households')));
  });
});

describe('isolation between households', () => {
  it('a member of A cannot read or write B', async () => {
    const db = as('alice', ALICE);
    await assertFails(getDoc(doc(db, 'households/b')));
    await assertFails(getDoc(doc(db, 'households/b/products/p1')));
    await assertFails(getDocs(collection(db, 'households/b/products')));
    await assertFails(setDoc(doc(db, 'households/b/products/p2'), { name: 'Hack' }));
    await assertFails(deleteDoc(doc(db, 'households/b/products/p1')));
  });
});

describe('membership and the household doc are admin-only', () => {
  it('a member can read the household doc and member list but not write them', async () => {
    const db = as('alice', ALICE);
    await assertSucceeds(getDoc(doc(db, 'households/a')));
    await assertSucceeds(getDocs(collection(db, 'households/a/members')));
    await assertFails(setDoc(doc(db, 'households/a'), { name: 'Mine now' }));
    await assertFails(updateDoc(doc(db, 'households/a'), { name: 'Mine now' }));
    await assertFails(deleteDoc(doc(db, 'households/a')));
    await assertFails(setDoc(doc(db, 'households/a/members/eve@example.com'), {}));
    await assertFails(deleteDoc(doc(db, `households/a/members/${ALICE}`)));
  });

  it('nobody can add themselves to a household', async () => {
    const db = as('eve', 'eve@example.com');
    await assertFails(setDoc(doc(db, 'households/a/members/eve@example.com'), {}));
    await assertFails(setDoc(doc(db, 'households/new'), { name: 'New' }));
    await assertFails(setDoc(doc(db, 'households/new/members/eve@example.com'), {}));
  });
});

describe('email checks', () => {
  it('an unverified email is denied even if listed', async () => {
    const db = as('alice', ALICE, false);
    await assertFails(getDoc(doc(db, 'households/a')));
    await assertFails(getDocs(collection(db, 'households/a/products')));
    await assertFails(setDoc(doc(db, 'households/a/products/p2'), { name: 'X' }));
  });

  it('the token email is compared lowercased', async () => {
    const db = as('alice', 'Alice@Example.COM');
    await assertSucceeds(getDoc(doc(db, 'households/a/products/p1')));
  });
});

describe('members can use the inventory', () => {
  for (const coll of ['products', 'lots', 'transactions', 'settings']) {
    it(`CRUD on ${coll}`, async () => {
      const db = as('alice', ALICE);
      const ref = doc(db, `households/a/${coll}/x1`);
      await assertSucceeds(setDoc(ref, { v: 1 }));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(getDocs(collection(db, `households/a/${coll}`)));
      await assertSucceeds(updateDoc(ref, { v: 2 }));
      await assertSucceeds(deleteDoc(ref));
    });
  }

  it('other collections under a household are closed', async () => {
    const db = as('alice', ALICE);
    await assertFails(setDoc(doc(db, 'households/a/secrets/x'), { v: 1 }));
    await assertFails(getDoc(doc(db, 'households/a/secrets/x')));
  });

  it('nothing outside households is open', async () => {
    const db = as('alice', ALICE);
    await assertFails(setDoc(doc(db, 'users/alice'), { v: 1 }));
    await assertFails(getDoc(doc(db, 'users/alice')));
  });
});
