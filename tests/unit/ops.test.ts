import { describe, expect, it } from 'vitest';
import { applyOps, invert, lotQtyAfter } from '../../src/domain/ops';
import type { Op } from '../../src/domain/ops';
import { lotId } from '../../src/domain/types';
import { mk, where } from './helpers';

const base = () =>
  mk({
    products: [{ name: 'X', cupboards: ['Pantry'], target: 2, lastDate: '2028-01' }],
    lots: [['X', 'Pantry', '2028-01', 3]],
  });

describe('applyOps', () => {
  it('does not mutate its input', () => {
    const s = base();
    const copy = structuredClone(s);
    applyOps(s, [
      { t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: -3 },
      { t: 'productPatch', id: 'X', patch: { target: 5 } },
      { t: 'cupboards', value: { order: ['a'], names: { a: 'A' } } },
    ]);
    expect(s).toEqual(copy);
  });

  it('lot: creates, increments, deletes at zero', () => {
    let s = base();
    const op = (delta: number, date = '2028-01'): Op => ({ t: 'lot', pid: 'X', cupboard: 'Pantry', date, delta });
    expect(lotQtyAfter(s, op(-1) as Extract<Op, { t: 'lot' }>)).toBe(2);
    s = applyOps(s, [op(2, '2029-01'), op(-3)]);
    expect(where(s, 'X')).toEqual({ Pantry: { '2029-01': 2 } });
    expect(s.lots[lotId('X', 'Pantry', '2029-01')].id).toBe('X_Pantry_2029-01');
  });

  it('productPatch: null removes a field; missing product is ignored', () => {
    const s = applyOps(base(), [
      { t: 'productPatch', id: 'X', patch: { lastDate: null, target: 9 } },
      { t: 'productPatch', id: 'nope', patch: { target: 1 } },
    ]);
    expect(s.products.X.lastDate).toBeUndefined();
    expect('lastDate' in s.products.X).toBe(false);
    expect(s.products.X.target).toBe(9);
    expect(s.products.nope).toBeUndefined();
  });
});

describe('invert', () => {
  const cases: [string, Op[]][] = [
    ['lot add', [{ t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2029-01', delta: 4 }]],
    ['lot use to zero', [{ t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: -3 }]],
    ['product create', [{ t: 'productSet', id: 'Y', data: { name: 'Y', nameLower: 'y', target: 0, cupboards: ['Pantry'] } }]],
    ['product replace', [{ t: 'productSet', id: 'X', data: { name: 'X2', nameLower: 'x2', target: 0, cupboards: ['Box 1'] } }]],
    ['product patch adding a field', [{ t: 'productPatch', id: 'X', patch: { lastAddCupboard: 'Pantry', cupboards: ['Pantry', 'Box 1'] } }]],
    ['product delete', [{ t: 'productDelete', id: 'X' }]],
    ['cupboards', [{ t: 'cupboards', value: { order: ['z'], names: { z: 'Z' } } }]],
    ['sequence touching the same lot twice', [
      { t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: -3 },
      { t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: 1 },
      { t: 'productPatch', id: 'X', patch: { target: 1 } },
      { t: 'productPatch', id: 'X', patch: { target: 2, lastDate: null } },
    ]],
  ];
  for (const [name, ops] of cases) {
    it(`restores the state: ${name}`, () => {
      const s = base();
      expect(applyOps(applyOps(s, ops), invert(s, ops))).toEqual(s);
    });
  }

  it('an over-large removal only gives back what was there', () => {
    const s = base();
    const inv = invert(s, [{ t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: -10 }]);
    expect(inv).toEqual([{ t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: 3 }]);
  });

  it('lot inverses are deltas, so they compose with another phone’s change', () => {
    const s = base();
    const mine: Op[] = [{ t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: -2 }];
    const inv = invert(s, mine);
    const theirs: Op[] = [{ t: 'lot', pid: 'X', cupboard: 'Pantry', date: '2028-01', delta: 5 }];
    const after = applyOps(applyOps(applyOps(s, mine), theirs), inv);
    expect(where(after, 'X')).toEqual({ Pantry: { '2028-01': 8 } });
  });
});
