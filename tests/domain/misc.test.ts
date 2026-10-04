import { describe, expect, it } from 'vitest';
import { holdingValue, holdingHistory } from '../../src/domain/holdings';
import { debtOverview, liabilityOutstanding, remainingMonths, summarizeLiability } from '../../src/domain/liabilities';
import { computeNetWorth, buildSnapshot, snapshotSeries } from '../../src/domain/networth';
import { goalProgress, unallocatedLiquid, validateAllocation } from '../../src/domain/goals';
import { wasteMonth, recurringWaste, wasteTrend } from '../../src/domain/waste';
import { expectedOccurrences, occurrenceDates, draftFromOccurrence, upcomingCommitments } from '../../src/domain/expected';
import { projectMonthEnd, summarizeMonth, scopedTxns, compareMonth } from '../../src/domain/cashflow';
import { accountBalances } from '../../src/domain/ledger';
import { db0, acct, txn, inv, asset, val, loan, goal, expected, rs, NOW, uid } from '../helpers';

describe('investments & assets', () => {
  it('gain/loss and % from snapshot; contributions after snapshot add at cost; before are ignored', () => {
    const db = db0(); const b = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(1e6) }); const i = inv(db);
    val(db, 'investment', i.id, '2026-02-01', rs(120000), rs(100000));
    txn(db, { type: 'investment_contribution', amount: rs(9999), date: '2026-01-15', fromAccountId: b.id, investmentId: i.id }); // pre-snapshot: inside snapshot already
    txn(db, { type: 'investment_contribution', amount: rs(10000), date: '2026-03-01', fromAccountId: b.id, investmentId: i.id });
    const h = holdingValue(db, 'investment', i.id);
    expect(h.value).toBe(rs(130000)); expect(h.invested).toBe(rs(110000)); expect(h.gain).toBe(rs(20000)); expect(h.gainPct).toBeCloseTo(18.18, 1);
  });
  it('redemption reduces value and proportional cost; loss shows negative', () => {
    const db = db0(); const b = acct(db, { name: 'S', kind: 'bank' }); const i = inv(db);
    val(db, 'investment', i.id, '2026-02-01', rs(80000), rs(100000));
    txn(db, { type: 'investment_redemption', amount: rs(40000), toAccountId: b.id, investmentId: i.id });
    const h = holdingValue(db, 'investment', i.id);
    expect([h.value, h.invested, h.gain]).toEqual([rs(40000), rs(50000), -rs(10000)]);
    expect(accountBalances(db).get(b.id)).toBe(rs(40000));
  });
  it('asset valuation, ownership split, history only from real snapshots', () => {
    const db = db0(); const a = asset(db, { kind: 'property', ownerId: 'p2' }); const g = asset(db, { kind: 'gold', ownerId: 'p1' });
    val(db, 'asset', a.id, '2026-01-01', rs(4000000)); val(db, 'asset', a.id, '2026-03-01', rs(4200000)); val(db, 'asset', g.id, '2026-03-01', rs(300000));
    expect(computeNetWorth(db, 'p2').assets.property).toBe(rs(4200000));
    expect(computeNetWorth(db, 'p1').assets.property).toBe(0);
    expect(computeNetWorth(db, 'household').net).toBe(rs(4500000));
    expect(computeNetWorth(db, 'household', '2026-02-01').assets.property).toBe(rs(4000000));
    expect(holdingHistory(db, 'asset', a.id).length).toBe(2);
  });
  it('net worth snapshots by owner sum exactly to household', () => {
    const db = db0(); acct(db, { name: 'A', kind: 'bank', ownerId: 'p1', openingBalance: rs(100) }); acct(db, { name: 'B', kind: 'bank', ownerId: 'p2', openingBalance: rs(200) }); acct(db, { name: 'J', kind: 'bank', ownerId: 'hh', openingBalance: rs(50) });
    db.snapshots.push(buildSnapshot(db, '2026-03-01', 's1', NOW));
    expect(snapshotSeries(db, 'household')[0].net).toBe(rs(350)); expect(snapshotSeries(db, 'p2')[0].net).toBe(rs(200));
  });
});

