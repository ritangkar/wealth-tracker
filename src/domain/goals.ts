/** Goal allocations are conceptual envelopes — they never change balances (I7). */
import type { AllocationSourceKind, Database, Goal, GoalAllocation, Id, ViewScope } from './types';
import { holdingValue } from './holdings';
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

/**
 * Real liquid money (bank/cash/wallet) minus the allocations that are set aside FROM cash
 * (account-sourced or not tied to any source). Allocations sourced from FDs/funds/stocks do not reduce free cash.
 * May go negative → warn.
 */
export function unallocatedLiquid(db: Database, scope: ViewScope): { liquid: Paise; allocated: Paise; unallocated: Paise } {
  const bal = accountBalances(db);
  const liquid = db.accounts.filter((a) => inScope(a.ownerId, scope) && (a.kind === 'bank' || a.kind === 'cash' || a.kind === 'wallet'))
    .reduce((s, a) => s + Math.max(0, bal.get(a.id) ?? 0), 0);
  const ids = new Set(goalsInScope(db, scope).map((g) => g.id));
  const allocated = db.goalAllocations.filter((a) => ids.has(a.goalId) && (!a.sourceKind || a.sourceKind === 'account')).reduce((s, a) => s + a.amount, 0);
  return { liquid, allocated, unallocated: liquid - allocated };
}

// ---------------------------------------------------------------- funding sources
/** Money that may back a goal: bank/cash/wallet/broker-cash accounts, investments other than EPF/PPF, and gold/other assets. */
export interface FundingSource {
  kind: AllocationSourceKind; id: Id; name: string; label: string;
  value: Paise; allocated: Paise; free: Paise; liquid: boolean;
}
const INVESTMENT_LABELS: Record<string, string> = { mutual_fund: 'Mutual fund', stock: 'Stock', fd: 'Fixed deposit', rd: 'Recurring deposit', sip: 'SIP fund', other: 'Investment' };
const ACCOUNT_LABELS: Record<string, string> = { bank: 'Bank account', cash: 'Cash', wallet: 'Wallet', investment: 'Broker cash' };

export function isEligibleSource(db: Database, kind: AllocationSourceKind, id: Id): boolean {
  if (kind === 'account') { const a = db.accounts.find((x) => x.id === id); return !!a && a.kind !== 'credit_card'; }
  if (kind === 'investment') { const i = db.investments.find((x) => x.id === id); return !!i && i.type !== 'ppf_epf'; }
  const a = db.assets.find((x) => x.id === id); return !!a && (a.kind === 'gold' || a.kind === 'other');
}

export function fundingSources(db: Database, scope: ViewScope): FundingSource[] {
  const goalIds = new Set(goalsInScope(db, scope).map((g) => g.id));
  const allocatedBy = new Map<string, Paise>();
  for (const a of db.goalAllocations) if (a.sourceKind && a.sourceId && goalIds.has(a.goalId)) allocatedBy.set(`${a.sourceKind}:${a.sourceId}`, (allocatedBy.get(`${a.sourceKind}:${a.sourceId}`) ?? 0) + a.amount);
  const out: FundingSource[] = [];
  const push = (kind: AllocationSourceKind, id: Id, name: string, label: string, value: Paise, liquid: boolean, archived?: boolean) => {
    const allocated = allocatedBy.get(`${kind}:${id}`) ?? 0;
    if (archived && value <= 0 && allocated === 0) return;
    out.push({ kind, id, name, label, value, allocated, free: value - allocated, liquid });
  };
  const bal = accountBalances(db);
  for (const a of db.accounts) if (a.kind !== 'credit_card' && inScope(a.ownerId, scope)) push('account', a.id, a.name, ACCOUNT_LABELS[a.kind] ?? 'Account', Math.max(0, bal.get(a.id) ?? 0), true, a.archived);
  for (const i of db.investments) if (i.type !== 'ppf_epf' && inScope(i.ownerId, scope)) push('investment', i.id, i.name, INVESTMENT_LABELS[i.type] ?? 'Investment', holdingValue(db, 'investment', i.id).value, false, i.archived);
  for (const a of db.assets) if ((a.kind === 'gold' || a.kind === 'other') && inScope(a.ownerId, scope)) push('asset', a.id, a.name, a.kind === 'gold' ? 'Gold' : 'Asset', holdingValue(db, 'asset', a.id).value, false, a.archived);
  return out;
}

