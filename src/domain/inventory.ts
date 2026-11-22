// Read-only queries over the household state. Ported from the prototype.
import type { DateStr } from './dates';
import type { Lot, Product, State } from './types';

export const cmp = <T>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const sumQty = (lots: readonly { qty: number }[]): number => lots.reduce((s, l) => s + l.qty, 0);
const byName = (a: Product, b: Product) => a.name.localeCompare(b.name);

export const front = (p: Product): string | undefined => p.cupboards[0];

/** Position of a cupboard in the product's list; unknown cupboards sort last. */
export function rank(p: Product, cupboard: string): number {
  const i = p.cupboards.indexOf(cupboard);
  return i < 0 ? 99 : i;
}

/** Oldest first; ties go to the product's front-most cupboard. */
export const byAge = (p: Product) => (a: Lot, b: Lot): number =>
  cmp(a.date, b.date) || rank(p, a.cupboard) - rank(p, b.cupboard);

export function lotsFor(s: State, pid: string, cupboard?: string | null): Lot[] {
  const p = s.products[pid];
  if (!p) return [];
  return Object.values(s.lots)
    .filter((l) => l.pid === pid && l.qty > 0 && (!cupboard || l.cupboard === cupboard))
    .sort(byAge(p));
}

export const total = (s: State, pid: string, cupboard?: string | null): number => sumQty(lotsFor(s, pid, cupboard));

/** Lots outside the front cupboard, oldest first. */
export function reserveLots(s: State, p: Product): Lot[] {
  const f = front(p);
  return lotsFor(s, p.id).filter((l) => l.cupboard !== f);
}

export interface Step<T extends { qty: number } = Lot> {
  c: T;
  take: number;
}

/** Take n from the candidates in order. */
export function plan<T extends { qty: number }>(cands: readonly T[], n: number): Step<T>[] {
  const out: Step<T>[] = [];
  let need = n;
  for (const c of cands) {
    if (need <= 0) break;
    const take = Math.min(need, c.qty);
    if (take > 0) out.push({ c, take });
    need -= take;
  }
  return out;
}

export const planned = (steps: readonly Step<{ qty: number }>[]): number => steps.reduce((s, x) => s + x.take, 0);

/** Group a plan by date and cupboard for previews: [{date, cupboard, n}]. */
export function describeSteps(steps: readonly Step[]): { date: DateStr; cupboard: string; n: number }[] {
  const groups = new Map<string, { date: DateStr; cupboard: string; n: number }>();
  for (const { c, take } of steps) {
    const k = `${c.date}|${c.cupboard}`;
    const g = groups.get(k) ?? { date: c.date, cupboard: c.cupboard, n: 0 };
    g.n += take;
    groups.set(k, g);
  }
  return [...groups.values()];
}

/** Case-insensitive; every whitespace-separated term must appear in the name. */
export function matches(name: string, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const n = name.toLowerCase();
  return t.split(/\s+/).every((w) => n.includes(w));
}

// ---------- rotation ----------

export interface SwapNeeds {
  /** Suggested number of oldest reserve to bring to the front. */
  f: number;
  /** Suggested number of newest front to send back. */
  r: number;
  rTotal: number;
  fTotal: number;
}

/**
 * How many are in the wrong place: reserve stock older than the newest in front (should come forward),
 * and front stock newer than the oldest in reserve (should go back). If the front is empty, refill it.
 */
export function swapNeeds(s: State, p: Product): SwapNeeds {
  const reserve = reserveLots(s, p);
  const fr = front(p) ? lotsFor(s, p.id, front(p)) : [];
  const rTotal = sumQty(reserve);
  const fTotal = sumQty(fr);
  if (!rTotal) return { f: 0, r: 0, rTotal, fTotal };
  if (!fr.length) return { f: Math.min(rTotal, Math.max(1, p.target)), r: 0, rTotal, fTotal };
  const newestFront = fr[fr.length - 1].date;
  const oldestReserve = reserve[0].date;
  return {
    f: sumQty(reserve.filter((l) => l.date < newestFront)),
    r: sumQty(fr.filter((l) => l.date > oldestReserve)),
    rTotal,
    fTotal,
  };
}

/** Newest-from-front goes to the reserve cupboard holding the oldest stock (usually the one being emptied). */
export function backTarget(s: State, p: Product): string | undefined {
  const reserve = reserveLots(s, p);
  return reserve.length ? reserve[0].cupboard : p.cupboards[1];
}

export interface SwapPlan {
  toFront: Step[];
  toBack: Step[];
  front: string;
  back: string;
}

/** Both halves planned from the state before anything moves. */
export function planSwap(s: State, p: Product, f: number, r: number): SwapPlan | null {
  const fc = front(p);
  const back = backTarget(s, p);
  if (!fc) return null;
  const toFront = plan(reserveLots(s, p), f);
  const toBack = back && back !== fc ? plan([...lotsFor(s, p.id, fc)].reverse(), r) : [];
  return { toFront, toBack, front: fc, back: back ?? fc };
}

