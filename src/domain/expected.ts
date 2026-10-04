/** Expected/recurring items produce occurrences, never transactions (I9). */
import type { Database, ExpectedItem, Id, Transaction, ViewScope } from './types';
import { addDays, addMonths, makeDate, type ISODate } from './dates';
import { inScope } from './scope';
import { emiState } from './emi';
import type { Paise } from './money';

export function occurrenceDates(item: ExpectedItem, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const end = item.endDate && item.endDate < to ? item.endDate : to;
  const step = (k: number): ISODate =>
    item.frequency === 'weekly' ? addDays(item.startDate, 7 * k)
      : addMonths(item.startDate, k * (item.frequency === 'monthly' ? 1 : item.frequency === 'quarterly' ? 3 : 12));
  for (let k = 0; k < 5000; k++) {
    const d = step(k);
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export type OccurrenceState = 'confirmed' | 'skipped' | 'pending';
export interface Occurrence { item: ExpectedItem; date: ISODate; state: OccurrenceState; overdue: boolean; /** pending, but a matching manual transaction already exists this month */ likelyRecorded: boolean }

export function occurrenceState(item: ExpectedItem, date: ISODate, txns: Pick<Transaction, 'id'>[]): OccurrenceState {
  const tid = item.confirmed[date];
  if (tid && txns.some((t) => t.id === tid)) return 'confirmed';
  if (item.skipped.includes(date)) return 'skipped';
  return 'pending';
}

/** Heuristic: the user already logged this by hand (no link) — avoid double counting in projections. */
export function likelyRecorded(item: ExpectedItem, date: ISODate, txns: Transaction[]): boolean {
  const month = date.slice(0, 7);
  const name = (item.merchant ?? item.name).trim().toLowerCase();
  return txns.some((t) => {
    if (t.date.slice(0, 7) !== month || t.ownerId !== item.ownerId || t.expectedItemId) return false; // linked ones are already accounted for
    if (item.kind === 'salary') return t.type === 'income' && (t.incomeType ?? 'Salary') === (item.incomeType ?? 'Salary');
    if (item.kind === 'sip') return t.type === 'investment_contribution' && t.investmentId === item.investmentId;
    const m = (t.merchant ?? '').trim().toLowerCase();
    return t.type === 'expense' && !!m && (m === name || m.includes(name) || name.includes(m)) && Math.abs(t.amount - item.amount) <= item.amount * 0.15;
  });
}

export function expectedOccurrences(db: Database, scope: ViewScope, from: ISODate, to: ISODate, today: ISODate): Occurrence[] {
  const out: Occurrence[] = [];
  for (const item of db.expectedItems) {
    if (!inScope(item.ownerId, scope)) continue;
    if (item.status === 'stopped' && !item.endDate) continue;
    for (const date of occurrenceDates(item, from, to)) {
      const state = occurrenceState(item, date, db.transactions);
      out.push({ item, date, state, overdue: state === 'pending' && date < today, likelyRecorded: state === 'pending' && likelyRecorded(item, date, db.transactions) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Draft transaction the user can review/edit before confirming. */
export function draftFromOccurrence(item: ExpectedItem, date: ISODate): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  const base = { date, amount: item.amount, ownerId: item.ownerId, recurring: true, expectedItemId: item.id, expectedDate: date, merchant: item.merchant ?? item.name, notes: undefined as string | undefined };
  switch (item.kind) {
    case 'salary': return { ...base, type: 'income', toAccountId: item.accountId, incomeType: item.incomeType ?? 'Salary', merchant: undefined };
    case 'sip': return { ...base, type: 'investment_contribution', fromAccountId: item.accountId, investmentId: item.investmentId, paymentMethod: item.paymentMethod ?? 'bank_transfer' };
    default: return { ...base, type: 'expense', fromAccountId: item.accountId, categoryId: item.categoryId ?? (item.kind === 'subscription' ? 'cat_subscriptions' : item.kind === 'bill' ? 'cat_bills' : 'cat_other'), paymentMethod: item.paymentMethod };
  }
}

export const isIncomeKind = (k: ExpectedItem['kind']) => k === 'salary';
/** Does this kind reduce savings (spending) when it happens? */
export const isSpendingKind = (k: ExpectedItem['kind']) => k === 'subscription' || k === 'bill' || k === 'other';

export type CommitmentKind = 'expected' | 'emi' | 'loan';
export interface Commitment { kind: CommitmentKind; refId: Id; name: string; date: ISODate; amount: Paise; overdue: boolean }

/** Upcoming outflow commitments (pending expected expenses/SIPs, EMI instalments, loan EMIs). */
export function upcomingCommitments(db: Database, scope: ViewScope, from: ISODate, to: ISODate, today: ISODate): Commitment[] {
  const out: Commitment[] = [];
  for (const o of expectedOccurrences(db, scope, from, to, today)) {
    if (o.state !== 'pending' || o.likelyRecorded || o.item.kind === 'salary') continue;
    out.push({ kind: 'expected', refId: o.item.id, name: o.item.name, date: o.date, amount: o.item.amount, overdue: o.overdue });
  }
  for (const e of db.emis) {
    if (!inScope(e.ownerId, scope)) continue;
    const s = emiState(e);
    if (!s.active || !s.nextDueDate) continue;
    for (let k = 0; k < s.monthsRemaining; k++) {
      const d = addMonths(e.startDate, s.monthsCompleted + k);
      if (d > to) break;
      if (d >= from) out.push({ kind: 'emi', refId: e.id, name: e.name, date: d, amount: e.emiAmount, overdue: d < today });
    }
  }
  for (const l of db.liabilities) {
    if (!inScope(l.ownerId, scope) || l.status !== 'active' || l.emi <= 0 || !l.paymentDay) continue;
    // loans: unpaid EMIs older than the current month are not assumed (payments may simply be unrecorded)
    const lo = [from, l.baselineDate, `${today.slice(0, 7)}-01`].sort().pop()!;
    let d = `${lo.slice(0, 7)}-01`;
    for (let k = 0; k < 24; k++, d = addMonths(d, 1)) {
      const due = makeDate(+d.slice(0, 4), +d.slice(5, 7), l.paymentDay);
      if (due < lo || due > to) continue;
      if (l.endDate && due > l.endDate) continue;
      const paid = db.transactions.some((t) => t.type === 'liability_payment' && t.liabilityId === l.id && t.date.slice(0, 7) === due.slice(0, 7));
      if (!paid) out.push({ kind: 'loan', refId: l.id, name: l.name, date: due, amount: l.emi, overdue: due < today });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Monthly equivalent of a recurring item's amount (weekly ×52/12, quarterly ÷3, yearly ÷12). */
export function monthlyEquivalent(item: Pick<ExpectedItem, 'amount' | 'frequency'>): Paise {
  switch (item.frequency) {
    case 'weekly': return Math.round((item.amount * 52) / 12);
    case 'quarterly': return Math.round(item.amount / 3);
    case 'yearly': return Math.round(item.amount / 12);
    default: return item.amount;
  }
}
