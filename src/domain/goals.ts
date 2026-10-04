/** Goal allocations are conceptual envelopes — they never change balances (I7). */
import type { Database, Goal, GoalAllocation, ViewScope } from './types';
import { accountBalances } from './ledger';
import { inScope } from './scope';
import { monthsBetween, monthOf, type ISODate } from './dates';
import type { Paise } from './money';

export interface GoalProgress { goal: Goal; allocated: Paise; target: Paise; pct: number; remaining: Paise; achieved: boolean; monthsLeft: number | null; requiredMonthly: Paise | null }

export function goalAllocated(db: Pick<Database, 'goalAllocations'>, goalId: string): Paise {
  return db.goalAllocations.filter((a) => a.goalId === goalId).reduce((s, a) => s + a.amount, 0);
}
export function goalProgress(db: Pick<Database, 'goalAllocations'>, g: Goal, today: ISODate): GoalProgress {
  const allocated = goalAllocated(db, g.id);
  const remaining = Math.max(0, g.targetAmount - allocated);
  const monthsLeft = g.targetDate ? Math.max(0, monthsBetween(monthOf(today), monthOf(g.targetDate))) : null;
  return {
    goal: g, allocated, target: g.targetAmount, pct: g.targetAmount > 0 ? Math.min(100, (allocated / g.targetAmount) * 100) : 0,
    remaining, achieved: allocated >= g.targetAmount && g.targetAmount > 0, monthsLeft,
    requiredMonthly: monthsLeft === null ? null : remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft)),
  };
}

export function goalsInScope(db: Database, scope: ViewScope) { return db.goals.filter((g) => inScope(g.ownerId, scope)); }

export function totalAllocated(db: Database, scope: ViewScope): Paise {
  const ids = new Set(goalsInScope(db, scope).map((g) => g.id));
  return db.goalAllocations.filter((a) => ids.has(a.goalId)).reduce((s, a) => s + a.amount, 0);
}

/** Real liquid money (bank/cash/wallet) minus conceptual allocations. May go negative → warn. */
export function unallocatedLiquid(db: Database, scope: ViewScope): { liquid: Paise; allocated: Paise; unallocated: Paise } {
  const bal = accountBalances(db);
  const liquid = db.accounts.filter((a) => inScope(a.ownerId, scope) && (a.kind === 'bank' || a.kind === 'cash' || a.kind === 'wallet'))
    .reduce((s, a) => s + Math.max(0, bal.get(a.id) ?? 0), 0);
  const allocated = totalAllocated(db, scope);
  return { liquid, allocated, unallocated: liquid - allocated };
}

export function validateAllocation(a: GoalAllocation, db: Database): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  const g = db.goals.find((x) => x.id === a.goalId);
  if (!g) out.push({ field: 'goalId', message: 'Goal not found' });
  if (!Number.isInteger(a.amount) || a.amount === 0) out.push({ field: 'amount', message: 'Enter an amount' });
  if (g && goalAllocated(db, g.id) + a.amount < 0) out.push({ field: 'amount', message: 'Cannot release more than is allocated' });
  return out;
}
