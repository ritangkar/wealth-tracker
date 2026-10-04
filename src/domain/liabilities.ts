import type { Database, Liability } from './types';
import { principalPortion } from './ledger';
import type { Paise } from './money';
import { addMonths, type ISODate } from './dates';

export function liabilityOutstanding(db: Pick<Database, 'transactions'>, l: Liability): Paise {
  let out = l.baselineOutstanding;
  for (const t of db.transactions) {
    if (t.liabilityId !== l.id || t.date <= l.baselineDate) continue;
    if (t.type === 'liability_creation') out += t.amount;
    else if (t.type === 'liability_payment') out -= principalPortion(t);
  }
  return Math.max(0, out);
}

/** Months to clear at the stated EMI. Interest-aware when rate > 0. null if never (EMI too low) or no EMI. */
export function remainingMonths(outstanding: Paise, emi: Paise, ratePct: number): number | null {
  if (outstanding <= 0) return 0;
  if (emi <= 0) return null;
  const r = ratePct / 100 / 12;
  if (r === 0) return Math.ceil(outstanding / emi);
  if (emi <= outstanding * r) return null;
  return Math.ceil(-Math.log(1 - (outstanding * r) / emi) / Math.log(1 + r));
}

export interface LiabilitySummary {
  liability: Liability; outstanding: Paise; paidPct: number; monthsLeft: number | null; projectedEnd: ISODate | null; completed: boolean;
}
export function summarizeLiability(db: Pick<Database, 'transactions'>, l: Liability, today: ISODate): LiabilitySummary {
  const outstanding = liabilityOutstanding(db, l);
  const monthsLeft = remainingMonths(outstanding, l.emi, l.interestRate);
  return {
    liability: l, outstanding,
    paidPct: l.originalPrincipal > 0 ? Math.min(100, Math.max(0, (1 - outstanding / l.originalPrincipal) * 100)) : 0,
    monthsLeft,
    projectedEnd: monthsLeft === null ? null : addMonths(today, monthsLeft),
    completed: outstanding === 0,
  };
}

export function debtOverview(db: Pick<Database, 'transactions' | 'liabilities'>, today: ISODate) {
  const active = db.liabilities.filter((l) => l.status === 'active');
  const items = active.map((l) => summarizeLiability(db, l, today));
  const open = items.filter((i) => !i.completed);
  const totalDebt = open.reduce((s, i) => s + i.outstanding, 0);
  const monthlyCommitment = open.reduce((s, i) => s + Math.min(i.liability.emi, i.outstanding), 0);
  const ends = open.map((i) => i.projectedEnd).filter((x): x is ISODate => !!x).sort();
  const unknown = open.some((i) => i.projectedEnd === null);
  return { items, totalDebt, monthlyCommitment, projectedDebtFree: unknown ? null : ends[ends.length - 1] ?? null, debtFreeUnknown: unknown };
}
