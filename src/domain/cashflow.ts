import type { Category, Database, Id, Transaction, ViewScope } from './types';
import { adjustmentOf, debtPaydownOf, incomeOf, investedOf, spendingOf } from './ledger';
import { inScope } from './scope';
import { daysInMonth, monthOf, monthRange, addMonthsKey, parseDate, type ISODate, type MonthKey } from './dates';
import { expectedOccurrences, isIncomeKind, isSpendingKind } from './expected';
import type { Paise } from './money';
import { pct } from './money';

export const scopedTxns = (db: Pick<Database, 'transactions'>, scope: ViewScope) => db.transactions.filter((t) => inScope(t.ownerId, scope));
export const monthTxns = (txns: Transaction[], month: MonthKey) => txns.filter((t) => monthOf(t.date) === month);

/** Top-level category id for a transaction (interest parts fall under 'fees'). */
export function topCategoryId(t: Transaction, cats: Category[]): Id {
  const id = t.categoryId ?? (t.type === 'liability_payment' ? 'cat_fees' : 'cat_other');
  const c = cats.find((x) => x.id === id);
  return c?.parentId ?? id;
}

export interface MonthSummary {
  month: MonthKey; income: Paise; spending: Paise; savings: Paise; savingsRate: number;
  invested: Paise; debtPaydown: Paise; adjustments: Paise; txnCount: number;
}
export function summarizeMonth(txns: Transaction[], month: MonthKey): MonthSummary {
  let income = 0, spending = 0, invested = 0, debtPaydown = 0, adjustments = 0, n = 0;
  for (const t of txns) {
    if (monthOf(t.date) !== month) continue;
    n++; income += incomeOf(t); spending += spendingOf(t); invested += investedOf(t); debtPaydown += debtPaydownOf(t); adjustments += adjustmentOf(t);
  }
  const savings = income - spending;
  return { month, income, spending, savings, savingsRate: income > 0 ? (savings / income) * 100 : 0, invested, debtPaydown, adjustments, txnCount: n };
}

export function monthlySeries(txns: Transaction[], from: MonthKey, to: MonthKey): MonthSummary[] {
  return monthRange(from, to).map((m) => summarizeMonth(txns, m));
}

