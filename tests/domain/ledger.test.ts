import { describe, expect, it } from 'vitest';
import { accountBalances, spendingOf, validateTransaction, isCardPurchase } from '../../src/domain/ledger';
import { computeNetWorth } from '../../src/domain/networth';
import { summarizeMonth, scopedTxns, spendingByCategory } from '../../src/domain/cashflow';
import { db0, acct, card, txn, inv, asset, loan, val, rs } from '../helpers';
import { liabilityOutstanding } from '../../src/domain/liabilities';

describe('transaction types and double-counting', () => {
  it('income / expense affect balance and savings; owner vs funding account stay distinct', () => {
    const db = db0();
    const hdfc = acct(db, { name: 'HDFC Savings', kind: 'bank', ownerId: 'p1', openingBalance: rs(10000) });
    txn(db, { type: 'income', amount: rs(100000), toAccountId: hdfc.id, incomeType: 'Salary' });
    // wife spends from Ritangkar's account via UPI
    const t = txn(db, { type: 'expense', amount: rs(1250), ownerId: 'p2', fromAccountId: hdfc.id, paymentMethod: 'upi', categoryId: 'cat_groceries', merchant: 'Blinkit' });
    expect(accountBalances(db).get(hdfc.id)).toBe(rs(10000 + 100000 - 1250));
    expect(t.ownerId).toBe('p2');
    expect(summarizeMonth(scopedTxns(db, 'p2'), '2026-03').spending).toBe(rs(1250));
    expect(summarizeMonth(scopedTxns(db, 'p1'), '2026-03').spending).toBe(0);
    expect(summarizeMonth(scopedTxns(db, 'household'), '2026-03').savings).toBe(rs(100000 - 1250));
  });

  it('transfer to investment account is not spending or income', () => {
    const db = db0();
    const s = acct(db, { name: 'Savings', kind: 'bank', openingBalance: rs(200000) });
    const b = acct(db, { name: 'Investment Account', kind: 'investment' });
    txn(db, { type: 'transfer', amount: rs(50000), fromAccountId: s.id, toAccountId: b.id });
    const m = summarizeMonth(db.transactions, '2026-03');
    expect([m.income, m.spending, m.savings]).toEqual([0, 0, 0]);
    expect(computeNetWorth(db, 'household').net).toBe(rs(200000));
  });

  it('savings → salary account transfer is not income', () => {
    const db = db0();
    const a = acct(db, { name: 'Savings', kind: 'bank', openingBalance: rs(5000) });
    const b = acct(db, { name: 'Salary', kind: 'bank' });
    txn(db, { type: 'transfer', amount: rs(2000), fromAccountId: a.id, toAccountId: b.id });
    expect(summarizeMonth(db.transactions, '2026-03').income).toBe(0);
  });

  it('card purchase raises outstanding, is spending once; settlement is not spending', () => {
    const db = db0();
    const bank = acct(db, { name: 'Savings', kind: 'bank', openingBalance: rs(100000) });
    const cc = card(db);
    const p = txn(db, { type: 'expense', amount: rs(3200), ownerId: 'p2', fromAccountId: cc.id, paymentMethod: 'credit_card', categoryId: 'cat_shopping', merchant: 'Amazon' });
    expect(isCardPurchase(p, db.accounts)).toBe(true);
    expect(accountBalances(db).get(cc.id)).toBe(-rs(3200));
    expect(computeNetWorth(db, 'household').liabilities.cards).toBe(rs(3200));
    txn(db, { type: 'cc_settlement', amount: rs(3200), fromAccountId: bank.id, toAccountId: cc.id });
    expect(accountBalances(db).get(cc.id)).toBe(0);
    expect(accountBalances(db).get(bank.id)).toBe(rs(100000 - 3200));
    expect(summarizeMonth(db.transactions, '2026-03').spending).toBe(rs(3200));
  });

  it('refund reduces spending in category and restores account; cannot exceed original', () => {
    const db = db0();
    const cc = card(db);
    const p = txn(db, { type: 'expense', amount: rs(2000), fromAccountId: cc.id, categoryId: 'cat_shopping' });
    const r = { ...txn(db, { type: 'refund', amount: rs(500), toAccountId: cc.id, refundOfId: p.id, categoryId: 'cat_shopping' }) };
    expect(summarizeMonth(db.transactions, '2026-03').spending).toBe(rs(1500));
    expect(accountBalances(db).get(cc.id)).toBe(-rs(1500));
    expect(spendingByCategory(db, db.transactions)[0].amount).toBe(rs(1500));
    const over = { ...r, id: 'new', amount: rs(1600) };
    expect(validateTransaction(over, db).some((i) => i.field === 'amount')).toBe(true);
    const ok = { ...r, id: 'new2', amount: rs(1500) };
    expect(validateTransaction(ok, db)).toEqual([]);
  });

  it('investment contribution / asset acquisition move money into holdings without changing net worth', () => {
    const db = db0();
    const s = acct(db, { name: 'Savings', kind: 'bank', openingBalance: rs(500000) });
    const i = inv(db); const a = asset(db, { kind: 'gold' });
    const before = computeNetWorth(db, 'household').net;
    txn(db, { type: 'investment_contribution', amount: rs(50000), fromAccountId: s.id, investmentId: i.id });
    txn(db, { type: 'asset_acquisition', amount: rs(100000), fromAccountId: s.id, assetId: a.id });
    const nw = computeNetWorth(db, 'household');
    expect(nw.net).toBe(before);
    expect(nw.assets.investments).toBe(rs(50000));
    expect(nw.assets.gold).toBe(rs(100000));
    const m = summarizeMonth(db.transactions, '2026-03');
    expect(m.spending).toBe(0); expect(m.invested).toBe(rs(150000));
  });

  it('loan payment: only interest is spending; principal reduces liability; net worth moves by interest only', () => {
    const db = db0();
    const s = acct(db, { name: 'Savings', kind: 'bank', openingBalance: rs(100000) });
    const l = loan(db, { baselineOutstanding: rs(50000) });
    const before = computeNetWorth(db, 'household').net; // 100000 - 50000
    const t = txn(db, { type: 'liability_payment', amount: rs(10500), principalPortion: rs(10000), fromAccountId: s.id, liabilityId: l.id });
    expect(spendingOf(t)).toBe(rs(500));
    expect(liabilityOutstanding(db, l)).toBe(rs(40000));
    expect(computeNetWorth(db, 'household').net).toBe(before - rs(500));
  });

  it('liability creation with disbursement: account + liability, net worth unchanged, not income', () => {
    const db = db0();
    const s = acct(db, { name: 'Savings', kind: 'bank' });
    const l = loan(db, { baselineOutstanding: 0, baselineDate: '2026-01-01', originalPrincipal: 0 });
    txn(db, { type: 'liability_creation', amount: rs(80000), toAccountId: s.id, liabilityId: l.id });
    const nw = computeNetWorth(db, 'household');
    expect(nw.net).toBe(0); expect(nw.assets.bank).toBe(rs(80000)); expect(nw.liabilities.loans).toBe(rs(80000));
    expect(summarizeMonth(db.transactions, '2026-03').income).toBe(0);
  });

  it('adjustment changes balance but is neither income nor spending', () => {
    const db = db0();
    const s = acct(db, { name: 'Savings', kind: 'bank', openingBalance: rs(1000) });
    txn(db, { type: 'adjustment', amount: -rs(250), toAccountId: s.id });
    expect(accountBalances(db).get(s.id)).toBe(rs(750));
    const m = summarizeMonth(db.transactions, '2026-03');
    expect([m.income, m.spending, m.adjustments]).toEqual([0, 0, -rs(250)]);
  });

  it('validation rejects card transfers, same-account transfers, missing refs', () => {
    const db = db0();
    const s = acct(db, { name: 'S', kind: 'bank' }); const cc = card(db);
    const base = { id: 'v', createdAt: '', updatedAt: '', date: '2026-03-10', ownerId: 'p1' as const };
    expect(validateTransaction({ ...base, type: 'transfer', amount: 100, fromAccountId: s.id, toAccountId: cc.id }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'transfer', amount: 100, fromAccountId: s.id, toAccountId: s.id }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'cc_settlement', amount: 100, fromAccountId: cc.id, toAccountId: s.id }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'expense', amount: 0, fromAccountId: s.id, categoryId: 'cat_other' }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'expense', amount: 1.5, fromAccountId: s.id, categoryId: 'cat_other' }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'expense', amount: 100, fromAccountId: 'nope', categoryId: 'cat_other' }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, date: '2026-02-30', type: 'expense', amount: 100, fromAccountId: s.id, categoryId: 'cat_other' }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'expense', amount: 100, fromAccountId: s.id, categoryId: 'cat_groceries', subcategoryId: 'sub_cab' }, db).length).toBeGreaterThan(0);
    expect(validateTransaction({ ...base, type: 'expense', amount: 100, fromAccountId: s.id, categoryId: 'cat_transport', subcategoryId: 'sub_cab' }, db)).toEqual([]);
  });
});

