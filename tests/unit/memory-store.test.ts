import { describe, expect, it } from 'vitest';
import { lotsFor, total } from '../../src/domain/inventory';
import { demoState } from '../../src/domain/seed';
import { MemoryStore } from '../../src/store/memory';
import type { State } from '../../src/domain/types';

const fresh = () => new MemoryStore(demoState('2026-11', 1000), 'Kitchen phone');

describe('MemoryStore', () => {
  it('emits on subscribe and after each change', () => {
    const st = fresh();
    const seen: State[] = [];
    st.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    st.useStock('p01', 1, null);
    expect(seen).toHaveLength(2);
    expect(total(seen[1], 'p01')).toBe(total(seen[0], 'p01') - 1);
  });

  it('logs a transaction with ops, inverse and device name', () => {
    const st = fresh();
    st.useStock('p01', 2, null);
    expect(st.log).toHaveLength(1);
    expect(st.log[0]).toMatchObject({ kind: 'use', pid: 'p01', by: 'Kitchen phone' });
    expect((st.log[0].details.ops as unknown[]).length).toBeGreaterThan(0);
    expect((st.log[0].details.inverse as unknown[]).length).toBeGreaterThan(0);
  });

  it('undo restores the previous state and is logged', () => {
    const st = fresh();
    const before = st.current;
    const tok = st.addStock({ pid: null, name: 'Oat milk', target: 2, cupboard: 'pantry', date: '2027-06', qty: 3 });
    expect(Object.values(st.current!.products).some((p) => p.name === 'Oat milk')).toBe(true);
    st.undo(tok!);
    expect(st.current).toEqual(before);
    expect(st.log.map((l) => l.kind)).toEqual(['add', 'undo']);
    expect(st.log[1].details.undoes).toBe(st.log[0].id);
  });

  it('undo of a delete brings the product back with the same id', () => {
    const st = fresh();
    for (const l of lotsFor(st.current!, 'p16')) st.removeOne(l.id);
    const before = st.current;
    const tok = st.deleteProduct('p16');
    expect(st.current!.products.p16).toBeUndefined();
    st.undo(tok!);
    expect(st.current).toEqual(before);
  });

  it('no-op changes return no undo token and log nothing', () => {
    const st = fresh();
    expect(st.moveLot('missing', 'pantry')).toBeNull();
    expect(st.addCupboard('pantry')).toBeNull();
    expect(st.log).toHaveLength(0);
  });

  it('cupboard add / rename / delete', () => {
    const st = fresh();
    st.addCupboard('Shed');
    const id = st.current!.cupboards.order.at(-1)!;
    expect(st.current!.cupboards.names[id]).toBe('Shed');
    st.renameCupboard(id, 'Garage');
    expect(st.current!.cupboards.names[id]).toBe('Garage');
    st.deleteCupboard(id);
    expect(st.current!.cupboards.order).not.toContain(id);
  });
});
