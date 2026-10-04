import { describe, expect, it } from 'vitest';
import { buildEmi, confirmInstalment, emiState, undoLastInstalment, validateEmi } from '../../src/domain/emi';
import { cardMetrics, rewardsEstimate } from '../../src/domain/cards';
import { accountBalances } from '../../src/domain/ledger';
import { summarizeMonth } from '../../src/domain/cashflow';
import { computeNetWorth } from '../../src/domain/networth';
import { db0, acct, card, txn, rs, NOW, uid } from '../helpers';
import type { Database, Emi } from '../../src/domain/types';

function addEmi(db: Database, cardId: string, o: Partial<Parameters<typeof buildEmi>[0]> = {}): Emi {
  const { emi } = buildEmi({ id: uid('emi'), now: NOW, name: 'Phone', cardAccountId: cardId, ownerId: 'p1', originalAmount: rs(50000), emiAmount: rs(5000), tenure: 10, startDate: '2026-01-05', ...o });
  db.emis.push(emi); return emi;
}
const today = '2026-03-10';

describe('EMI lifecycle', () => {
  it('new EMI: full tenure, outstanding = original, blocked as_paid', () => {
    const db = db0(); const cc = card(db); const e = addEmi(db, cc.id);
    const s = emiState(e);
    expect([s.monthsCompleted, s.monthsRemaining, s.outstanding, s.blocked, s.active]).toEqual([0, 10, rs(50000), rs(50000), true]);
    expect(s.totalInterestCost).toBe(0);
  });

  it('existing EMI: months completed + known outstanding; estimated when unknown', () => {
    const db = db0(); const cc = card(db);
    const known = addEmi(db, cc.id, { monthsCompleted: 4, outstanding: rs(31000) });
    expect(emiState(known).monthsRemaining).toBe(6); expect(emiState(known).outstanding).toBe(rs(31000));
    const est = buildEmi({ id: 'z', now: NOW, name: 'TV', cardAccountId: cc.id, ownerId: 'p1', originalAmount: rs(50000), emiAmount: rs(5000), tenure: 10, startDate: '2025-11-05', monthsCompleted: 4 });
    expect(est.outstandingEstimated).toBe(true); expect(est.emi.outstandingAtEntry).toBe(rs(30000));
  });

  it('confirming instalments reduces months/outstanding; final one clears exactly and completes', () => {
    const db = db0(); const cc = card(db);
    let e = addEmi(db, cc.id, { originalAmount: 100000, emiAmount: 33334, tenure: 3 }); // 1000.00 in paise; rounding case
    const principals: number[] = [];
    for (let k = 0; k < 3; k++) {
      const due = emiState(e).nextDueDate!;
      const r = confirmInstalment(e, { dueDate: due, date: due, id: uid('p'), now: NOW });
      e = r.emi!; principals.push(e.payments[e.payments.length - 1].principal);
    }
    expect(principals.reduce((a, b) => a + b, 0)).toBe(100000);
    const s = emiState(e);
    expect([s.completed, s.monthsRemaining, s.outstanding, s.blocked, s.active, s.nextDueDate]).toEqual([true, 0, 0, 0, false, null]);
    expect(e.status).toBe('completed');
    expect(confirmInstalment(e, { dueDate: '2030-01-01', date: '2030-01-01', id: 'q', now: NOW }).error).toBeTruthy();
  });

  it('rejects duplicate confirmation of the same due date; undo restores active', () => {
    const db = db0(); const cc = card(db); let e = addEmi(db, cc.id, { tenure: 2, originalAmount: rs(10000), emiAmount: rs(5000) });
    const due = emiState(e).nextDueDate!;
    e = confirmInstalment(e, { dueDate: due, date: due, id: 'a', now: NOW }).emi!;
    expect(confirmInstalment(e, { dueDate: due, date: due, id: 'b', now: NOW }).error).toBeTruthy();
    e = confirmInstalment(e, { dueDate: emiState(e).nextDueDate!, date: due, id: 'c', now: NOW }).emi!;
    expect(e.status).toBe('completed');
    e = undoLastInstalment(e, NOW);
    expect(e.status).toBe('active'); expect(emiState(e).monthsRemaining).toBe(1);
  });

  it('EMI instalment confirmation creates NO expense and no net-worth change', () => {
    const db = db0(); const cc = card(db, rs(150000), rs(50000));
    let e = addEmi(db, cc.id); const txnCount = db.transactions.length;
    const nw = computeNetWorth(db, 'household').net; const sp = summarizeMonth(db.transactions, '2026-03').spending;
    e = confirmInstalment(e, { dueDate: '2026-03-05', date: '2026-03-05', id: 'p', now: NOW }).emi!;
    expect(db.transactions.length).toBe(txnCount);
    expect(computeNetWorth(db, 'household').net).toBe(nw);
    expect(summarizeMonth(db.transactions, '2026-03').spending).toBe(sp);
  });

  it('validation', () => {
    const db = db0(); const cc = card(db);
    const e = addEmi(db, cc.id);
    expect(validateEmi(e)).toEqual([]);
    expect(validateEmi({ ...e, tenure: 0 }).length).toBeGreaterThan(0);
    expect(validateEmi({ ...e, monthsCompletedAtEntry: 11 }).length).toBeGreaterThan(0);
    expect(validateEmi({ ...e, name: ' ' }).length).toBeGreaterThan(0);
  });
});

