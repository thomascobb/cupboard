// Every change is a list of primitive ops. Stores apply them atomically (one Firestore batch),
// and undo applies the inverse ops, computed from the state just before the change.
// Lot ops are deltas, so undoing never clobbers what another phone did in the meantime.
import type { DateStr } from './dates';
import { lotId } from './types';
import type { Cupboards, ProductData, State } from './types';

export type ProductPatch = { [K in keyof ProductData]?: ProductData[K] | null }; // null = remove the field

export type Op =
  /** Change a lot's quantity; the lot is created if missing and deleted when it reaches 0. */
  | { t: 'lot'; pid: string; cupboard: string; date: DateStr; delta: number }
  /** Create or replace a product. */
  | { t: 'productSet'; id: string; data: ProductData }
  /** Change some fields of an existing product. */
  | { t: 'productPatch'; id: string; patch: ProductPatch }
  | { t: 'productDelete'; id: string }
  | { t: 'cupboards'; value: Cupboards };

export type Kind = 'add' | 'use' | 'move' | 'swap' | 'rotate' | 'adjust' | 'product' | 'cupboard' | 'undo';

/** A change ready to commit: the ops, plus what goes in the transaction log and the toast. */
export interface Change {
  kind: Kind;
  pid?: string;
  ops: Op[];
  /** Toast text; no toast (and no undo offered) when absent. */
  message?: string;
  details?: Record<string, unknown>;
}

/** Quantity a lot will have after a delta; the store deletes the doc at 0 or below. */
export const lotQtyAfter = (s: State, op: Extract<Op, { t: 'lot' }>): number =>
  (s.lots[lotId(op.pid, op.cupboard, op.date)]?.qty ?? 0) + op.delta;

function stripNulls(data: object): ProductData {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined) out[k] = v;
  return out as unknown as ProductData;
}

function cloneProductData(p: ProductData): ProductData {
  const { id: _id, ...rest } = p as ProductData & { id?: string };
  return stripNulls({ ...rest, cupboards: [...p.cupboards] });
}

/** Apply ops to a state, returning a new state. Used by MemoryStore and for computing inverses. */
export function applyOps(s: State, ops: readonly Op[]): State {
  const next: State = {
    cupboards: s.cupboards,
    products: { ...s.products },
    lots: { ...s.lots },
  };
  for (const op of ops) {
    switch (op.t) {
      case 'lot': {
        const id = lotId(op.pid, op.cupboard, op.date);
        const qty = lotQtyAfter(next, op);
        if (qty <= 0) delete next.lots[id];
        else next.lots[id] = { id, pid: op.pid, cupboard: op.cupboard, date: op.date, qty };
        break;
      }
      case 'productSet':
        next.products[op.id] = { ...cloneProductData(op.data), id: op.id };
        break;
      case 'productPatch': {
        const cur = next.products[op.id];
        if (!cur) break;
        const merged = { ...cur, ...op.patch } as ProductData & { id: string };
        next.products[op.id] = { ...stripNulls(merged), id: op.id } as typeof cur;
        break;
      }
      case 'productDelete':
        delete next.products[op.id];
        break;
      case 'cupboards':
        next.cupboards = { order: [...op.value.order], names: { ...op.value.names } };
        break;
    }
  }
  return next;
}

/** Ops that undo `ops`, given the state they were applied to. */
export function invert(s: State, ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  let cur = s;
  for (const op of ops) {
    switch (op.t) {
      case 'lot': {
        // Only undo what was actually removed if the lot couldn't go below 0.
        const had = cur.lots[lotId(op.pid, op.cupboard, op.date)]?.qty ?? 0;
        const applied = op.delta < 0 ? -Math.min(had, -op.delta) : op.delta;
        if (applied) out.push({ ...op, delta: -applied });
        break;
      }
      case 'productSet': {
        const prev = cur.products[op.id];
        out.push(prev ? { t: 'productSet', id: op.id, data: cloneProductData(prev) } : { t: 'productDelete', id: op.id });
        break;
      }
      case 'productPatch': {
        const prev = cur.products[op.id];
        if (!prev) break;
        const patch: ProductPatch = {};
        for (const k of Object.keys(op.patch) as (keyof ProductData)[]) {
          const v = prev[k];
          (patch as Record<string, unknown>)[k] = v === undefined ? null : Array.isArray(v) ? [...v] : v;
        }
        out.push({ t: 'productPatch', id: op.id, patch });
        break;
      }
      case 'productDelete': {
        const prev = cur.products[op.id];
        if (prev) out.push({ t: 'productSet', id: op.id, data: cloneProductData(prev) });
        break;
      }
      case 'cupboards':
        out.push({ t: 'cupboards', value: { order: [...cur.cupboards.order], names: { ...cur.cupboards.names } } });
        break;
    }
    cur = applyOps(cur, [op]);
  }
  return out.reverse();
}