export interface RotationNeed {
  p: Product;
  f: number;
  r: number;
}

export function rotationNeeds(s: State): RotationNeed[] {
  const out: RotationNeed[] = [];
  for (const p of Object.values(s.products)) {
    if (p.cupboards.length < 2) continue;
    const n = swapNeeds(s, p);
    if (n.f > 0 || n.r > 0) out.push({ p, f: n.f, r: n.r });
  }
  return out.sort((a, b) => byName(a.p, b.p));
}

// ---------- tab lists ----------

export interface StockItem {
  p: Product;
  lots: Lot[];
  qty: number;
}

function stockItems(s: State, q: string, cupboard: string | null): StockItem[] {
  return Object.values(s.products)
    .filter((p) => matches(p.name, q))
    .map((p) => {
      const lots = lotsFor(s, p.id, cupboard);
      return { p, lots, qty: sumQty(lots) };
    })
    .filter((x) => x.lots.length > 0);
}

/** Home: in-stock products, alphabetical. */
export function homeItems(s: State, q: string, cupboard: string | null): StockItem[] {
  return stockItems(s, q, cupboard).sort((a, b) => byName(a.p, b.p));
}

/** Use: in-stock products, earliest date first. */
export function useItems(s: State, q: string, cupboard: string | null): StockItem[] {
  return stockItems(s, q, cupboard).sort((a, b) => cmp(a.lots[0].date, b.lots[0].date) || byName(a.p, b.p));
}

/** Cupboards a product's stock is in, front first. */
export function cupboardsWithStock(p: Product, lots: readonly Lot[]): string[] {
  return [...new Set(lots.map((l) => l.cupboard))].sort((a, b) => rank(p, a) - rank(p, b));
}

export interface ShopItem {
  p: Product;
  have: number;
  buy: number;
}

/** Below target (counting reserve), biggest shortfall first. Cupboard filter applies to the front cupboard. */
export function shopItems(s: State, q: string, cupboard: string | null): ShopItem[] {
  return Object.values(s.products)
    .filter((p) => matches(p.name, q) && (!cupboard || front(p) === cupboard))
    .map((p) => {
      const have = total(s, p.id);
      return { p, have, buy: p.target - have };
    })
    .filter((x) => x.buy > 0)
    .sort((a, b) => b.buy - a.buy || byName(a.p, b.p));
}

/** Add: matching products, most recently added first. */
export function addItems(s: State, q: string): { items: Product[]; exact: boolean } {
  const t = q.trim().toLowerCase();
  const items = Object.values(s.products).filter((p) => matches(p.name, q));
  const exact = items.some((p) => p.nameLower === t);
  items.sort((a, b) => (b.lastAdded ?? 0) - (a.lastAdded ?? 0) || byName(a, b));
  return { items, exact };
}

export function findByName(s: State, name: string): Product | undefined {
  const n = name.trim().toLowerCase();
  return Object.values(s.products).find((p) => p.nameLower === n);
}

// ---------- Add defaults ----------

/**
 * Product's last Add cupboard → selected filter → household's last Add cupboard →
 * back of the product's list → first cupboard.
 */
export function defaultAddCupboard(
  s: State,
  p: Product | null,
  filter: string | null,
  householdLast: string | null,
): string {
  const ok = (c: string | null | undefined) => (c && s.cupboards.order.includes(c) ? c : null);
  return (
    ok(p?.lastAddCupboard) ??
    ok(filter) ??
    ok(householdLast) ??
    ok(p ? p.cupboards[p.cupboards.length - 1] : null) ??
    s.cupboards.order[0]
  );
}

/** Product's last date → last date entered this session → next year, no month. Past months are dropped. */
export function defaultAddDate(
  p: Product | null,
  sessionLast: DateStr | null,
  today: DateStr,
): { y: number; m: number | null } {
  const d = p?.lastDate ?? sessionLast;
  const [ty, tm] = today.split('-').map(Number);
  if (!d) return { y: ty + 1, m: null };
  const [y, m] = d.split('-').map(Number);
  if (y < ty) return { y: ty + 1, m: null };
  if (y === ty && m < tm) return { y, m: null };
  return { y, m };
}

/** For the Add sheet: the product's cupboards first, then the rest in household order. */
export function addCupboardOrder(s: State, p: Product | null): string[] {
  const all = s.cupboards.order;
  if (!p) return [...all];
  const mine = p.cupboards.filter((c) => all.includes(c));
  return [...mine, ...all.filter((c) => !mine.includes(c))];
}

export const stockIn = (s: State, cupboard: string): number =>
  sumQty(Object.values(s.lots).filter((l) => l.cupboard === cupboard && l.qty > 0));
