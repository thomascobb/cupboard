import { lotId } from '../../src/domain/types';
import type { Product, State } from '../../src/domain/types';

/** Build a state: cupboards by name (id = name), products by name, lots as [product, cupboard, date, qty]. */
export function mk(opts: {
  cupboards?: string[];
  products: { name: string; cupboards: string[]; target?: number; lastAdded?: number; lastDate?: string; lastAddCupboard?: string }[];
  lots?: [string, string, string, number][];
}): State {
  const cbs = opts.cupboards ?? ['Pantry', 'Utility', 'Box 1', 'Box 2'];
  const s: State = {
    cupboards: { order: [...cbs], names: Object.fromEntries(cbs.map((c) => [c, c])) },
    products: {},
    lots: {},
  };
  for (const p of opts.products) {
    const id = p.name;
    s.products[id] = {
      id,
      name: p.name,
      nameLower: p.name.toLowerCase(),
      target: p.target ?? 0,
      cupboards: [...p.cupboards],
      ...(p.lastAdded !== undefined ? { lastAdded: p.lastAdded } : {}),
      ...(p.lastDate ? { lastDate: p.lastDate } : {}),
      ...(p.lastAddCupboard ? { lastAddCupboard: p.lastAddCupboard } : {}),
    };
  }
  for (const [pid, cupboard, date, qty] of opts.lots ?? []) {
    const id = lotId(pid, cupboard, date);
    s.lots[id] = { id, pid, cupboard, date, qty };
  }
  return s;
}

export const P = (s: State, name: string): Product => s.products[name];

/** Lots as a compact sorted map { cupboard: { date: qty } } for one product. */
export function where(s: State, pid: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const l of Object.values(s.lots)) {
    if (l.pid !== pid) continue;
    (out[l.cupboard] ??= {})[l.date] = l.qty;
  }
  return out;
}
