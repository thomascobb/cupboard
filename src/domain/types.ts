import type { DateStr } from './dates';

/** Household cupboard list: stable ids in display order, and their names. */
export interface Cupboards {
  order: string[];
  names: Record<string, string>;
}

export interface ProductData {
  name: string;
  nameLower: string;
  /** "Keep at least"; 0 = not on the shop list. */
  target: number;
  /** Ordered cupboard ids: [front, ...reserve]. */
  cupboards: string[];
  lastAddCupboard?: string;
  lastDate?: DateStr;
  /** Epoch millis of the last Add (Firestore stores a Timestamp). */
  lastAdded?: number;
}

export interface Product extends ProductData {
  id: string;
}

export interface Lot {
  id: string;
  pid: string;
  cupboard: string;
  date: DateStr;
  qty: number;
}

export interface State {
  cupboards: Cupboards;
  products: Record<string, Product>;
  lots: Record<string, Lot>;
}

/** Deterministic, so concurrent adds of the same thing from two phones land on one doc. */
export const lotId = (pid: string, cupboard: string, date: DateStr): string => `${pid}_${cupboard}_${date}`;

export const DEFAULT_CUPBOARDS: Cupboards = { order: ['cupboard'], names: { cupboard: 'Cupboard' } };

export const emptyState = (cupboards: Cupboards = DEFAULT_CUPBOARDS): State => ({
  cupboards: { order: [...cupboards.order], names: { ...cupboards.names } },
  products: {},
  lots: {},
});
