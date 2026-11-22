// The UI talks to a Store, never to Firestore. A Store holds the household state, applies Changes
// optimistically (so the UI updates synchronously, as in the prototype) and persists them.
import * as A from '../domain/actions';
import type { RotatePick } from '../domain/actions';
import type { DateStr } from '../domain/dates';
import { applyOps, invert } from '../domain/ops';
import type { Change, Op } from '../domain/ops';
import type { State } from '../domain/types';

/** What the toast's Undo button needs. */
export interface UndoToken {
  ops: Op[];
  txnId: string;
  pid?: string;
  /** Toast text for the change; changes without one get no toast. */
  message?: string;
}

export type Listener = (s: State) => void;

const rand = (n: number) => {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
};

export abstract class Store {
  protected state: State | null = null;
  private listeners = new Set<Listener>();
  private errorListeners = new Set<(e: unknown) => void>();

  /** Persist a change. `inverse` is stored in the log for undo. Returns the transaction id. */
  protected abstract persist(change: Change, inverse: Op[], base: State): string;
  abstract newProductId(): string;
  newCupboardId(): string {
    return rand(8);
  }
  /** Stop listening to the backend. */
  close(): void {}

  get current(): State | null {
    return this.state;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.state) cb(this.state);
    return () => this.listeners.delete(cb);
  }

  onError(cb: (e: unknown) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  protected emit(): void {
    if (this.state) for (const cb of this.listeners) cb(this.state);
  }

  protected fail(e: unknown): void {
    console.error(e);
    for (const cb of this.errorListeners) cb(e);
  }

  /** Apply locally, persist, and return an undo token (null if nothing changed). */
  commit(change: Change | null): UndoToken | null {
    if (!change || !change.ops.length || !this.state) return null;
    const base = this.state;
    const inverse = invert(base, change.ops);
    this.state = applyOps(base, change.ops);
    let txnId = '';
    try {
      txnId = this.persist(change, inverse, base);
    } catch (e) {
      this.state = base;
      this.fail(e);
      this.emit();
      return null;
    }
    this.emit();
    return { ops: inverse, txnId, pid: change.pid, message: change.message };
  }

  undo(token: UndoToken): void {
    this.commit({ kind: 'undo', pid: token.pid, ops: token.ops, details: { undoes: token.txnId } });
  }

  private need(): State {
    if (!this.state) throw new Error('Not loaded yet');
    return this.state;
  }

  // ---------- actions (see src/domain/actions.ts) ----------

  addStock(a: { pid: string | null; name?: string; target?: number; cupboard: string; date: DateStr; qty: number }) {
    return this.commit(A.addStock(this.need(), { ...a, newId: this.newProductId(), now: Date.now() }));
  }
  useStock(pid: string, qty: number, cupboard: string | null) {
    return this.commit(A.useStock(this.need(), pid, qty, cupboard));
  }
  moveLot(lotKey: string, to: string) {
    return this.commit(A.moveLot(this.need(), lotKey, to));
  }
  removeOne(lotKey: string) {
    return this.commit(A.removeOne(this.need(), lotKey));
  }
  swap(pid: string, f: number, r: number) {
    return this.commit(A.swap(this.need(), pid, f, r));
  }
  rotate(picks: Record<string, RotatePick>) {
    return this.commit(A.rotate(this.need(), picks));
  }
  setTarget(pid: string, target: number) {
    return this.commit(A.setTarget(this.need(), pid, target));
  }
  setCupboardOrder(pid: string, order: string[]) {
    return this.commit(A.setCupboardOrder(this.need(), pid, order));
  }
  addProductCupboard(pid: string, cupboard: string) {
    return this.commit(A.addProductCupboard(this.need(), pid, cupboard));
  }
  deleteProduct(pid: string) {
    return this.commit(A.deleteProduct(this.need(), pid));
  }
  addCupboard(name: string) {
    return this.commit(A.addCupboard(this.need(), name, this.newCupboardId()));
  }
  renameCupboard(id: string, name: string) {
    return this.commit(A.renameCupboard(this.need(), id, name));
  }
  deleteCupboard(id: string) {
    return this.commit(A.deleteCupboard(this.need(), id));
  }
}