describe('loans', () => {
  it('zero-interest: payments reduce outstanding, completion, debt-free date', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(1e6) });
    const l = loan(db, { baselineOutstanding: rs(30000), emi: rs(10000), paymentDay: 5 });
    expect(summarizeLiability(db, l, '2026-03-10').monthsLeft).toBe(3);
    txn(db, { type: 'liability_payment', amount: rs(10000), fromAccountId: s.id, liabilityId: l.id, date: '2026-03-05' });
    expect(liabilityOutstanding(db, l)).toBe(rs(20000));
    expect(debtOverview(db, '2026-03-10')).toMatchObject({ totalDebt: rs(20000), monthlyCommitment: rs(10000), projectedDebtFree: '2026-05-10' });
    txn(db, { type: 'liability_payment', amount: rs(20000), fromAccountId: s.id, liabilityId: l.id, date: '2026-03-20' });
    const sum = summarizeLiability(db, l, '2026-03-21');
    expect([sum.completed, sum.outstanding, sum.monthsLeft]).toEqual([true, 0, 0]);
    expect(debtOverview(db, '2026-03-21').totalDebt).toBe(0);
  });
  it('payments dated before baseline are ignored; overpay clamps at zero', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank' }); const l = loan(db, { baselineOutstanding: rs(1000), baselineDate: '2026-03-01' });
    txn(db, { type: 'liability_payment', amount: rs(500), date: '2026-02-01', fromAccountId: s.id, liabilityId: l.id });
    txn(db, { type: 'liability_payment', amount: rs(5000), date: '2026-03-02', fromAccountId: s.id, liabilityId: l.id });
    expect(liabilityOutstanding(db, l)).toBe(0);
  });
  it('interest-bearing tenure & non-amortising EMI', () => {
    expect(remainingMonths(rs(100000), rs(10000), 12)).toBe(11);
    expect(remainingMonths(rs(100000), rs(500), 12)).toBeNull();
    expect(remainingMonths(rs(100000), 0, 0)).toBeNull(); expect(remainingMonths(0, 0, 0)).toBe(0);
  });
  it('closed loans excluded from debt and net worth; unknown payoff reported', () => {
    const db = db0(); loan(db, { status: 'closed' }); loan(db, { emi: 0 });
    expect(computeNetWorth(db, 'household').liabilities.loans).toBe(rs(100000));
    expect(debtOverview(db, '2026-03-10').debtFreeUnknown).toBe(true);
  });
});

describe('goals', () => {
  it('allocation progress, release, no effect on balances/net worth, unallocated cash warning', () => {
    const db = db0(); acct(db, { name: 'S', kind: 'bank', ownerId: 'hh', openingBalance: rs(100000) });
    const g = goal(db, { targetAmount: rs(300000), targetDate: '2026-09-10' });
    const nw = computeNetWorth(db, 'household').net;
    db.goalAllocations.push({ id: 'a1', goalId: g.id, date: '2026-03-01', amount: rs(60000), ownerId: 'hh', createdAt: NOW, updatedAt: NOW });
    expect(computeNetWorth(db, 'household').net).toBe(nw);
    const p = goalProgress(db, g, '2026-03-10');
    expect(p.pct).toBe(20); expect(p.remaining).toBe(rs(240000)); expect(p.monthsLeft).toBe(6); expect(p.requiredMonthly).toBe(rs(40000));
    expect(unallocatedLiquid(db, 'household')).toEqual({ liquid: rs(100000), allocated: rs(60000), unallocated: rs(40000) });
    db.goalAllocations.push({ id: 'a2', goalId: g.id, date: '2026-03-02', amount: rs(60000), ownerId: 'hh', createdAt: NOW, updatedAt: NOW });
    expect(unallocatedLiquid(db, 'household').unallocated).toBe(-rs(20000));
    expect(validateAllocation({ id: 'x', goalId: g.id, date: '2026-03-03', amount: -rs(200000), ownerId: 'hh', createdAt: '', updatedAt: '' }, db).length).toBe(1);
  });
  it('household vs individual scope separation; overfunded caps at 100%', () => {
    const db = db0(); acct(db, { name: 'W', kind: 'bank', ownerId: 'p2', openingBalance: rs(20000) });
    const own = goal(db, { ownerId: 'p2', targetAmount: rs(10000) }); const hh = goal(db, { ownerId: 'hh' });
    db.goalAllocations.push({ id: 'a', goalId: own.id, date: '2026-03-01', amount: rs(12000), ownerId: 'p2', createdAt: NOW, updatedAt: NOW });
    db.goalAllocations.push({ id: 'b', goalId: hh.id, date: '2026-03-01', amount: rs(5000), ownerId: 'hh', createdAt: NOW, updatedAt: NOW });
    expect(goalProgress(db, own, '2026-03-10')).toMatchObject({ pct: 100, achieved: true });
    expect(unallocatedLiquid(db, 'p2').allocated).toBe(rs(12000));
    expect(unallocatedLiquid(db, 'household').allocated).toBe(rs(17000));
    expect(unallocatedLiquid(db, 'p1').allocated).toBe(0);
  });
});

