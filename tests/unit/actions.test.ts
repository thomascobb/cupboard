import { describe, expect, it } from 'vitest';
import * as A from '../../src/domain/actions';
import { applyOps, invert } from '../../src/domain/ops';
import type { Change } from '../../src/domain/ops';
import { demoState } from '../../src/domain/seed';
import { lotId } from '../../src/domain/types';
import type { State } from '../../src/domain/types';
import { mk, P, where } from './helpers';

/** Apply a change, check its inverse restores the original exactly, and return the new state. */
function run(s: State, c: Change | null): State {
  expect(c).not.toBeNull();
  const next = applyOps(s, c!.ops);
  expect(applyOps(next, invert(s, c!.ops))).toEqual(s);
  return next;
}

const toms = () =>
  mk({
    products: [{ name: 'Toms', cupboards: ['Pantry', 'Box 1'], target: 4 }],
    lots: [
      ['Toms', 'Pantry', '2029-01', 8],
      ['Toms', 'Box 1', '2027-11', 3],
    ],
  });

describe('swap', () => {
  it('SPEC scenario: f=3, r=6 ⇒ Pantry {Nov 2027 ×3, Jan 2029 ×2}, Box 1 {Jan 2029 ×6}', () => {
    const s = run(toms(), A.swap(toms(), 'Toms', 3, 6));
    expect(where(s, 'Toms')).toEqual({ Pantry: { '2027-11': 3, '2029-01': 2 }, 'Box 1': { '2029-01': 6 } });
  });

  it('suggested amounts move everything into place', () => {
    const s0 = toms();
    const s = run(s0, A.swap(s0, 'Toms', 3, 8));
    expect(where(s, 'Toms')).toEqual({ Pantry: { '2027-11': 3 }, 'Box 1': { '2029-01': 8 } });
  });

  it('only forward, only back, and message', () => {
    const s0 = toms();
    const c = A.swap(s0, 'Toms', 2, 0);
    expect(c.message).toBe('Rotated Toms: 2 forward, 0 back');
    expect(where(run(s0, c), 'Toms')).toEqual({ Pantry: { '2027-11': 2, '2029-01': 8 }, 'Box 1': { '2027-11': 1 } });
    expect(where(run(s0, A.swap(s0, 'Toms', 0, 1)), 'Toms')).toEqual({
      Pantry: { '2029-01': 7 }, 'Box 1': { '2027-11': 3, '2029-01': 1 },
    });
  });

  it('asks for more than exists: moves what there is', () => {
    const s0 = toms();
    const c = A.swap(s0, 'Toms', 50, 50);
    expect(c.details).toEqual({ f: 3, r: 8 });
  });

  it('forward takes oldest across several reserve cupboards; back goes to the oldest reserve cupboard', () => {
    const s0 = mk({
      products: [{ name: 'X', cupboards: ['Pantry', 'Box 1', 'Box 2'] }],
      lots: [
        ['X', 'Pantry', '2029-01', 2],
        ['X', 'Box 1', '2027-06', 1],
        ['X', 'Box 2', '2027-03', 2],
      ],
    });
    const s = run(s0, A.swap(s0, 'X', 3, 2));
    expect(where(s, 'X')).toEqual({ Pantry: { '2027-03': 2, '2027-06': 1 }, 'Box 2': { '2029-01': 2 } });
  });

  it('rotate: several products in one change', () => {
    const s0 = mk({
      products: [
        { name: 'A', cupboards: ['Pantry', 'Box 1'] },
        { name: 'B', cupboards: ['Pantry', 'Box 1'] },
        { name: 'C', cupboards: ['Pantry', 'Box 1'] },
      ],
      lots: [
        ['A', 'Pantry', '2029-01', 1], ['A', 'Box 1', '2027-01', 1],
        ['B', 'Box 1', '2027-01', 2],
        ['C', 'Pantry', '2029-01', 1], ['C', 'Box 1', '2027-01', 1],
      ],
    });
    const c = A.rotate(s0, {
      A: { on: true, f: 1, r: 1 },
      B: { on: true, f: 1, r: 0 },
      C: { on: false, f: 1, r: 1 },
      Missing: { on: true, f: 1, r: 1 },
    });
    expect(c.message).toBe('Rotated 2 items');
    const s = run(s0, c);
    expect(where(s, 'A')).toEqual({ Pantry: { '2027-01': 1 }, 'Box 1': { '2029-01': 1 } });
    expect(where(s, 'B')).toEqual({ Pantry: { '2027-01': 1 }, 'Box 1': { '2027-01': 1 } });
    expect(where(s, 'C')).toEqual(where(s0, 'C'));
  });
});

