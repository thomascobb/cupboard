// Best-before dates are month precision: "YYYY-MM" means the end of that month.
// Kept as strings so they sort lexically. A future "YYYY-MM-DD" form would sort the same way.

export type DateStr = string;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ym = (y: number, m: number): DateStr => `${y}-${String(m).padStart(2, '0')}`;

export const ymOf = (d: Date): DateStr => ym(d.getFullYear(), d.getMonth() + 1);

export function parseYM(s: DateStr): { y: number; m: number } {
  const [y, m] = s.split('-').map(Number);
  return { y, m };
}

export function addMonths(s: DateStr, n: number): DateStr {
  const { y, m } = parseYM(s);
  const t = y * 12 + (m - 1) + n;
  return ym(Math.floor(t / 12), (t % 12) + 1);
}

/** "Mar 2028" */
export function fmt(s: DateStr): string {
  const { y, m } = parseYM(s);
  return `${MONTHS[m - 1]} ${y}`;
}

export type Status = 'expired' | 'soon' | 'ok';

/** expired: before this month; soon: this month or the next two; else ok. */
export function status(s: DateStr, today: DateStr): Status {
  const month = s.slice(0, 7);
  if (month < today) return 'expired';
  if (month <= addMonths(today, 2)) return 'soon';
  return 'ok';
}

export const isValidYM = (s: unknown): s is DateStr =>
  typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
