/** All money is integer paise. */
export type Paise = number;

export const toPaise = (rupees: number): Paise => Math.round(rupees * 100);
export const toRupees = (p: Paise): number => p / 100;

/** Parse user text like "1,250", "₹ 1250.50" → paise. Returns null if invalid. */
export function parseRupees(text: string): Paise | null {
  const t = text.replace(/[₹,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(p: Paise, opts: { paise?: boolean } = {}): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const hasFraction = abs % 100 !== 0;
  const s = opts.paise || hasFraction ? inr2.format(abs / 100) : inr.format(abs / 100);
  return `${neg ? '−' : ''}₹${s}`;
}

/** Compact Indian style: ₹1.5L, ₹2.3Cr, ₹45K */
export function formatCompact(p: Paise): string {
  const neg = p < 0 ? '−' : '';
  const r = Math.abs(p) / 100;
  const f = (n: number) => String(parseFloat(n.toFixed(2)));
  if (r >= 1e7) return `${neg}₹${f(r / 1e7)}Cr`;
  if (r >= 1e5) return `${neg}₹${f(r / 1e5)}L`;
  if (r >= 1e4) return `${neg}₹${f(r / 1e3)}K`;
  return `${neg}₹${inr.format(r)}`;
}

export const sum = (xs: Iterable<number>): number => {
  let t = 0;
  for (const x of xs) t += x;
  return t;
};

/** Split `total` into `n` integer parts that sum exactly to total. */
export function splitEvenly(total: Paise, n: number): Paise[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);

/** Round to whole rupees — used for projections/estimates, which must not imply paise-level precision. */
export const roundRupee = (p: Paise): Paise => Math.round(p / 100) * 100;
