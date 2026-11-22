// The prototype's sample data, for ?demo mode and tests. Dates are relative to `today`.
import { addMonths } from './dates';
import type { DateStr } from './dates';
import { lotId } from './types';
import type { State } from './types';

const CUPBOARDS = ['Pantry', 'Utility tall', 'Utility high', 'Box 1', 'Box 2'];
const cid = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

export function demoState(today: DateStr, now = Date.now()): State {
  const P: [string, number, string[]][] = [
    ['Chopped tomatoes 400g', 4, ['Pantry', 'Box 1']], ['Baked beans 415g', 3, ['Pantry', 'Box 1']],
    ['Chickpeas 400g', 2, ['Pantry']], ['Red kidney beans 400g', 2, ['Pantry']],
    ['Coconut milk 400ml', 2, ['Pantry', 'Box 1']], ['Tuna chunks 145g', 3, ['Utility tall', 'Box 2']],
    ['Passata 500g', 2, ['Pantry']], ['Sweetcorn 198g', 2, ['Utility tall']],
    ['Basmati rice 1kg', 1, ['Utility high', 'Box 2']], ['Spaghetti 500g', 2, ['Utility high']],
    ['Penne 500g', 2, ['Utility high']], ['Plain flour 1.5kg', 1, ['Box 1']],
    ['Red lentils 500g', 1, ['Box 1']], ['Porridge oats 1kg', 1, ['Box 2']],
    ['Chicken stock cubes', 1, ['Pantry']], ['Peanut butter 340g', 1, ['Box 2']],
  ];
  const L: [string, string, number, number][] = [
    ['Chopped tomatoes 400g', 'Pantry', 26, 8], ['Chopped tomatoes 400g', 'Box 1', 12, 3],
    ['Baked beans 415g', 'Pantry', 1, 1], ['Baked beans 415g', 'Box 1', 14, 2],
    ['Chickpeas 400g', 'Pantry', -1, 1], ['Chickpeas 400g', 'Pantry', 20, 1],
    ['Coconut milk 400ml', 'Pantry', 9, 1], ['Coconut milk 400ml', 'Box 1', 7, 1],
    ['Tuna chunks 145g', 'Utility tall', 30, 2], ['Tuna chunks 145g', 'Box 2', 32, 2],
    ['Passata 500g', 'Pantry', 2, 1], ['Sweetcorn 198g', 'Utility tall', 18, 3],
    ['Basmati rice 1kg', 'Utility high', 12, 1], ['Spaghetti 500g', 'Utility high', 24, 1],
    ['Penne 500g', 'Utility high', 20, 2], ['Plain flour 1.5kg', 'Box 1', 5, 1],
    ['Red lentils 500g', 'Box 1', 11, 2], ['Porridge oats 1kg', 'Box 2', 4, 1],
    ['Chicken stock cubes', 'Pantry', 8, 1], ['Peanut butter 340g', 'Box 2', 6, 1],
  ];
  const s: State = {
    cupboards: { order: CUPBOARDS.map(cid), names: Object.fromEntries(CUPBOARDS.map((n) => [cid(n), n])) },
    products: {},
    lots: {},
  };
  const idOf: Record<string, string> = {};
  P.forEach(([name, target, cbs], i) => {
    const id = `p${String(i + 1).padStart(2, '0')}`;
    idOf[name] = id;
    s.products[id] = { id, name, nameLower: name.toLowerCase(), target, cupboards: cbs.map(cid), lastAdded: now - i * 60000 };
  });
  for (const [name, cb, off, qty] of L) {
    const p = s.products[idOf[name]];
    const date = addMonths(today, off);
    if (!p.lastDate || date > p.lastDate) p.lastDate = date;
    const id = lotId(p.id, cid(cb), date);
    s.lots[id] = { id, pid: p.id, cupboard: cid(cb), date, qty };
  }
  return s;
}
