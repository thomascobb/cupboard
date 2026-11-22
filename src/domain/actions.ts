// User intents → Changes (ops + log + toast). Pure: callers pass in ids and the clock.
import type { DateStr } from './dates';
import { findByName, lotsFor, planSwap, planned, stockIn, total } from './inventory';
import type { Change, Op, ProductPatch } from './ops';
import type { Cupboards, ProductData, State } from './types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Ops that append a cupboard to a product's list if it isn't already there ("the list is learned"). */
function learnCupboard(s: State, pid: string, cupboard: string): Op[] {
  const p = s.products[pid];
  if (!p || p.cupboards.includes(cupboard)) return [];
  return [{ t: 'productPatch', id: pid, patch: { cupboards: [...p.cupboards, cupboard] } }];
}

export interface AddArgs {
  /** Existing product, or null for a new one. */
  pid: string | null;
  /** Name for a new product. */
  name?: string;
  /** Target for a new product. */
  target?: number;
  /** Id to use if a new product is created. */
  newId: string;
  cupboard: string;
  date: DateStr;
  qty: number;
  now: number;
}

export function addStock(s: State, a: AddArgs): Change {
  const ops: Op[] = [];
  let p = a.pid ? s.products[a.pid] : undefined;
  if (!p && !a.pid) p = findByName(s, a.name ?? '');
  let pid: string;
  if (p) {
    pid = p.id;
    ops.push(...learnCupboard(s, pid, a.cupboard));
    ops.push({ t: 'productPatch', id: pid, patch: { lastDate: a.date, lastAdded: a.now, lastAddCupboard: a.cupboard } });
  } else {
    const name = (a.name ?? '').trim();
    if (!name) throw new Error('A new item needs a name');
    pid = a.newId;
    const data: ProductData = {
      name,
      nameLower: name.toLowerCase(),
      target: Math.max(0, a.target ?? 0),
      cupboards: [a.cupboard],
      lastAddCupboard: a.cupboard,
      lastDate: a.date,
      lastAdded: a.now,
    };
    ops.push({ t: 'productSet', id: pid, data });
  }
  ops.push({ t: 'lot', pid, cupboard: a.cupboard, date: a.date, delta: a.qty });
  const name = p?.name ?? (a.name ?? '').trim();
  return {
    kind: 'add',
    pid,
    ops,
    message: `Added ${a.qty} ${name}`,
    details: { cupboard: a.cupboard, date: a.date, qty: a.qty, created: !p },
  };
}

/** Take qty, oldest first, within the cupboard filter if one is set. */
export function useStock(s: State, pid: string, qty: number, cupboard: string | null): Change {
  const p = s.products[pid];
  const ops: Op[] = [];
  let need = qty;
  for (const l of lotsFor(s, pid, cupboard)) {
    if (need <= 0) break;
    const take = Math.min(need, l.qty);
    ops.push({ t: 'lot', pid, cupboard: l.cupboard, date: l.date, delta: -take });
    need -= take;
  }
  const took = qty - need;
  const left = total(s, pid) - took;
  return {
    kind: 'use',
    pid,
    ops,
    message: `Took ${took} ${p?.name ?? ''}. ${left} left.`,
    details: { qty: took, cupboard },
  };
}

/** Move a whole lot to another cupboard (merging into a lot there with the same date). */
export function moveLot(s: State, lotKey: string, to: string): Change | null {
  const l = s.lots[lotKey];
  if (!l || l.cupboard === to) return null;
  const ops: Op[] = [
    { t: 'lot', pid: l.pid, cupboard: l.cupboard, date: l.date, delta: -l.qty },
    { t: 'lot', pid: l.pid, cupboard: to, date: l.date, delta: l.qty },
    ...learnCupboard(s, l.pid, to),
  ];
  return {
    kind: 'move',
    pid: l.pid,
    ops,
    message: `Moved to ${s.cupboards.names[to] ?? to}`,
    details: { from: l.cupboard, to, date: l.date, qty: l.qty },
  };
}

/** The "−" on a lot in the detail sheet. */
export function removeOne(s: State, lotKey: string): Change | null {
  const l = s.lots[lotKey];
  if (!l) return null;
  return {
    kind: 'adjust',
    pid: l.pid,
    ops: [{ t: 'lot', pid: l.pid, cupboard: l.cupboard, date: l.date, delta: -1 }],
    message: 'Removed one',
    details: { cupboard: l.cupboard, date: l.date, delta: -1 },
  };
}

function swapOps(s: State, pid: string, f: number, r: number): { ops: Op[]; f: number; r: number } {
  const p = s.products[pid];
  const sp = p && planSwap(s, p, f, r);
  if (!sp) return { ops: [], f: 0, r: 0 };
  const ops: Op[] = [];
  for (const { c, take } of sp.toFront) {
    ops.push({ t: 'lot', pid, cupboard: c.cupboard, date: c.date, delta: -take });
    ops.push({ t: 'lot', pid, cupboard: sp.front, date: c.date, delta: take });
  }
  for (const { c, take } of sp.toBack) {
    ops.push({ t: 'lot', pid, cupboard: c.cupboard, date: c.date, delta: -take });
    ops.push({ t: 'lot', pid, cupboard: sp.back, date: c.date, delta: take });
  }
  return { ops, f: planned(sp.toFront), r: planned(sp.toBack) };
}

