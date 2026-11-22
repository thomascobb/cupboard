import { describe, expect, it } from 'vitest';
import {
  addCupboardOrder, addItems, backTarget, byAge, clamp, cupboardsWithStock, defaultAddCupboard, defaultAddDate,
  describeSteps, findByName, homeItems, lotsFor, matches, plan, planSwap, rank, reserveLots, rotationNeeds,
  shopItems, stockIn, swapNeeds, total, useItems,
} from '../../src/domain/inventory';
import { mk, P } from './helpers';

const toms = () =>
  mk({
    products: [{ name: 'Toms', cupboards: ['Pantry', 'Box 1'], target: 4 }],
    lots: [
      ['Toms', 'Pantry', '2029-01', 8],
      ['Toms', 'Box 1', '2027-11', 3],
    ],
  });

describe('ordering', () => {
  it('rank puts unknown cupboards last', () => {
    const s = toms();
    expect(rank(P(s, 'Toms'), 'Pantry')).toBe(0);
    expect(rank(P(s, 'Toms'), 'Box 1')).toBe(1);
    expect(rank(P(s, 'Toms'), 'Box 2')).toBe(99);
  });

  it('byAge: date ascending, ties by cupboard order (front first)', () => {
    const s = mk({
      products: [{ name: 'X', cupboards: ['Box 1', 'Pantry'] }],
      lots: [
        ['X', 'Pantry', '2027-05', 1],
        ['X', 'Box 1', '2027-05', 1],
        ['X', 'Box 2', '2027-05', 1],
        ['X', 'Pantry', '2027-01', 1],
      ],
    });
    const sorted = Object.values(s.lots).sort(byAge(P(s, 'X')));
    expect(sorted.map((l) => `${l.date} ${l.cupboard}`)).toEqual([
      '2027-01 Pantry', '2027-05 Box 1', '2027-05 Pantry', '2027-05 Box 2',
    ]);
  });

  it('lotsFor filters by product, cupboard and qty > 0', () => {
    const s = toms();
    s.lots.zero = { id: 'zero', pid: 'Toms', cupboard: 'Pantry', date: '2026-01', qty: 0 };
    expect(lotsFor(s, 'Toms').map((l) => l.date)).toEqual(['2027-11', '2029-01']);
    expect(lotsFor(s, 'Toms', 'Pantry').map((l) => l.qty)).toEqual([8]);
    expect(lotsFor(s, 'nope')).toEqual([]);
    expect(total(s, 'Toms')).toBe(11);
    expect(total(s, 'Toms', 'Box 1')).toBe(3);
  });

  it('reserveLots excludes the front cupboard', () => {
    const s = toms();
    expect(reserveLots(s, P(s, 'Toms')).map((l) => l.cupboard)).toEqual(['Box 1']);
  });

  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('plan', () => {
  it('takes n in order, partially from the last', () => {
    const steps = plan([{ qty: 2 }, { qty: 3 }, { qty: 4 }], 4);
    expect(steps.map((s) => s.take)).toEqual([2, 2]);
  });
  it('stops when candidates run out', () => {
    expect(plan([{ qty: 1 }], 5).map((s) => s.take)).toEqual([1]);
    expect(plan([{ qty: 1 }], 0)).toEqual([]);
  });
  it('describeSteps groups by date and cupboard', () => {
    const s = toms();
    const steps = plan(lotsFor(s, 'Toms'), 5);
    expect(describeSteps(steps)).toEqual([
      { date: '2027-11', cupboard: 'Box 1', n: 3 },
      { date: '2029-01', cupboard: 'Pantry', n: 2 },
    ]);
  });
});

describe('search', () => {
  it('every term must appear, case-insensitive', () => {
    expect(matches('Chopped tomatoes 400g', '')).toBe(true);
    expect(matches('Chopped tomatoes 400g', '  ')).toBe(true);
    expect(matches('Chopped tomatoes 400g', 'TOM')).toBe(true);
    expect(matches('Chopped tomatoes 400g', 'tom 400')).toBe(true);
    expect(matches('Chopped tomatoes 400g', 'tom  chop')).toBe(true);
    expect(matches('Chopped tomatoes 400g', 'tom 500')).toBe(false);
  });
  it('findByName is case-insensitive and trims', () => {
    const s = toms();
    expect(findByName(s, '  toms ')?.id).toBe('Toms');
    expect(findByName(s, 'tom')).toBeUndefined();
  });
});

describe('swapNeeds (rotation)', () => {
  it('SPEC scenario: Pantry 8 × Jan 2029, Box 1 3 × Nov 2027 ⇒ f=3, r=8', () => {
    const s = toms();
    expect(swapNeeds(s, P(s, 'Toms'))).toEqual({ f: 3, r: 8, rTotal: 3, fTotal: 8 });
    expect(backTarget(s, P(s, 'Toms'))).toBe('Box 1');
  });

  it('nothing to do when the front already has the oldest', () => {
    const s = mk({
      products: [{ name: 'X', cupboards: ['Pantry', 'Box 1'] }],
      lots: [
        ['X', 'Pantry', '2027-01', 2],
        ['X', 'Box 1', '2028-01', 5],
      ],
    });
    expect(swapNeeds(s, P(s, 'X'))).toMatchObject({ f: 0, r: 0 });
    expect(rotationNeeds(s)).toEqual([]);
  });

  it('equal dates are not out of order', () => {
    const s = mk({
      products: [{ name: 'X', cupboards: ['Pantry', 'Box 1'] }],
      lots: [
        ['X', 'Pantry', '2027-01', 2],
        ['X', 'Box 1', '2027-01', 5],
      ],
    });
    expect(swapNeeds(s, P(s, 'X'))).toMatchObject({ f: 0, r: 0 });
  });

  it('counts only the out-of-order parts', () => {
    const s = mk({
      products: [{ name: 'X', cupboards: ['Pantry', 'Box 1', 'Box 2'] }],
      lots: [
        ['X', 'Pantry', '2027-01', 1],
        ['X', 'Pantry', '2028-06', 2],
        ['X', 'Box 1', '2027-06', 4],
        ['X', 'Box 2', '2029-01', 3],
      ],
    });
    // Reserve older than newest front (2028-06): Box 1 2027-06 ×4. Front newer than oldest reserve (2027-06): 2028-06 ×2.
    expect(swapNeeds(s, P(s, 'X'))).toEqual({ f: 4, r: 2, rTotal: 7, fTotal: 3 });
  });

  it('empty front: refill with min(reserve, max(1, target)), nothing back', () => {
    const s = mk({
      products: [
        { name: 'A', cupboards: ['Pantry', 'Box 1'], target: 2 },
        { name: 'B', cupboards: ['Pantry', 'Box 1'], target: 0 },
        { name: 'C', cupboards: ['Pantry', 'Box 1'], target: 9 },
      ],
      lots: [
        ['A', 'Box 1', '2028-01', 5],
        ['B', 'Box 1', '2028-01', 5],
        ['C', 'Box 1', '2028-01', 5],
      ],
    });
    expect(swapNeeds(s, P(s, 'A'))).toMatchObject({ f: 2, r: 0 });
    expect(swapNeeds(s, P(s, 'B'))).toMatchObject({ f: 1, r: 0 });
    expect(swapNeeds(s, P(s, 'C'))).toMatchObject({ f: 5, r: 0 });
  });

  it('no reserve: nothing to do', () => {
    const s = mk({ products: [{ name: 'X', cupboards: ['Pantry', 'Box 1'] }], lots: [['X', 'Pantry', '2028-01', 5]] });
    expect(swapNeeds(s, P(s, 'X'))).toEqual({ f: 0, r: 0, rTotal: 0, fTotal: 5 });
  });

  it('rotationNeeds: only products with ≥2 cupboards, sorted by name', () => {
    const s = mk({
      products: [
        { name: 'Zed', cupboards: ['Pantry', 'Box 1'] },
        { name: 'Abe', cupboards: ['Pantry', 'Box 1'] },
        // Only one cupboard in its list, but has stock elsewhere: not offered.
        { name: 'Solo', cupboards: ['Pantry'] },
      ],
      lots: [
        ['Zed', 'Pantry', '2029-01', 1], ['Zed', 'Box 1', '2027-01', 1],
        ['Abe', 'Box 1', '2027-01', 1],
        ['Solo', 'Pantry', '2029-01', 1], ['Solo', 'Box 1', '2027-01', 1],
      ],
    });
    expect(rotationNeeds(s).map((n) => [n.p.name, n.f, n.r])).toEqual([['Abe', 1, 0], ['Zed', 1, 1]]);
  });

  it('backTarget: the reserve cupboard with the oldest stock, else the second cupboard', () => {
    const s = mk({
      products: [{ name: 'X', cupboards: ['Pantry', 'Box 1', 'Box 2'] }],
      lots: [['X', 'Box 2', '2027-01', 1], ['X', 'Box 1', '2028-01', 1]],
    });
    expect(backTarget(s, P(s, 'X'))).toBe('Box 2');
    const t = mk({ products: [{ name: 'Y', cupboards: ['Pantry', 'Box 1'] }], lots: [['Y', 'Pantry', '2027-01', 1]] });
    expect(backTarget(t, P(t, 'Y'))).toBe('Box 1');
  });

  it('planSwap plans both halves from the state before moving', () => {
    const s = toms();
    const sp = planSwap(s, P(s, 'Toms'), 3, 6)!;
    expect(sp.front).toBe('Pantry');
    expect(sp.back).toBe('Box 1');
    expect(sp.toFront.map((x) => [x.c.cupboard, x.c.date, x.take])).toEqual([['Box 1', '2027-11', 3]]);
    expect(sp.toBack.map((x) => [x.c.cupboard, x.c.date, x.take])).toEqual([['Pantry', '2029-01', 6]]);
  });
});

describe('tab lists', () => {
  const s = mk({
    products: [
      { name: 'Beans', cupboards: ['Pantry', 'Box 1'], target: 3, lastAdded: 10 },
      { name: 'Apples', cupboards: ['Utility'], target: 2, lastAdded: 30 },
      { name: 'Corn', cupboards: ['Box 1'], target: 1, lastAdded: 20 },
      { name: 'Dates', cupboards: ['Pantry'], target: 0 },
    ],
    lots: [
      ['Beans', 'Pantry', '2028-01', 1],
      ['Beans', 'Box 1', '2027-03', 1],
      ['Apples', 'Utility', '2027-06', 5],
    ],
  });

  it('home: in stock, alphabetical, filter applies to lots', () => {
    expect(homeItems(s, '', null).map((x) => [x.p.name, x.qty, x.lots[0].date])).toEqual([
      ['Apples', 5, '2027-06'], ['Beans', 2, '2027-03'],
    ]);
    expect(homeItems(s, '', 'Pantry').map((x) => [x.p.name, x.qty])).toEqual([['Beans', 1]]);
    expect(homeItems(s, 'app', null).map((x) => x.p.name)).toEqual(['Apples']);
  });

  it('use: earliest date first', () => {
    expect(useItems(s, '', null).map((x) => x.p.name)).toEqual(['Beans', 'Apples']);
    expect(useItems(s, '', 'Pantry').map((x) => x.lots[0].cupboard)).toEqual(['Pantry']);
  });

  it('cupboardsWithStock: front first', () => {
    expect(cupboardsWithStock(P(s, 'Beans'), lotsFor(s, 'Beans'))).toEqual(['Pantry', 'Box 1']);
  });

  it('shop: below target counting reserve, by shortfall then name; filter by front cupboard', () => {
    expect(shopItems(s, '', null).map((x) => [x.p.name, x.have, x.buy])).toEqual([['Beans', 2, 1], ['Corn', 0, 1]]);
    expect(shopItems(s, '', 'Box 1').map((x) => x.p.name)).toEqual(['Corn']);
    expect(shopItems(s, '', 'Pantry').map((x) => x.p.name)).toEqual(['Beans']);
    expect(shopItems(s, 'corn', null).map((x) => x.p.name)).toEqual(['Corn']);
  });

  it('add: by recency, exact-match flag', () => {
    expect(addItems(s, '').items.map((p) => p.name)).toEqual(['Apples', 'Corn', 'Beans', 'Dates']);
    expect(addItems(s, 'beans').exact).toBe(true);
    expect(addItems(s, 'bean').exact).toBe(false);
    expect(addItems(s, 'bean').items.map((p) => p.name)).toEqual(['Beans']);
  });

  it('stockIn sums a cupboard', () => {
    expect(stockIn(s, 'Pantry')).toBe(1);
    expect(stockIn(s, 'Box 2')).toBe(0);
  });
});

describe('Add defaults', () => {
  const s = mk({
    products: [
      { name: 'A', cupboards: ['Pantry', 'Box 1'], lastAddCupboard: 'Utility', lastDate: '2027-04' },
      { name: 'B', cupboards: ['Pantry', 'Box 2'] },
      { name: 'Gone', cupboards: ['Pantry'], lastAddCupboard: 'Deleted' },
    ],
  });

  it('cupboard: product last → filter → household last → back of list → first', () => {
    expect(defaultAddCupboard(s, P(s, 'A'), 'Box 2', 'Box 2')).toBe('Utility');
    expect(defaultAddCupboard(s, P(s, 'B'), 'Utility', 'Box 1')).toBe('Utility');
    expect(defaultAddCupboard(s, P(s, 'B'), null, 'Box 1')).toBe('Box 1');
    expect(defaultAddCupboard(s, P(s, 'B'), null, null)).toBe('Box 2');
    expect(defaultAddCupboard(s, null, null, null)).toBe('Pantry');
    // Stale ids are skipped.
    expect(defaultAddCupboard(s, P(s, 'Gone'), 'Deleted', 'Deleted')).toBe('Pantry');
  });

  it('date: product last → session last → next year with no month; past months dropped', () => {
    const today = '2026-11';
    expect(defaultAddDate(P(s, 'A'), '2028-02', today)).toEqual({ y: 2027, m: 4 });
    expect(defaultAddDate(P(s, 'B'), '2028-02', today)).toEqual({ y: 2028, m: 2 });
    expect(defaultAddDate(null, null, today)).toEqual({ y: 2027, m: null });
    expect(defaultAddDate(null, '2026-12', today)).toEqual({ y: 2026, m: 12 });
    expect(defaultAddDate(null, '2026-11', today)).toEqual({ y: 2026, m: 11 });
    expect(defaultAddDate(null, '2026-03', today)).toEqual({ y: 2026, m: null });
    // A year that's no longer offered as a chip falls back to next year.
    expect(defaultAddDate(null, '2024-05', today)).toEqual({ y: 2027, m: null });
  });

  it('cupboard order for the Add sheet: product cupboards first', () => {
    expect(addCupboardOrder(s, P(s, 'B'))).toEqual(['Pantry', 'Box 2', 'Utility', 'Box 1']);
    expect(addCupboardOrder(s, null)).toEqual(['Pantry', 'Utility', 'Box 1', 'Box 2']);
    // Cupboards no longer in the household are not offered.
    expect(addCupboardOrder(s, P(s, 'Gone'))).toEqual(['Pantry', 'Utility', 'Box 1', 'Box 2']);
  });
});
