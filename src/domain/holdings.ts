/** Investments & assets: manual valuation snapshots + flows dated after the latest snapshot (I4). */
import type { Database, Id, Transaction, Valuation } from './types';
import type { Paise } from './money';
import { todayISO, type ISODate } from './dates';

export interface HoldingValue { value: Paise; invested: Paise; asOf?: ISODate; lastValuationDate?: ISODate; gain: Paise; gainPct: number }

function flowsFor(kind: 'investment' | 'asset', id: Id, txns: Transaction[]): Transaction[] {
  return txns.filter((t) => (kind === 'investment'
    ? t.investmentId === id && (t.type === 'investment_contribution' || t.type === 'investment_redemption')
    : t.assetId === id && t.type === 'asset_acquisition'))
    .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
}

export function valuationsFor(db: Pick<Database, 'valuations'>, kind: 'investment' | 'asset', id: Id): Valuation[] {
  return db.valuations.filter((v) => v.targetType === kind && v.targetId === id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function holdingValue(db: Pick<Database, 'valuations' | 'transactions'>, kind: 'investment' | 'asset', id: Id, asOf: ISODate = todayISO()): HoldingValue {
  const vals = valuationsFor(db, kind, id).filter((v) => v.date <= asOf);
  const base = vals[vals.length - 1];
  let value = base?.value ?? 0;
  let invested = base ? (base.invested ?? base.value) : 0;
  for (const t of flowsFor(kind, id, db.transactions)) {
    if (t.date > asOf) continue;
    if (base && t.date <= base.date) continue; // already inside snapshot
    if (t.type === 'investment_redemption') {
      const costOut = value > 0 ? Math.round(invested * Math.min(1, t.amount / value)) : t.amount;
      value = Math.max(0, value - t.amount);
      invested = Math.max(0, invested - costOut);
    } else { value += t.amount; invested += t.amount; }
  }
  const gain = kind === 'investment' ? value - invested : 0;
  return { value, invested, asOf: base?.date, lastValuationDate: base?.date, gain, gainPct: invested > 0 && kind === 'investment' ? (gain / invested) * 100 : 0 };
}

/** Historical growth series from snapshots only (never fabricated between points). */
export function holdingHistory(db: Pick<Database, 'valuations'>, kind: 'investment' | 'asset', id: Id) {
  return valuationsFor(db, kind, id).map((v) => ({ date: v.date, value: v.value, invested: v.invested ?? v.value }));
}