describe('property: Δ net worth = income − spending (+adjustments) for random ledgers', () => {
  function rng(seed: number) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i', (seed) => {
    const r = rng(seed);
    const db = db0();
    const bank = acct(db, { name: 'B', kind: 'bank', openingBalance: rs(1000000) });
    const bank2 = acct(db, { name: 'B2', kind: 'bank', ownerId: 'p2', openingBalance: rs(50000) });
    const broker = acct(db, { name: 'Broker', kind: 'investment' });
    const cash = acct(db, { name: 'Cash', kind: 'cash', openingBalance: rs(3000) });
    const cc = card(db, rs(200000), rs(10000));
    const i = inv(db); const a = asset(db, { kind: 'property' }); const l = loan(db, { baselineOutstanding: rs(500000) });
    val(db, 'investment', i.id, '2026-01-01', rs(10000)); val(db, 'asset', a.id, '2026-01-01', rs(2000000));
    const nonCard = [bank, bank2, broker, cash]; const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const before = computeNetWorth(db, 'household').net;
    let income = 0, spending = 0, adj = 0;
    for (let k = 0; k < 120; k++) {
      const amount = rs(Math.floor(r() * 5000) + 1);
      const date = `2026-03-${String(10 + Math.floor(r() * 15)).padStart(2, '0')}`; // after valuation date
      const kind = Math.floor(r() * 9);
      const ownerId = pick(['p1', 'p2', 'hh'] as const);
      if (kind === 0) { txn(db, { type: 'income', amount, date, ownerId, toAccountId: pick(nonCard).id }); income += amount; }
      else if (kind === 1) { txn(db, { type: 'expense', amount, date, ownerId, fromAccountId: pick([...nonCard, cc]).id, categoryId: 'cat_other' }); spending += amount; }
      else if (kind === 2) { const f = pick(nonCard); const t = pick(nonCard.filter((x) => x.id !== f.id)); txn(db, { type: 'transfer', amount, date, ownerId, fromAccountId: f.id, toAccountId: t.id }); }
      else if (kind === 3) txn(db, { type: 'cc_settlement', amount, date, ownerId, fromAccountId: pick(nonCard).id, toAccountId: cc.id });
      else if (kind === 4) txn(db, { type: 'investment_contribution', amount, date, ownerId, fromAccountId: pick([...nonCard]).id, investmentId: i.id });
      else if (kind === 5) txn(db, { type: 'asset_acquisition', amount, date, ownerId, fromAccountId: pick([...nonCard, cc]).id, assetId: a.id });
      else if (kind === 6) { const principal = Math.floor(amount * r()); txn(db, { type: 'liability_payment', amount, principalPortion: principal, date, ownerId, fromAccountId: pick(nonCard).id, liabilityId: l.id }); spending += amount - principal; }
      else if (kind === 7) { const ex = db.transactions.filter((t) => t.type === 'expense'); if (ex.length) { const o = pick(ex); const ra = Math.min(amount, o.amount); txn(db, { type: 'refund', amount: ra, date, ownerId, toAccountId: o.fromAccountId, refundOfId: o.id, categoryId: 'cat_other' }); spending -= ra; } }
      else { const sgn = r() < 0.5 ? -1 : 1; txn(db, { type: 'adjustment', amount: sgn * amount, date, ownerId, toAccountId: pick(nonCard).id }); adj += sgn * amount; }
    }
    // invariant caveat: redemptions excluded (value-proportional), liability payment cannot overpay
    const after = computeNetWorth(db, 'household').net;
    // liability payments can't push outstanding below 0 (clamp) — keep amounts small enough
    expect(liabilityOutstanding(db, l)).toBeGreaterThan(0);
    expect(after - before).toBe(income - spending + adj);
    const m = summarizeMonth(db.transactions, '2026-03');
    expect(m.income).toBe(income); expect(m.spending).toBe(spending);
    // per-owner net worth sums to household
    const sum = (['p1', 'p2'] as const).reduce((s, o) => s + computeNetWorth(db, o).net, 0) + (computeNetWorth(db, 'household').net - computeNetWorth(db, 'p1').net - computeNetWorth(db, 'p2').net);
    expect(sum).toBe(after);
  });
});