describe('credit card limits (spec example)', () => {
  it('limit 1.5L, EMI-linked 50k → available 1L; reduced available credit is not an expense', () => {
    const db = db0(); const cc = card(db, rs(150000), rs(50000)); // outstanding 50k is entirely the EMI
    addEmi(db, cc.id);
    const m = cardMetrics(db, cc, today);
    expect(m.emiBlocked).toBe(rs(50000)); expect(m.nonEmiOutstanding).toBe(0);
    expect(m.used).toBe(rs(50000)); expect(m.available).toBe(rs(100000));
    expect(m.availableSource).toBe('estimate'); expect(m.utilizationPct).toBeCloseTo(33.33, 1);
    expect(summarizeMonth(db.transactions, '2026-03').spending).toBe(0);
  });

  it('later: EMI outstanding 30k — as_paid releases 20k, on_completion does not (estimates differ)', () => {
    const db = db0(); const cc = card(db, rs(150000), rs(30000));
    const paid = addEmi(db, cc.id, { monthsCompleted: 4, outstanding: rs(30000), blockPolicy: 'as_paid' });
    expect(cardMetrics(db, cc, today).available).toBe(rs(120000));
    paid.blockPolicy = 'on_completion';
    expect(cardMetrics(db, cc, today).available).toBe(rs(100000));
    paid.blockedOverride = rs(35000);
    expect(cardMetrics(db, cc, today).available).toBe(rs(115000));
  });

  it('bank-reported available limit overrides estimate; later activity adjusts it', () => {
    const db = db0(); const bank = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(100000) }); const cc = card(db, rs(150000), rs(50000)); addEmi(db, cc.id);
    db.cardReports.push({ id: 'r1', accountId: cc.id, date: '2026-03-01', source: 'app', availableLimit: rs(95000), outstanding: rs(50000), createdAt: NOW, updatedAt: NOW });
    let m = cardMetrics(db, cc, today);
    expect(m.available).toBe(rs(95000)); expect(m.availableSource).toBe('bank'); expect(m.used).toBe(rs(55000)); expect(m.laterActivityCount).toBe(0);
    txn(db, { type: 'expense', amount: rs(5000), date: '2026-03-05', fromAccountId: cc.id, categoryId: 'cat_other' });
    txn(db, { type: 'cc_settlement', amount: rs(2000), date: '2026-03-06', fromAccountId: bank.id, toAccountId: cc.id });
    m = cardMetrics(db, cc, today);
    expect(m.available).toBe(rs(92000)); expect(m.outstanding).toBe(rs(53000)); expect(m.laterActivityCount).toBe(2);
    expect(m.estimate.available).not.toBe(m.available);
  });

  it('non-EMI vs EMI outstanding split; purchase + settlement + completed EMI', () => {
    const db = db0(); const bank = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(500000) }); const cc = card(db, rs(150000), 0);
    txn(db, { type: 'expense', amount: rs(60000), fromAccountId: cc.id, categoryId: 'cat_shopping', date: '2026-01-05' }); // the EMI purchase, recorded once
    let e = addEmi(db, cc.id, { originalAmount: rs(60000), emiAmount: rs(30000), tenure: 2 });
    txn(db, { type: 'expense', amount: rs(4000), fromAccountId: cc.id, categoryId: 'cat_food' });
    let m = cardMetrics(db, cc, today);
    expect([m.outstanding, m.emiOutstanding, m.nonEmiOutstanding]).toEqual([rs(64000), rs(60000), rs(4000)]);
    // settle bill containing instalment + normal spend; confirm instalment (no txn)
    txn(db, { type: 'cc_settlement', amount: rs(34000), fromAccountId: bank.id, toAccountId: cc.id });
    e = confirmInstalment(e, { dueDate: '2026-01-05', date: '2026-02-05', id: 'a', now: NOW }).emi!; db.emis[0] = e;
    m = cardMetrics(db, cc, today);
    expect([m.outstanding, m.emiOutstanding, m.nonEmiOutstanding, m.used]).toEqual([rs(30000), rs(30000), 0, rs(30000)]);
    txn(db, { type: 'cc_settlement', amount: rs(30000), fromAccountId: bank.id, toAccountId: cc.id });
    e = confirmInstalment(e, { dueDate: '2026-02-05', date: '2026-03-05', id: 'b', now: NOW }).emi!; db.emis[0] = e;
    m = cardMetrics(db, cc, today);
    expect([m.outstanding, m.emiOutstanding, m.emiBlocked, m.used, m.available, m.activeEmiCount]).toEqual([0, 0, 0, 0, rs(150000), 0]);
    expect(accountBalances(db).get(cc.id)).toBe(0);
    // principal spent exactly once
    expect(summarizeMonth(db.transactions, '2026-01').spending).toBe(rs(60000));
    expect(db.transactions.filter((t) => t.type === 'expense').length).toBe(2);
  });

  it('over-limit flagged; never negative available', () => {
    const db = db0(); const cc = card(db, rs(10000), rs(12000));
    const m = cardMetrics(db, cc, today);
    expect(m.available).toBe(0); expect(m.overLimit).toBe(true);
  });

  it('due date / statement date upcoming; rewards need a user rule', () => {
    const db = db0(); const cc = card(db);
    const m = cardMetrics(db, cc, today);
    expect(m.nextDueDate).toBe('2026-04-05'); expect(m.nextStatementDate).toBe('2026-03-20');
    expect(rewardsEstimate(db, cc, '2026-03')).toBeNull();
    cc.card!.rewards = { pointsPerBlock: 4, blockAmount: rs(150), pointValue: 50, excludedCategoryIds: ['cat_fees'] };
    txn(db, { type: 'expense', amount: rs(1500), fromAccountId: cc.id, categoryId: 'cat_shopping' });
    txn(db, { type: 'expense', amount: rs(1500), fromAccountId: cc.id, categoryId: 'cat_fees' });
    expect(rewardsEstimate(db, cc, '2026-03')).toEqual({ eligibleSpend: rs(1500), points: 40, value: 2000 });
  });
});