describe('waste', () => {
  it('monthly totals, categories, rates, patterns; never affects spending or net worth', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(1e5) });
    txn(db, { type: 'expense', amount: rs(6000), fromAccountId: s.id, categoryId: 'cat_groceries' });
    txn(db, { type: 'expense', amount: rs(4000), fromAccountId: s.id, categoryId: 'cat_shopping' });
    const w = (date: string, item: string, cost: number, category: any, ownerId: any = 'p1') => db.wasteEntries.push({ id: uid('w'), date, item, cost: rs(cost), category, ownerId, createdAt: NOW, updatedAt: NOW });
    w('2026-03-02', 'Spinach', 120, 'groceries'); w('2026-03-05', 'Leftover curry', 300, 'food', 'p2'); w('2026-03-09', 'Gadget', 580, 'unused'); w('2026-02-09', 'Spinach', 100, 'groceries');
    const nw = computeNetWorth(db, 'household').net; const sp = summarizeMonth(db.transactions, '2026-03').spending;
    const m = wasteMonth(db, 'household', '2026-03');
    expect(m.total).toBe(rs(1000)); expect(m.count).toBe(3); expect(m.byCategory[0]).toEqual({ category: 'unused', amount: rs(580) });
    expect(m.rateOfSpending).toBeCloseTo(10, 5); expect(m.foodWasteRate).toBeCloseTo(7, 5); // (120+300)/6000
    expect(wasteMonth(db, 'p2', '2026-03').total).toBe(rs(300));
    expect(wasteTrend(db, 'household', '2026-03', 2).map((x) => x.total)).toEqual([rs(100), rs(1000)]);
    expect(recurringWaste(db, 'household')).toEqual([{ item: 'Spinach', months: 2, total: rs(220), count: 2 }]);
    expect(computeNetWorth(db, 'household').net).toBe(nw); expect(summarizeMonth(db.transactions, '2026-03').spending).toBe(sp);
  });
  it('empty month has zero rates (no division errors)', () => {
    const m = wasteMonth(db0(), 'household', '2026-03'); expect([m.total, m.rateOfSpending, m.foodWasteRate]).toEqual([0, 0, 0]);
  });
});