export interface FundingOverview {
  sources: FundingSource[]; totalAvailable: Paise; totalAllocated: Paise; totalFree: Paise;
  /** older allocations with no source — counted against cash */
  unassigned: Paise;
}
export function fundingOverview(db: Database, scope: ViewScope): FundingOverview {
  const sources = fundingSources(db, scope);
  const ids = new Set(goalsInScope(db, scope).map((g) => g.id));
  const unassigned = db.goalAllocations.filter((a) => ids.has(a.goalId) && !a.sourceKind).reduce((s, a) => s + a.amount, 0);
  const totalAvailable = sources.reduce((s, x) => s + x.value, 0);
  const totalAllocated = sources.reduce((s, x) => s + x.allocated, 0) + unassigned;
  return { sources, totalAvailable, totalAllocated, totalFree: totalAvailable - totalAllocated, unassigned };
}

/** Per-goal breakdown of where its money is set aside from. */
export function goalSourceBreakdown(db: Database, goalId: Id): { kind?: AllocationSourceKind; id?: Id; name: string; label: string; amount: Paise }[] {
  const m = new Map<string, { kind?: AllocationSourceKind; id?: Id; name: string; label: string; amount: Paise }>();
  for (const a of db.goalAllocations) {
    if (a.goalId !== goalId) continue;
    const key = a.sourceKind ? `${a.sourceKind}:${a.sourceId}` : 'none';
    let row = m.get(key);
    if (!row) {
      const name = !a.sourceKind ? 'Not tied to a source' : (a.sourceKind === 'account' ? db.accounts : a.sourceKind === 'investment' ? db.investments : db.assets).find((x) => x.id === a.sourceId)?.name ?? 'Removed item';
      row = { kind: a.sourceKind, id: a.sourceId, name, label: !a.sourceKind ? 'older entry' : a.sourceKind === 'account' ? 'cash / bank' : a.sourceKind === 'investment' ? 'investment' : 'asset', amount: 0 };
      m.set(key, row);
    }
    row.amount += a.amount;
  }
  return [...m.values()].filter((r) => r.amount !== 0).sort((a, b) => b.amount - a.amount);
}

export function validateAllocation(a: GoalAllocation, db: Database): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  const g = db.goals.find((x) => x.id === a.goalId);
  if (!g) out.push({ field: 'goalId', message: 'Goal not found' });
  if (!Number.isInteger(a.amount) || a.amount === 0) out.push({ field: 'amount', message: 'Enter an amount' });
  if (g && goalAllocated(db, g.id) + a.amount < 0) out.push({ field: 'amount', message: 'Cannot release more than is allocated' });
  if (!!a.sourceKind !== !!a.sourceId) out.push({ field: 'source', message: 'Choose where this money comes from' });
  if (a.sourceKind && a.sourceId) {
    if (!isEligibleSource(db, a.sourceKind, a.sourceId)) out.push({ field: 'source', message: 'That money can’t be used for goals (EPF/PPF and credit cards are excluded)' });
    else if (g && a.id !== undefined) {
      const fromSource = db.goalAllocations.filter((x) => x.goalId === g.id && x.sourceKind === a.sourceKind && x.sourceId === a.sourceId && x.id !== a.id).reduce((s, x) => s + x.amount, 0);
      if (fromSource + a.amount < 0) out.push({ field: 'source', message: 'This goal doesn’t have that much set aside from this source' });
    }
  }
  return out;
}
