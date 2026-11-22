import { describe, expect, it } from 'vitest';
import { addMonths, fmt, isValidYM, parseYM, status, ym, ymOf } from '../../src/domain/dates';

describe('dates', () => {
  it('formats and parses', () => {
    expect(ym(2028, 3)).toBe('2028-03');
    expect(ymOf(new Date(2026, 10, 22))).toBe('2026-11');
    expect(parseYM('2028-03')).toEqual({ y: 2028, m: 3 });
    expect(fmt('2028-03')).toBe('Mar 2028');
    expect(fmt('2029-12')).toBe('Dec 2029');
  });

  it('adds months across years', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 0)).toBe('2026-12');
    expect(addMonths('2026-06', 26)).toBe('2028-08');
    expect(addMonths('2026-06', -18)).toBe('2024-12');
  });

  it('status: expired before this month, soon within the next 2 months inclusive', () => {
    const today = '2026-11';
    expect(status('2026-10', today)).toBe('expired');
    expect(status('2025-12', today)).toBe('expired');
    expect(status('2026-11', today)).toBe('soon');
    expect(status('2026-12', today)).toBe('soon');
    expect(status('2027-01', today)).toBe('soon');
    expect(status('2027-02', today)).toBe('ok');
  });

  it('status accepts day-precision dates (future-proofing)', () => {
    expect(status('2026-11-03', '2026-11')).toBe('soon');
    expect(status('2026-10-31', '2026-11')).toBe('expired');
  });

  it('validates YYYY-MM', () => {
    expect(isValidYM('2026-01')).toBe(true);
    expect(isValidYM('2026-13')).toBe(false);
    expect(isValidYM('2026-1')).toBe(false);
    expect(isValidYM(null)).toBe(false);
  });
});
