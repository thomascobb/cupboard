// Firestore-backed store. Snapshot listeners keep `state` in sync with the household's data
// (including other phones' changes); each Change is written as one batch plus a log entry.
import {
  collection, deleteField, doc, increment, onSnapshot, serverTimestamp, setDoc, Timestamp, writeBatch,
} from 'firebase/firestore';
import type { DocumentData, Firestore, Unsubscribe } from 'firebase/firestore';
import { isValidYM } from '../domain/dates';
import type { Change, Op } from '../domain/ops';
import { DEFAULT_CUPBOARDS, lotId } from '../domain/types';
import type { Cupboards, Lot, Product, State } from '../domain/types';
import { Store } from './store';

/** Firestore rejects undefined; this also drops it from nested op records. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function toProduct(id: string, d: DocumentData): Product | null {
  if (typeof d.name !== 'string') return null;
  const p: Product = {
    id,
    name: d.name,
    nameLower: typeof d.nameLower === 'string' ? d.nameLower : d.name.toLowerCase(),
    target: typeof d.target === 'number' ? d.target : 0,
    cupboards: Array.isArray(d.cupboards) ? d.cupboards.filter((c: unknown) => typeof c === 'string') : [],
  };
  if (typeof d.lastAddCupboard === 'string') p.lastAddCupboard = d.lastAddCupboard;
  if (isValidYM(d.lastDate)) p.lastDate = d.lastDate;
  if (d.lastAdded instanceof Timestamp) p.lastAdded = d.lastAdded.toMillis();
  else if (typeof d.lastAdded === 'number') p.lastAdded = d.lastAdded;
  return p;
}

export function toLot(id: string, d: DocumentData): Lot | null {
  if (typeof d.pid !== 'string' || typeof d.cupboard !== 'string' || typeof d.date !== 'string') return null;
  const qty = typeof d.qty === 'number' ? d.qty : 0;
  if (qty <= 0) return null;
  return { id, pid: d.pid, cupboard: d.cupboard, date: d.date, qty };
}

export function toCupboards(d: DocumentData | undefined): Cupboards | null {
  if (!d || !Array.isArray(d.order) || !d.order.length) return null;
  const names: Record<string, string> = typeof d.names === 'object' && d.names ? { ...d.names } : {};
  const order = d.order.filter((id: unknown) => typeof id === 'string');
  for (const id of order) if (typeof names[id] !== 'string') names[id] = id;
  return { order, names };
}

/** Firestore field values for a product patch or full product. */
function productFields(data: Record<string, unknown>, forUpdate: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) {
      if (forUpdate) out[k] = deleteField();
    } else if (k === 'lastAdded' && typeof v === 'number') out[k] = Timestamp.fromMillis(v);
    else out[k] = v;
  }
  return out;
}

export class FirestoreStore extends Store {
  private unsubs: Unsubscribe[] = [];
  private products: Record<string, Product> | null = null;
  private lots: Record<string, Lot> | null = null;
  private cupboards: Cupboards | null = null;
  private seeding = false;

  constructor(
    private db: Firestore,
    readonly hid: string,
    private by: () => string | undefined = () => undefined,
  ) {
    super();
    const base = `households/${hid}`;
    const onErr = (e: unknown) => this.fail(e);
    this.unsubs.push(
      onSnapshot(collection(db, base, 'products'), (snap) => {
        const out: Record<string, Product> = {};
        for (const d of snap.docs) {
          const p = toProduct(d.id, d.data());
          if (p) out[p.id] = p;
        }
        this.products = out;
        this.sync();
      }, onErr),
      onSnapshot(collection(db, base, 'lots'), (snap) => {
        const out: Record<string, Lot> = {};
        for (const d of snap.docs) {
          const l = toLot(d.id, d.data());
          if (l) out[l.id] = l;
        }
        this.lots = out;
        this.sync();
      }, onErr),
      onSnapshot(doc(db, base, 'settings', 'cupboards'), (snap) => {
        const c = toCupboards(snap.data());
        if (c) this.cupboards = c;
        else {
          // A new household. Only seed once the server (not the offline cache) says it's missing.
          this.cupboards = DEFAULT_CUPBOARDS;
          if (!snap.metadata.fromCache && !this.seeding) {
            this.seeding = true;
            setDoc(snap.ref, DEFAULT_CUPBOARDS).catch(onErr);
          }
        }
        this.sync();
      }, onErr),
    );
  }

  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Firestore delivers each listener's snapshot in its own setTimeout(0), all queued in the same tick
   * for a given write. Coalesce them so the UI never sees new products with old lots (or vice versa).
   */
  private sync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (!this.products || !this.lots || !this.cupboards) return;
      this.state = { cupboards: this.cupboards, products: this.products, lots: this.lots };
      this.emit();
    }, 0);
  }

  close(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  newProductId(): string {
    return doc(collection(this.db, 'households', this.hid, 'products')).id;
  }

  protected persist(change: Change, inverse: Op[], base: State): string {
    const root = `households/${this.hid}`;
    const batch = writeBatch(this.db);

    // Net each lot's deltas so one doc gets one write, and decide create/increment/delete from local state.
    const lotDeltas = new Map<string, { pid: string; cupboard: string; date: string; delta: number }>();
    for (const op of change.ops) {
      if (op.t !== 'lot') continue;
      const id = lotId(op.pid, op.cupboard, op.date);
      const cur = lotDeltas.get(id) ?? { pid: op.pid, cupboard: op.cupboard, date: op.date, delta: 0 };
      cur.delta += op.delta;
      lotDeltas.set(id, cur);
    }
    for (const [id, l] of lotDeltas) {
      if (!l.delta) continue;
      const ref = doc(this.db, root, 'lots', id);
      const after = (base.lots[id]?.qty ?? 0) + l.delta;
      if (after <= 0) batch.delete(ref);
      else batch.set(ref, { pid: l.pid, cupboard: l.cupboard, date: l.date, qty: increment(l.delta) }, { merge: true });
    }

    for (const op of change.ops) {
      switch (op.t) {
        case 'productSet':
          batch.set(doc(this.db, root, 'products', op.id), productFields({ ...op.data }, false));
          break;
        case 'productPatch':
          batch.update(doc(this.db, root, 'products', op.id), productFields({ ...op.patch }, true));
          break;
        case 'productDelete':
          batch.delete(doc(this.db, root, 'products', op.id));
          break;
        case 'cupboards':
          batch.set(doc(this.db, root, 'settings', 'cupboards'), clean(op.value));
          break;
        case 'lot':
          break;
      }
    }

    const txn = doc(collection(this.db, root, 'transactions'));
    const by = this.by();
    batch.set(txn, {
      at: serverTimestamp(),
      ...(by ? { by } : {}),
      kind: change.kind,
      ...(change.pid ? { pid: change.pid } : {}),
      details: clean({ ...(change.details ?? {}), ops: change.ops, inverse }),
    });

    // Resolves when the server has it; offline, that's later. The UI has already updated.
    batch.commit().catch((e) => this.fail(e));
    return txn.id;
  }
}