describe('expected / recurring items', () => {
  it('occurrence generation incl. month-end clamping, weekly, yearly, end date', () => {
    const db = db0();
    const m = expected(db, { startDate: '2026-01-31' });
    expect(occurrenceDates(m, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDates(expected(db, { frequency: 'weekly', startDate: '2026-03-02' }), '2026-03-01', '2026-03-31').length).toBe(5);
    expect(occurrenceDates(expected(db, { frequency: 'yearly', startDate: '2024-02-29' }), '2026-01-01', '2026-12-31')).toEqual(['2026-02-28']);
    expect(occurrenceDates(expected(db, { endDate: '2026-02-20' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
  });
  it('never fabricates transactions; confirm/skip/stop states', () => {
    const db = db0(); const e = expected(db, { startDate: '2026-03-15' });
    expect(db.transactions.length).toBe(0);
    let occ = expectedOccurrences(db, 'household', '2026-03-01', '2026-04-30', '2026-03-20');
    expect(occ.map((o) => [o.date, o.state, o.overdue])).toEqual([['2026-03-15', 'pending', true], ['2026-04-15', 'pending', false]]);
    const t = txn(db, { type: 'expense', amount: e.amount, date: '2026-03-15', fromAccountId: 'x', categoryId: 'cat_subscriptions', expectedItemId: e.id });
    e.confirmed['2026-03-15'] = t.id; e.skipped.push('2026-04-15');
    occ = expectedOccurrences(db, 'household', '2026-03-01', '2026-04-30', '2026-03-20');
    expect(occ.map((o) => o.state)).toEqual(['confirmed', 'skipped']);
    db.transactions.pop(); // user deletes the txn → occurrence reverts to pending
    expect(expectedOccurrences(db, 'household', '2026-03-01', '2026-03-31', '2026-03-20')[0].state).toBe('pending');
    e.status = 'stopped'; e.endDate = '2026-03-20';
    expect(expectedOccurrences(db, 'household', '2026-03-01', '2026-06-30', '2026-03-20').length).toBe(1);
  });
  it('drafts map to the right event types (salary→income, SIP→contribution, subscription→expense)', () => {
    const db = db0();
    expect(draftFromOccurrence(expected(db, { kind: 'salary', accountId: 'a' }), '2026-03-01').type).toBe('income');
    expect(draftFromOccurrence(expected(db, { kind: 'sip', accountId: 'a', investmentId: 'i' }), '2026-03-01')).toMatchObject({ type: 'investment_contribution', investmentId: 'i', fromAccountId: 'a' });
    expect(draftFromOccurrence(expected(db, { kind: 'subscription', accountId: 'a' }), '2026-03-01').type).toBe('expense');
  });
  it('commitments include SIPs/EMIs/loans only as pending, never as actual transactions', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank' });
    expected(db, { kind: 'sip', name: 'SIP', amount: rs(5000), startDate: '2026-03-12', accountId: s.id });
    expected(db, { kind: 'salary', name: 'Salary', amount: rs(1e5), startDate: '2026-03-31' });
    loan(db, { emi: rs(8000), paymentDay: 15, baselineOutstanding: rs(40000) });
    const c = upcomingCommitments(db, 'household', '2026-03-10', '2026-03-31', '2026-03-10');
    expect(c.map((x) => [x.kind, x.name])).toEqual([['expected', 'SIP'], ['loan', 'Education loan']]);
    expect(db.transactions.length).toBe(0);
  });
});

describe('savings', () => {
  it('monthly savings, rate, target variance, projection with expected items', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(1e5) });
    txn(db, { type: 'income', amount: rs(100000), date: '2026-03-01', toAccountId: s.id, incomeType: 'Salary' });
    for (let d = 1; d <= 10; d++) txn(db, { type: 'expense', amount: rs(1000), date: `2026-03-${String(d).padStart(2, '0')}`, fromAccountId: s.id, categoryId: 'cat_food' });
    expected(db, { startDate: '2026-03-20', amount: rs(500) });
    const m = summarizeMonth(scopedTxns(db, 'household'), '2026-03');
    expect([m.income, m.spending, m.savings, m.savingsRate]).toEqual([rs(100000), rs(10000), rs(90000), 90]);
    const p = projectMonthEnd(db, 'household', '2026-03', '2026-03-10');
    // pace 1000/day for 21 remaining days + 500 expected
    expect(p.variableRemaining).toBe(rs(21000)); expect(p.expectedFixedRemaining).toBe(rs(500));
    expect(p.projectedSavings).toBe(rs(100000 - 10000 - 21000 - 500));
    expect(p.gap).toBe(rs(60000) - p.projectedSavings); expect(p.onTrack).toBe(true); expect(p.assumptions.length).toBeGreaterThan(0);
  });
  it('spec example: target 60k, projected 47.5k → gap 12.5k; one-off purchases excluded from pace; month note surfaced', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank' });
    db.settings.monthNotes['2026-10'] = 'Durga Puja';
    txn(db, { type: 'income', amount: rs(100000), date: '2026-10-01', toAccountId: s.id });
    txn(db, { type: 'expense', amount: rs(40000), date: '2026-10-02', fromAccountId: s.id, categoryId: 'cat_gifts', oneOff: true });
    txn(db, { type: 'expense', amount: rs(1000), date: '2026-10-03', fromAccountId: s.id, categoryId: 'cat_food' });
    // day 10 of 31, variable 1000 so far → 100/day*21=2100 ; savings = 100000-41000-2100
    const p = projectMonthEnd(db, 'household', '2026-10', '2026-10-10');
    expect(p.variableDailyPace).toBe(rs(100)); expect(p.projectedSavings).toBe(rs(100000 - 41000 - 2100));
    expect(p.monthNote).toBe('Durga Puja'); expect(p.gap).toBe(rs(60000) - p.projectedSavings);
    expect(p.onTrack).toBe(false);
  });
  it('person targets, completed month is actual, empty ledger safe', () => {
    const db = db0();
    expect(projectMonthEnd(db, 'p2', '2026-03', '2026-03-10').target).toBe(rs(10000));
    expect(projectMonthEnd(db, 'household', '2026-02', '2026-03-10')).toMatchObject({ isCurrent: false, projectedSavings: 0, gap: rs(60000) });
    const p = projectMonthEnd(db, 'household', '2026-03', '2026-03-10'); expect(p.projectedSavings).toBe(0);
  });
  it('comparisons: vs previous and average, no divide-by-zero', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank' });
    for (const [m, a] of [['2026-01', 1000], ['2026-02', 2000], ['2026-03', 3000]] as const) txn(db, { type: 'expense', amount: rs(a), date: `${m}-05`, fromAccountId: s.id, categoryId: 'cat_other' });
    const c = compareMonth(db.transactions, '2026-03', (x) => x.spending);
    expect(c.previous).toBe(rs(2000)); expect(c.vsPrevPct).toBe(50); expect(c.average).toBe(Math.round(rs(3000) / 3)); 
    expect(compareMonth(db.transactions, '2026-01', (x) => x.spending).vsPrevPct).toBeNull();
  });
});

describe('projection does not double count manually logged recurring items', () => {
  it('salary logged by hand is not added again; unlogged one is', () => {
    const db = db0(); const s = acct(db, { name: 'S', kind: 'bank' });
    expected(db, { kind: 'salary', name: 'Salary', amount: rs(100000), startDate: '2026-03-01', accountId: s.id, incomeType: 'Salary' });
    expected(db, { kind: 'subscription', name: 'Netflix', merchant: 'Netflix', amount: rs(649), startDate: '2026-03-05' });
    txn(db, { type: 'income', amount: rs(100000), date: '2026-03-01', toAccountId: s.id, incomeType: 'Salary' });
    txn(db, { type: 'expense', amount: rs(649), date: '2026-03-05', fromAccountId: s.id, categoryId: 'cat_subscriptions', merchant: 'Netflix' });
    let p = projectMonthEnd(db, 'household', '2026-03', '2026-03-10');
    expect([p.expectedIncomeRemaining, p.expectedFixedRemaining]).toEqual([0, 0]);
    db.transactions.pop(); // Netflix not yet logged
    p = projectMonthEnd(db, 'household', '2026-03', '2026-03-10');
    expect(p.expectedFixedRemaining).toBe(rs(649));
  });
});
