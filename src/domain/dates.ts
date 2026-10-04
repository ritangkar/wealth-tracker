/** Dates are local calendar strings: YYYY-MM-DD; months YYYY-MM. */
export type ISODate = string;
export type MonthKey = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}
export const isValidMonth = (s: unknown): s is MonthKey => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function daysInMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}
export function todayISO(now = new Date()): ISODate {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export const monthOf = (d: ISODate): MonthKey => d.slice(0, 7);
export function parseDate(d: ISODate): { y: number; m: number; d: number } {
  return { y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) };
}
export function makeDate(y: number, m1: number, d: number): ISODate {
  const dd = Math.min(d, daysInMonth(y, m1));
  return `${String(y).padStart(4, '0')}-${String(m1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
export function addDays(d: ISODate, n: number): ISODate {
  const { y, m, d: dd } = parseDate(d);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseDate(a), pb = parseDate(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86400000);
}
/** Add months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, d: dd } = parseDate(d);
  const idx = y * 12 + (m - 1) + n;
  return makeDate(Math.floor(idx / 12), (idx % 12 + 12) % 12 + 1, dd);
}
export function addMonthsKey(k: MonthKey, n: number): MonthKey {
  return monthOf(addMonths(`${k}-01`, n));
}
export const monthStart = (k: MonthKey): ISODate => `${k}-01`;
export function monthEnd(k: MonthKey): ISODate {
  return makeDate(+k.slice(0, 4), +k.slice(5, 7), 31);
}
export function monthsBetween(a: MonthKey, b: MonthKey): number {
  return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
}
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = from; k <= to; k = addMonthsKey(k, 1)) out.push(k);
  return out;
}
export function inMonth(d: ISODate, k: MonthKey): boolean {
  return d.startsWith(k);
}
export function monthLabel(k: MonthKey, long = false): string {
  const { y, m } = parseDate(`${k}-01`);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });
}
export function formatDate(d: ISODate): string {
  const { y, m, d: dd } = parseDate(d);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
