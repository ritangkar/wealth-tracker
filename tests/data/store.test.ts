import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Store } from '../../src/data/store';
import { MemoryStorage } from '../../src/data/storage';
import { IdbStorage } from '../../src/data/idb';
import { rs } from '../helpers';
import { computeNetWorth } from '../../src/domain/networth';
import { summarizeMonth } from '../../src/domain/cashflow';
import { accountBalances } from '../../src/domain/ledger';
import { expectedOccurrences } from '../../src/domain/expected';

let n = 0;
async function mk(storage = new MemoryStorage()) {
  const store = await Store.open(storage, { now: () => new Date(2026, 2, 10, 12), idGen: (p) => `${p}_${++n}` });
  return { store, storage };
}
const must = <T,>(r: { ok: boolean; value?: T; issues?: any }): T => { if (!r.ok) throw new Error(JSON.stringify((r as any).issues)); return (r as any).value; };

async function seedBasics(store: Store) {
  const bank = must(await store.addAccount({ name: 'HDFC Savings', kind: 'bank', ownerId: 'p1', openingBalance: rs(100000), openingDate: '2026-01-01' }));
  const cc = must(await store.addAccount({ name: 'HDFC Regalia Gold', kind: 'credit_card', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01', card: { creditLimit: rs(150000), dueDay: 5 } }));
  return { bank, cc };
}

describe('Store CRUD + persistence', () => {
  it('create / read / update / delete transaction with ownership preserved; persists through reopen', async () => {
    const { store, storage } = await mk(); const { bank } = await seedBasics(store);
    const t = must(await store.addTransaction({ type: 'expense', date: '2026-03-09', amount: rs(1250), ownerId: 'p2', fromAccountId: bank.id, paymentMethod: 'upi', categoryId: 'cat_groceries', subcategoryId: 'sub_online_grocery', merchant: 'Blinkit', tags: ['weekly'] }));
    expect(store.db.transactions).toHaveLength(1);
    expect(must(await store.updateTransaction(t.id, { amount: rs(1300), notes: 'x' })).amount).toBe(rs(1300));
    expect(accountBalances(store.db).get(bank.id)).toBe(rs(100000 - 1300));
    const reopened = (await Store.open(storage)).db; // storage reflects state
    expect(reopened.transactions[0]).toMatchObject({ ownerId: 'p2', fromAccountId: bank.id, paymentMethod: 'upi', merchant: 'Blinkit', notes: 'x' });
    await store.updateTransaction(t.id, { notes: undefined });
    expect(store.db.transactions[0].notes).toBeUndefined();
    expect((await store.deleteTransaction(t.id)).ok).toBe(true);
    expect(store.db.transactions).toHaveLength(0); expect(store.db.tombstones[0].key).toBe(`transactions:${t.id}`);
    expect(accountBalances(store.db).get(bank.id)).toBe(rs(100000));
  });

  it('rejects invalid input and leaves state untouched', async () => {
    const { store } = await mk(); const { bank, cc } = await seedBasics(store);
    const r = await store.addTransaction({ type: 'transfer', date: '2026-03-09', amount: rs(10), ownerId: 'p1', fromAccountId: bank.id, toAccountId: cc.id });
    expect(r.ok).toBe(false); expect(store.db.transactions).toHaveLength(0);
    expect((await store.addAccount({ name: ' ', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' })).ok).toBe(false);
    expect((await store.addAccount({ name: 'Card', kind: 'credit_card', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' })).ok).toBe(false);
  });

  it('storage failure rolls back in-memory state', async () => {
    const { store, storage } = await mk(); const { bank } = await seedBasics(store);
    storage.failNext = true;
    const r = await store.addTransaction({ type: 'expense', date: '2026-03-09', amount: rs(10), ownerId: 'p1', fromAccountId: bank.id, categoryId: 'cat_other' });
    expect(r.ok).toBe(false); expect(store.db.transactions).toHaveLength(0); expect(store.persistError).toBeTruthy();
  });

  it('refund constraints, delete protections, cascade of expected confirmations', async () => {
    const { store } = await mk(); const { bank } = await seedBasics(store);
    const p = must(await store.addTransaction({ type: 'expense', date: '2026-03-09', amount: rs(1000), ownerId: 'p1', fromAccountId: bank.id, categoryId: 'cat_shopping' }));
    const r = must(await store.addTransaction({ type: 'refund', date: '2026-03-10', amount: rs(400), ownerId: 'p1', toAccountId: bank.id, refundOfId: p.id }));
    expect((await store.deleteTransaction(p.id)).ok).toBe(false);
    expect((await store.updateTransaction(p.id, { amount: rs(300) })).ok).toBe(false);
    expect((await store.deleteAccount(bank.id)).ok).toBe(false);
    expect((await store.deleteCategory('cat_shopping')).ok).toBe(false);
    expect((await store.deleteTransaction(r.id)).ok).toBe(true);
    expect((await store.deleteTransaction(p.id)).ok).toBe(true);
    expect((await store.deleteAccount(bank.id)).ok).toBe(true);
  });

  it('expected items: confirm creates exactly one transaction; skip/stop/modify never do; deleting the txn reverts', async () => {
    const { store } = await mk(); const { bank } = await seedBasics(store);
    const inv = must(await store.saveInvestment({ name: 'Nifty Fund', type: 'sip', ownerId: 'p1' }));
    const sub = must(await store.saveExpected({ kind: 'subscription', name: 'Netflix', amount: rs(649), frequency: 'monthly', startDate: '2026-03-05', ownerId: 'p1', accountId: bank.id, categoryId: 'cat_subscriptions', skipped: [], confirmed: {}, status: 'active' }));
    const sip = must(await store.saveExpected({ kind: 'sip', name: 'SIP', amount: rs(10000), frequency: 'monthly', startDate: '2026-03-07', ownerId: 'p1', accountId: bank.id, investmentId: inv.id, skipped: [], confirmed: {}, status: 'active' }));
    expect(store.db.transactions).toHaveLength(0);
    await store.skipOccurrence(sub.id, '2026-03-05'); await store.stopExpected(sub.id); await store.saveExpected({ ...store.db.expectedItems[0], amount: rs(700) }, sub.id);
    expect(store.db.transactions).toHaveLength(0);
    const t = must(await store.confirmOccurrence(sip.id, '2026-03-07', { amount: rs(12000) }));
    expect(t).toMatchObject({ type: 'investment_contribution', amount: rs(12000), investmentId: inv.id, expectedItemId: sip.id });
    expect((await store.confirmOccurrence(sip.id, '2026-03-07')).ok).toBe(false);
    expect(store.db.transactions).toHaveLength(1);
    expect(expectedOccurrences(store.db, 'household', '2026-03-01', '2026-03-31', store.today()).find((o) => o.item.id === sip.id)!.state).toBe('confirmed');
    await store.deleteTransaction(t.id);
    expect(expectedOccurrences(store.db, 'household', '2026-03-01', '2026-03-31', store.today()).find((o) => o.item.id === sip.id)!.state).toBe('pending');
  });

  it('EMI flow through store: add existing EMI, confirm to completion, zero transactions created', async () => {
    const { store } = await mk(); const { cc } = await seedBasics(store);
    const { emi } = must(await store.addEmi({ name: 'Laptop', cardAccountId: cc.id, ownerId: 'p1', originalAmount: rs(30000), emiAmount: rs(5000), tenure: 6, startDate: '2025-12-05', monthsCompleted: 4, outstanding: rs(10000) }));
    await store.confirmEmiInstalment(emi.id, { dueDate: '2026-04-05', date: '2026-04-05' });
    expect((await store.confirmEmiInstalment(emi.id, { dueDate: '2026-04-05', date: '2026-04-05' })).ok).toBe(false);
    must(await store.confirmEmiInstalment(emi.id, { dueDate: '2026-05-05', date: '2026-05-05' }));
    expect(store.db.emis[0].status).toBe('completed'); expect(store.db.transactions).toHaveLength(0);
    expect((await store.addEmi({ name: 'x', cardAccountId: 'nope', ownerId: 'p1', originalAmount: 1, emiAmount: 1, tenure: 1, startDate: '2026-01-01' })).ok).toBe(false);
  });

  it('card report with reconcile adds an adjustment (not an expense)', async () => {
    const { store } = await mk(); const { cc } = await seedBasics(store);
    must(await store.addCardReport({ accountId: cc.id, date: '2026-03-09', source: 'statement', outstanding: rs(20000), availableLimit: rs(130000) }, { reconcile: true }));
    expect(accountBalances(store.db).get(cc.id)).toBe(-rs(20000));
    expect(store.db.transactions[0].type).toBe('adjustment');
    expect(summarizeMonth(store.db.transactions, '2026-03').spending).toBe(0);
    expect((await store.addCardReport({ accountId: cc.id, date: '2026-03-09', source: 'manual' })).ok).toBe(false);
  });

  it('goals allocate/release without touching net worth; investments valuation upsert per day', async () => {
    const { store } = await mk(); await seedBasics(store);
    const nw = computeNetWorth(store.db, 'household').net;
    const g = must(await store.saveGoal({ name: 'Emergency Fund', kind: 'emergency', ownerId: 'hh', targetAmount: rs(300000), status: 'active' }));
    must(await store.addAllocation({ goalId: g.id, date: '2026-03-09', amount: rs(60000), ownerId: 'hh' }));
    expect((await store.addAllocation({ goalId: g.id, date: '2026-03-09', amount: -rs(70000), ownerId: 'hh' })).ok).toBe(false);
    expect(computeNetWorth(store.db, 'household').net).toBe(nw);
    const i = must(await store.saveInvestment({ name: 'FD', type: 'fd', ownerId: 'p2' }));
    await store.addValuation({ targetType: 'investment', targetId: i.id, date: '2026-03-09', value: rs(1000), invested: rs(900) });
    await store.addValuation({ targetType: 'investment', targetId: i.id, date: '2026-03-09', value: rs(1100), invested: rs(900) });
    expect(store.db.valuations).toHaveLength(1); expect(store.db.valuations[0].value).toBe(rs(1100));
    expect((await store.addValuation({ targetType: 'investment', targetId: 'nope', date: '2026-03-09', value: 1 })).ok).toBe(false);
  });

  it('net worth snapshot upsert is idempotent for unchanged state', async () => {
    const { store } = await mk(); await seedBasics(store);
    await store.captureSnapshot(); await store.captureSnapshot();
    expect(store.db.snapshots).toHaveLength(1);
  });

  it('serialises concurrent commands', async () => {
    const { store } = await mk(); const { bank } = await seedBasics(store);
    await Promise.all(Array.from({ length: 20 }, () => store.addTransaction({ type: 'expense', date: '2026-03-09', amount: rs(1), ownerId: 'p1', fromAccountId: bank.id, categoryId: 'cat_other' })));
    expect(store.db.transactions).toHaveLength(20);
  });
});

describe('IndexedDB storage', () => {
  it('round-trips through real IDB API (fake-indexeddb), survives reopen', async () => {
    const factory = new IDBFactory();
    const s1 = new IdbStorage('t1', factory);
    const { store } = await mk(s1 as any); const { bank } = await seedBasics(store);
    must(await store.addTransaction({ type: 'income', date: '2026-03-01', amount: rs(5000), ownerId: 'p1', toAccountId: bank.id, incomeType: 'Salary' }));
    await store.updateSettings({ householdName: 'Home' });
    const s2 = new IdbStorage('t1', factory);
    const re = await Store.open(s2);
    expect(re.status).toBe('ready'); expect(re.db.transactions).toHaveLength(1); expect(re.db.accounts).toHaveLength(2); expect(re.db.settings.householdName).toBe('Home');
    expect(re.db.categories.length).toBeGreaterThan(10);
    await s2.setMeta('k', 5); expect(await s2.getMeta('k')).toBe(5);
    await s2.addSafety('a', '{}'); expect((await s2.listSafety())).toHaveLength(1);
  });
});