describe('add', () => {
  it('merges into an existing lot and updates the product defaults', () => {
    const s0 = toms();
    const s = run(s0, A.addStock(s0, { pid: 'Toms', newId: 'unused', cupboard: 'Pantry', date: '2029-01', qty: 2, now: 99 }));
    expect(where(s, 'Toms').Pantry).toEqual({ '2029-01': 10 });
    expect(P(s, 'Toms')).toMatchObject({ lastDate: '2029-01', lastAdded: 99, lastAddCupboard: 'Pantry' });
  });

  it('learns a new cupboard (appended as reserve)', () => {
    const s0 = toms();
    const s = run(s0, A.addStock(s0, { pid: 'Toms', newId: 'x', cupboard: 'Box 2', date: '2030-01', qty: 1, now: 1 }));
    expect(P(s, 'Toms').cupboards).toEqual(['Pantry', 'Box 1', 'Box 2']);
  });

  it('creates a new product', () => {
    const s0 = toms();
    const c = A.addStock(s0, { pid: null, name: ' Beans ', target: 3, newId: 'b1', cupboard: 'Utility', date: '2028-05', qty: 4, now: 5 });
    expect(c.message).toBe('Added 4 Beans');
    const s = run(s0, c);
    expect(P(s, 'b1')).toEqual({
      id: 'b1', name: 'Beans', nameLower: 'beans', target: 3, cupboards: ['Utility'],
      lastAddCupboard: 'Utility', lastDate: '2028-05', lastAdded: 5,
    });
    expect(s.lots[lotId('b1', 'Utility', '2028-05')].qty).toBe(4);
  });

  it('a "new" product whose name already exists (any case) adds to the existing one', () => {
    const s0 = toms();
    const c = A.addStock(s0, { pid: null, name: 'TOMS', newId: 'dupe', cupboard: 'Pantry', date: '2029-01', qty: 1, now: 1 });
    expect(c.pid).toBe('Toms');
    const s = run(s0, c);
    expect(s.products.dupe).toBeUndefined();
    expect(total(s)).toBe(12);
  });

  it('rejects a blank new name', () => {
    expect(() => A.addStock(toms(), { pid: null, name: '  ', newId: 'x', cupboard: 'Pantry', date: '2029-01', qty: 1, now: 1 })).toThrow();
  });
});

const total = (s: State) => Object.values(s.lots).reduce((n, l) => n + l.qty, 0);

describe('use', () => {
  it('takes oldest first across cupboards and deletes emptied lots', () => {
    const s0 = toms();
    const c = A.useStock(s0, 'Toms', 4, null);
    expect(c.message).toBe('Took 4 Toms. 7 left.');
    const s = run(s0, c);
    expect(where(s, 'Toms')).toEqual({ Pantry: { '2029-01': 7 } });
  });

  it('respects the cupboard filter', () => {
    const s0 = toms();
    const s = run(s0, A.useStock(s0, 'Toms', 2, 'Pantry'));
    expect(where(s, 'Toms')).toEqual({ Pantry: { '2029-01': 6 }, 'Box 1': { '2027-11': 3 } });
  });

  it('cannot take more than there is', () => {
    const s0 = toms();
    const c = A.useStock(s0, 'Toms', 20, null);
    expect(c.details).toMatchObject({ qty: 11 });
    expect(where(run(s0, c), 'Toms')).toEqual({});
  });
});

describe('move / remove one', () => {
  it('moves a whole lot, merging, and learns the cupboard', () => {
    const s0 = mk({
      products: [{ name: 'X', cupboards: ['Pantry'] }],
      lots: [['X', 'Pantry', '2028-01', 2], ['X', 'Box 1', '2028-01', 1]],
    });
    const c = A.moveLot(s0, lotId('X', 'Box 1', '2028-01'), 'Pantry');
    expect(c?.message).toBe('Moved to Pantry');
    const s = run(s0, c);
    expect(where(s, 'X')).toEqual({ Pantry: { '2028-01': 3 } });
    const t = run(s, A.moveLot(s, lotId('X', 'Pantry', '2028-01'), 'Box 2'));
    expect(P(t, 'X').cupboards).toEqual(['Pantry', 'Box 2']);
    expect(A.moveLot(s, lotId('X', 'Pantry', '2028-01'), 'Pantry')).toBeNull();
    expect(A.moveLot(s, 'missing', 'Pantry')).toBeNull();
  });

  it('remove one, down to deletion', () => {
    const s0 = mk({ products: [{ name: 'X', cupboards: ['Pantry'] }], lots: [['X', 'Pantry', '2028-01', 1]] });
    const s = run(s0, A.removeOne(s0, lotId('X', 'Pantry', '2028-01')));
    expect(s.lots).toEqual({});
    expect(A.removeOne(s, lotId('X', 'Pantry', '2028-01'))).toBeNull();
  });
});

