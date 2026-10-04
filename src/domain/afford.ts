/** "Can I afford this?" — a planning aid, not financial advice. */
import type { Database, ViewScope } from './types';
import { projectMonthEnd } from './cashflow';
import { unallocatedLiquid } from './goals';
import { upcomingCommitments } from './expected';
import { cardMetrics } from './cards';
import { emiState } from './emi';
import { addDays, addMonths, monthOf, type ISODate } from './dates';
import { formatMoney, type Paise } from './money';
import { inScope } from './scope';

export type Verdict = 'comfortable' | 'tight' | 'dips_into_goals' | 'exceeds_cash';
export interface AffordResult {
  amount: Paise; verdict: Verdict; headline: string; lines: { label: string; value: Paise; note?: string }[];
  explanation: string[]; disclaimer: string;
  projectedSavingsAfter: Paise; gapAfter: Paise; cashAfterCommitments: Paise; unallocatedAfter: Paise;
}
export const AFFORD_DISCLAIMER = 'This is a planning aid based on the data you have entered. It is not financial advice.';

export function canIAfford(db: Database, scope: ViewScope, amount: Paise, today: ISODate, horizonDays = 30): AffordResult {
  const month = monthOf(today);
  const proj = projectMonthEnd(db, scope, month, today);
  const { liquid, allocated, unallocated } = unallocatedLiquid(db, scope);
  const to = addDays(today, horizonDays);
  const commitments = upcomingCommitments(db, scope, addDays(today, -31), to, today).filter((c) => c.kind !== 'emi'); // EMIs covered by card bills below
  const commitTotal = commitments.reduce((s, c) => s + c.amount, 0);
  // card bills due: non-EMI outstanding + EMI instalments due within horizon
  let cardDue = 0;
  for (const acc of db.accounts) {
    if (acc.kind !== 'credit_card' || !inScope(acc.ownerId, scope)) continue;
    const m = cardMetrics(db, acc, today); cardDue += m.nonEmiOutstanding;
  }
  for (const e of db.emis) {
    if (!inScope(e.ownerId, scope)) continue;
    const s = emiState(e); if (!s.active || !s.nextDueDate) continue;
    for (let k = 0; k < s.monthsRemaining; k++) { if (addMonths(e.startDate, s.monthsCompleted + k) <= to) cardDue += e.emiAmount; else break; }
  }
  const committed = commitTotal + cardDue;
  const cashAfter = liquid - committed - amount;
  const unallocatedAfter = unallocated - amount;
  const projectedAfter = proj.projectedSavings - amount;
  const gapAfter = proj.target - projectedAfter;

  let verdict: Verdict; let headline: string;
  if (cashAfter < 0) { verdict = 'exceeds_cash'; headline = 'This would take you below what you need for upcoming commitments.'; }
  else if (unallocatedAfter < 0) { verdict = 'dips_into_goals'; headline = 'Affordable in cash, but it would dip into money set aside for goals.'; }
  else if (gapAfter > 0) { verdict = 'tight'; headline = 'Doable, though it would push this month’s savings further from target.'; }
  else { verdict = 'comfortable'; headline = 'It fits within this month’s plan and your commitments.'; }

  const explanation = [
    `Projected savings this month go from ${formatMoney(proj.projectedSavings)} to ${formatMoney(projectedAfter)} (target ${formatMoney(proj.target)}).`,
    `Cash and bank balances: ${formatMoney(liquid)}. Known commitments in the next ${horizonDays} days (recurring items, loan EMIs, card bills incl. EMI instalments): ${formatMoney(committed)}.`,
    `Goal envelopes hold ${formatMoney(allocated)} of that cash conceptually; unallocated cash after this purchase would be ${formatMoney(unallocatedAfter)}.`,
    ...proj.assumptions.slice(0, 1),
  ];
  return {
    amount, verdict, headline, explanation, disclaimer: AFFORD_DISCLAIMER,
    lines: [
      { label: 'Cash & bank now', value: liquid }, { label: `Commitments (${horizonDays} days)`, value: -committed },
      { label: 'This purchase', value: -amount }, { label: 'Cash left after commitments', value: cashAfter },
      { label: 'Of which set aside for goals', value: allocated, note: 'conceptual — not extra money' }, { label: 'Free cash after goals', value: unallocatedAfter },
    ],
    projectedSavingsAfter: projectedAfter, gapAfter, cashAfterCommitments: cashAfter, unallocatedAfter,
  };
}