export interface Group { key: string; label: string; amount: Paise; count: number }
/** Spending grouped by an arbitrary key (category, merchant, person, account, method, month…). */
export function groupSpending(txns: Transaction[], keyOf: (t: Transaction) => { key: string; label: string } | null): Group[] {
  const m = new Map<string, Group>();
  for (const t of txns) {
    const amt = spendingOf(t);
    if (amt === 0) continue;
    const k = keyOf(t); if (!k) continue;
    const g = m.get(k.key) ?? { key: k.key, label: k.label, amount: 0, count: 0 };
    g.amount += amt; if (amt > 0) g.count++; m.set(k.key, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}
export const normMerchant = (s?: string) => (s ?? '').trim().replace(/\s+/g, ' ');

export function spendingByCategory(db: Database, txns: Transaction[], withSub = false): Group[] {
  const name = (id: Id) => db.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';
  return groupSpending(txns, (t) => {
    const top = topCategoryId(t, db.categories);
    if (withSub && t.subcategoryId) return { key: t.subcategoryId, label: `${name(top)} · ${name(t.subcategoryId)}` };
    return { key: top, label: name(top) };
  });
}

export function savingsTarget(db: Database, scope: ViewScope): Paise {
  return scope === 'household' ? db.settings.householdSavingsTarget : db.settings.people.find((p) => p.id === scope)?.savingsTarget ?? 0;
}

// ---------------------------------------------------------------- projection
export interface Projection {
  month: MonthKey; isCurrent: boolean; target: Paise; minimum: Paise | null;
  actualIncome: Paise; actualSpending: Paise; savingsSoFar: Paise;
  expectedIncomeRemaining: Paise; expectedFixedRemaining: Paise;
  variableDailyPace: Paise; variableRemaining: Paise;
  projectedSavings: Paise; gap: Paise; // gap > 0 means below target
  onTrack: boolean; monthNote?: string; assumptions: string[];
}

const isVariable = (t: Transaction) => spendingOf(t) !== 0 && !t.expectedItemId && !t.oneOff;

export function projectMonthEnd(db: Database, scope: ViewScope, month: MonthKey, today: ISODate): Projection {
  const txns = scopedTxns(db, scope);
  const cur = summarizeMonth(txns, month);
  const target = savingsTarget(db, scope);
  const minimum = scope === 'household' ? db.settings.householdSavingsMinimum : null;
  const base = { month, target, minimum, monthNote: db.settings.monthNotes[month] };
  const currentMonth = monthOf(today);
  const assumptions: string[] = [];
  if (month < currentMonth) {
    const gap = target - cur.savings;
    return { ...base, isCurrent: false, actualIncome: cur.income, actualSpending: cur.spending, savingsSoFar: cur.savings, expectedIncomeRemaining: 0, expectedFixedRemaining: 0, variableDailyPace: 0, variableRemaining: 0, projectedSavings: cur.savings, gap, onTrack: gap <= 0, assumptions: ['Completed month: actual figures.'] };
  }
  const dim = daysInMonth(parseDate(`${month}-01`).y, parseDate(`${month}-01`).m);
  const elapsed = month > currentMonth ? 0 : parseDate(today).d;
  const remainingDays = dim - elapsed;

  // pending expected occurrences within this month (including overdue-but-unconfirmed)
  const occ = expectedOccurrences(db, scope, `${month}-01`, `${month}-31`, today).filter((o) => o.state === 'pending');
  const expectedIncome = occ.filter((o) => isIncomeKind(o.item.kind)).reduce((s, o) => s + o.item.amount, 0);
  const expectedFixed = occ.filter((o) => isSpendingKind(o.item.kind)).reduce((s, o) => s + o.item.amount, 0);

  const variableSoFar = monthTxns(txns, month).filter(isVariable).reduce((s, t) => s + spendingOf(t), 0);
  const prior = [1, 2, 3].map((k) => addMonthsKey(month, -k)).filter((k) => txns.some((t) => monthOf(t.date) === k));
  const priorDaily = prior.length ? prior.reduce((s, k) => s + monthTxns(txns, k).filter(isVariable).reduce((a, t) => a + spendingOf(t), 0) / daysInMonth(+k.slice(0, 4), +k.slice(5, 7)), 0) / prior.length : null;
  let pace: number;
  if (elapsed === 0) { pace = priorDaily ?? 0; if (priorDaily === null) assumptions.push('No spending history yet, so variable spending is assumed to be zero for the rest of the month.'); }
  else {
    const actualDaily = variableSoFar / elapsed;
    const w = elapsed / dim;
    pace = priorDaily === null ? actualDaily : w * actualDaily + (1 - w) * priorDaily;
    assumptions.push(priorDaily === null ? 'Day-to-day spending continues at this month’s pace so far.' : `Day-to-day spending blends this month's pace with your ${prior.length}-month average.`);
  }
  const variableRemaining = Math.round(pace * remainingDays);
  assumptions.push('Confirmed one-off purchases are excluded from the pace; recurring items are added from your expected list.');
  if (expectedIncome === 0 && cur.income === 0) assumptions.push('No income recorded or expected yet this month.');
  const projectedIncome = cur.income + expectedIncome;
  const projectedSpending = cur.spending + expectedFixed + variableRemaining;
  const projectedSavings = projectedIncome - projectedSpending;
  const gap = target - projectedSavings;
  return { ...base, isCurrent: month === currentMonth, actualIncome: cur.income, actualSpending: cur.spending, savingsSoFar: cur.savings, expectedIncomeRemaining: expectedIncome, expectedFixedRemaining: expectedFixed, variableDailyPace: Math.round(pace), variableRemaining, projectedSavings, gap, onTrack: gap <= 0, assumptions };
}

export interface Comparison { current: Paise; previous: Paise; average: Paise; vsPrevPct: number | null; vsAvgPct: number | null }
export function compareMonth(txns: Transaction[], month: MonthKey, pick: (s: MonthSummary) => number, lookback = 3): Comparison {
  const cur = pick(summarizeMonth(txns, month));
  const prevKeys = Array.from({ length: lookback }, (_, i) => addMonthsKey(month, -(i + 1)));
  const prevVals = prevKeys.map((k) => pick(summarizeMonth(txns, k)));
  const avg = Math.round(prevVals.reduce((a, b) => a + b, 0) / lookback);
  return { current: cur, previous: prevVals[0], average: avg, vsPrevPct: prevVals[0] ? pct(cur - prevVals[0], Math.abs(prevVals[0])) : null, vsAvgPct: avg ? pct(cur - avg, Math.abs(avg)) : null };
}