describe('product settings', () => {
  it('target is clamped 0..99', () => {
    const s0 = toms();
    expect(P(run(s0, A.setTarget(s0, 'Toms', 7)), 'Toms').target).toBe(7);
    expect(P(run(s0, A.setTarget(s0, 'Toms', -1)), 'Toms').target).toBe(0);
    expect(P(run(s0, A.setTarget(s0, 'Toms', 120)), 'Toms').target).toBe(99);
  });

  it('cupboard order and "add a cupboard"', () => {
    const s0 = toms();
    expect(P(run(s0, A.setCupboardOrder(s0, 'Toms', ['Box 1', 'Pantry'])), 'Toms').cupboards).toEqual(['Box 1', 'Pantry']);
    const c = A.addProductCupboard(s0, 'Toms', 'Utility');
    expect(c.message).toBe('Added Utility as reserve');
    expect(P(run(s0, c), 'Toms').cupboards).toEqual(['Pantry', 'Box 1', 'Utility']);
    expect(A.addProductCupboard(s0, 'Toms', 'Pantry').ops).toEqual([]);
    expect(A.setCupboardOrder(s0, 'Toms', []).ops).toEqual([]);
  });

  it('delete product; undo restores it with the same id', () => {
    const s0 = mk({ products: [{ name: 'X', cupboards: ['Pantry'], target: 2, lastDate: '2028-01' }] });
    const s = run(s0, A.deleteProduct(s0, 'X'));
    expect(s.products).toEqual({});
  });
});

describe('household cupboards', () => {
  it('name checks: blank, unchanged, duplicate (case-insensitive)', () => {
    const c = toms().cupboards;
    expect(A.checkCupboardName(c, ' ', null)).toEqual({ ok: false, msg: 'Type a name' });
    expect(A.checkCupboardName(c, 'pantry', null)).toEqual({ ok: false, msg: 'That name is taken' });
    expect(A.checkCupboardName(c, 'Shed', null)).toEqual({ ok: true, msg: 'Add “Shed”' });
    expect(A.checkCupboardName(c, 'Pantry', 'Pantry')).toEqual({ ok: false, msg: 'Rename' });
    expect(A.checkCupboardName(c, 'PANTRY', 'Pantry')).toEqual({ ok: true, msg: 'Rename to “PANTRY”' });
    expect(A.checkCupboardName(c, 'box 1', 'Pantry')).toEqual({ ok: false, msg: 'That name is taken' });
  });

  it('add and rename (rename touches only the cupboard list)', () => {
    const s0 = toms();
    const s = run(s0, A.addCupboard(s0, ' Shed ', 'c9'));
    expect(s.cupboards.order.at(-1)).toBe('c9');
    expect(s.cupboards.names.c9).toBe('Shed');
    expect(A.addCupboard(s0, 'box 1', 'c9')).toBeNull();
    const r = A.renameCupboard(s, 'c9', 'Garage');
    expect(r?.message).toBe('Renamed Shed to Garage');
    expect(r?.ops).toHaveLength(1);
    expect(run(s, r).cupboards.names.c9).toBe('Garage');
    expect(A.renameCupboard(s, 'nope', 'X')).toBeNull();
  });

  it('delete only when empty and not the last; products forget it', () => {
    const s0 = mk({
      cupboards: ['Pantry', 'Box 1', 'Box 2'],
      products: [
        { name: 'A', cupboards: ['Pantry', 'Box 2'], lastAddCupboard: 'Box 2' },
        { name: 'B', cupboards: ['Box 2'] },
        { name: 'C', cupboards: ['Box 1'] },
      ],
      lots: [['C', 'Box 1', '2028-01', 1]],
    });
    expect(A.canDeleteCupboard(s0, 'Box 1')).toBe(false);
    expect(A.deleteCupboard(s0, 'Box 1')).toBeNull();
    const s = run(s0, A.deleteCupboard(s0, 'Box 2'));
    expect(s.cupboards.order).toEqual(['Pantry', 'Box 1']);
    expect(s.cupboards.names['Box 2']).toBeUndefined();
    expect(P(s, 'A').cupboards).toEqual(['Pantry']);
    expect(P(s, 'A').lastAddCupboard).toBeUndefined();
    expect(P(s, 'B').cupboards).toEqual(['Pantry']);
    const one = mk({ cupboards: ['Only'], products: [] });
    expect(A.canDeleteCupboard(one, 'Only')).toBe(false);
  });
});

describe('demo seed', () => {
  it('is consistent and has rotation work to do', () => {
    const s = demoState('2026-11', 1000);
    expect(Object.keys(s.products)).toHaveLength(16);
    expect(s.cupboards.order).toHaveLength(5);
    for (const l of Object.values(s.lots)) {
      expect(s.products[l.pid]).toBeDefined();
      expect(s.cupboards.order).toContain(l.cupboard);
      expect(l.id).toBe(lotId(l.pid, l.cupboard, l.date));
    }
    expect(P(s, 'p01').lastDate).toBe('2029-01');
  });
});