/** Bring f oldest from reserve to the front and send r newest from the front back, in one batch. */
export function swap(s: State, pid: string, f: number, r: number): Change {
  const res = swapOps(s, pid, f, r);
  return {
    kind: 'swap',
    pid,
    ops: res.ops,
    message: `Rotated ${s.products[pid]?.name ?? ''}: ${res.f} forward, ${res.r} back`,
    details: { f: res.f, r: res.r },
  };
}

export interface RotatePick {
  on: boolean;
  f: number;
  r: number;
}

/** The Home "Rotate stock" sheet: every ticked product, one batch. */
export function rotate(s: State, picks: Record<string, RotatePick>): Change {
  const ops: Op[] = [];
  const done: Record<string, { f: number; r: number }> = {};
  for (const [pid, pick] of Object.entries(picks)) {
    if (!pick.on || !(pick.f || pick.r) || !s.products[pid]) continue;
    // Each product's plan reads only its own lots, so planning from the original state is the same as sequential.
    const res = swapOps(s, pid, pick.f, pick.r);
    ops.push(...res.ops);
    done[pid] = { f: res.f, r: res.r };
  }
  const n = Object.keys(done).length;
  return { kind: 'rotate', ops, message: `Rotated ${plural(n, 'item')}`, details: { items: done } };
}

export function setTarget(s: State, pid: string, target: number): Change {
  return {
    kind: 'product',
    pid,
    ops: s.products[pid] ? [{ t: 'productPatch', id: pid, patch: { target: Math.max(0, Math.min(99, target)) } }] : [],
    details: { target },
  };
}

/** Reorder / remove cupboards in a product's list (the detail sheet's ↑ ↓ ×). */
export function setCupboardOrder(s: State, pid: string, order: string[]): Change {
  return {
    kind: 'product',
    pid,
    ops: s.products[pid] && order.length ? [{ t: 'productPatch', id: pid, patch: { cupboards: [...order] } }] : [],
    details: { cupboards: order },
  };
}

/** "Add a cupboard…" in the detail sheet: append as reserve. */
export function addProductCupboard(s: State, pid: string, cupboard: string): Change {
  return {
    kind: 'product',
    pid,
    ops: learnCupboard(s, pid, cupboard),
    message: `Added ${s.cupboards.names[cupboard] ?? cupboard} as reserve`,
  };
}

export function deleteProduct(s: State, pid: string): Change {
  const p = s.products[pid];
  const ops: Op[] = p ? [{ t: 'productDelete', id: pid }] : [];
  // Out of stock is required by the UI; clear any stray lots anyway so nothing is orphaned.
  for (const l of Object.values(s.lots)) {
    if (l.pid === pid) ops.push({ t: 'lot', pid, cupboard: l.cupboard, date: l.date, delta: -l.qty });
  }
  return { kind: 'product', pid, ops, message: `Deleted ${p?.name ?? ''}`, details: { name: p?.name } };
}

// ---------- household cupboards ----------

export function checkCupboardName(
  c: Cupboards,
  name: string,
  current: string | null,
): { ok: boolean; msg: string } {
  const n = name.trim();
  const curName = current ? c.names[current] : null;
  if (!n) return { ok: false, msg: 'Type a name' };
  if (n === curName) return { ok: false, msg: 'Rename' };
  const taken = c.order.some((id) => id !== current && (c.names[id] ?? '').toLowerCase() === n.toLowerCase());
  if (taken) return { ok: false, msg: 'That name is taken' };
  return { ok: true, msg: current ? `Rename to “${n}”` : `Add “${n}”` };
}

export function addCupboard(s: State, name: string, newId: string): Change | null {
  if (!checkCupboardName(s.cupboards, name, null).ok) return null;
  const n = name.trim();
  const value: Cupboards = { order: [...s.cupboards.order, newId], names: { ...s.cupboards.names, [newId]: n } };
  return { kind: 'cupboard', ops: [{ t: 'cupboards', value }], message: `Added ${n}`, details: { id: newId, name: n } };
}

/** Cupboards have stable ids, so a rename only touches the settings doc. */
export function renameCupboard(s: State, id: string, name: string): Change | null {
  if (!s.cupboards.order.includes(id) || !checkCupboardName(s.cupboards, name, id).ok) return null;
  const from = s.cupboards.names[id];
  const to = name.trim();
  const value: Cupboards = { order: [...s.cupboards.order], names: { ...s.cupboards.names, [id]: to } };
  return { kind: 'cupboard', ops: [{ t: 'cupboards', value }], message: `Renamed ${from} to ${to}`, details: { id, from, to } };
}

export function canDeleteCupboard(s: State, id: string): boolean {
  return s.cupboards.order.length > 1 && s.cupboards.order.includes(id) && stockIn(s, id) === 0;
}

/** Only when empty and not the last one. Products forget it; any left with no cupboards get the first. */
export function deleteCupboard(s: State, id: string): Change | null {
  if (!canDeleteCupboard(s, id)) return null;
  const order = s.cupboards.order.filter((c) => c !== id);
  const names = { ...s.cupboards.names };
  const name = names[id];
  delete names[id];
  const ops: Op[] = [{ t: 'cupboards', value: { order, names } }];
  for (const p of Object.values(s.products)) {
    const uses = p.cupboards.includes(id);
    const last = p.lastAddCupboard === id;
    if (!uses && !last) continue;
    const patch: ProductPatch = {};
    if (uses) {
      const rest = p.cupboards.filter((c) => c !== id);
      patch.cupboards = rest.length ? rest : [order[0]];
    }
    if (last) patch.lastAddCupboard = null;
    ops.push({ t: 'productPatch', id: p.id, patch });
  }
  return { kind: 'cupboard', ops, message: `Deleted ${name}`, details: { id, name } };
}
