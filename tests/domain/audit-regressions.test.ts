import { describe, expect, it } from 'vitest';
import { accountBalances } from '../../src/domain/ledger';
import { computeNetWorth } from '../../src/domain/networth';
import { projectMonthEnd } from '../../src/domain/cashflow';
import { expectedOccurrences, draftFromOccurrence, upcomingCommitments } from '../../src/domain/expected';
import { generateInsights } from '../../src/domain/insights';
import { cardMetrics } from '../../src/domain/cards';
import { buildEmi } from '../../src/domain/emi';
import { validateDatabase } from '../../src/domain/schema';
import { repairDatabase } from '../../src/data/repair';
import { Store } from '../../src/data/store';
import { MemoryStorage } from '../../src/data/storage';
import { SCHEMA_VERSION } from '../../src/domain/types';
import { db0, acct, card, txn, expected, rs, NOW } from '../helpers';

describe('opening balance semantics', () => {
  it('transactions before openingDate are history only; same-day and later apply', () => {
    const db = db0(); const a = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(50000), openingDate: '2026-03-10' });
    txn(db, { type: 'income', amount: rs(80000), date: '2026-03-01', toAccountId: a.id });      // back-filled
    txn(db, { type: 'expense', amount: rs(30000), date: '2026-03-05', fromAccountId: a.id, categoryId: 'cat_other' });
    expect(accountBalances(db, '2026-04-01').get(a.id)).toBe(rs(50000));
    txn(db, { type: 'expense', amount: rs(1000), date: '2026-03-10', fromAccountId: a.id, categoryId: 'cat_other' });
    txn(db, { type: 'expense', amount: rs(500), date: '2026-03-12', fromAccountId: a.id, categoryId: 'cat_other' });
    expect(accountBalances(db, '2026-04-01').get(a.id)).toBe(rs(48500));
  });
  it('future-dated transactions do not change today’s balance or net worth', () => {
    const db = db0(); const a = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(10000) });
    txn(db, { type: 'expense', amount: rs(9000), date: '2099-12-25', fromAccountId: a.id, categoryId: 'cat_other' });
    expect(computeNetWorth(db, 'household').net).toBe(rs(10000));
    expect(accountBalances(db, '2100-01-01').get(a.id)).toBe(rs(1000));
  });
});

describe('projection and expected-item matching', () => {
  it('hand-logged recurring bills (recurring flag) are not in the variable pace and not double counted', () => {
    const db = db0(); const a = acct(db, { name: 'S', kind: 'bank' });
    for (const m of ['2026-07', '2026-08', '2026-09']) txn(db, { type: 'expense', amount: rs(20000), date: `${m}-05`, fromAccountId: a.id, categoryId: 'cat_housing', merchant: 'Rent', recurring: true });
    txn(db, { type: 'income', amount: rs(100000), date: '2026-10-01', toAccountId: a.id });
    expected(db, { kind: 'bill', name: 'Rent', merchant: 'Rent', amount: rs(20000), startDate: '2026-07-05', accountId: a.id });
    const p = projectMonthEnd(db, 'household', '2026-10', '2026-10-01');
    expect(p.expectedFixedRemaining).toBe(rs(20000)); expect(p.variableRemaining).toBe(0);
    expect(p.projectedSavings).toBe(rs(80000));
  });
  it('weekly: confirming one occurrence does not hide the others', () => {
    const db = db0(); const a = acct(db, { name: 'S', kind: 'bank' });
    const e = expected(db, { frequency: 'weekly', amount: rs(1000), startDate: '2026-10-01', merchant: 'Milk', name: 'Milk', accountId: a.id, kind: 'bill' });
    const t = txn(db, { type: 'expense', amount: rs(1000), date: '2026-10-01', fromAccountId: a.id, categoryId: 'cat_groceries', merchant: 'Milk', expectedItemId: e.id });
    e.confirmed['2026-10-01'] = t.id;
    const occ = expectedOccurrences(db, 'household', '2026-10-01', '2026-10-31', '2026-10-02');
    expect(occ.filter((o) => o.state === 'pending' && !o.likelyRecorded)).toHaveLength(4);
  });
  it('bills/subscriptions without a category get a sensible default so confirm cannot fail silently', () => {
    const db = db0(); const e = expected(db, { kind: 'bill', categoryId: undefined, accountId: 'x' });
    expect(draftFromOccurrence(e, '2026-10-05').categoryId).toBe('cat_bills');
    expect(draftFromOccurrence(expected(db, { kind: 'subscription', categoryId: undefined }), '2026-10-05').categoryId).toBe('cat_subscriptions');
  });
  it('EMI and loan due dates do not drift after short months', () => {
    const db = db0(); const cc = card(db);
    db.emis.push(buildEmi({ id: 'e', now: NOW, name: 'X', cardAccountId: cc.id, ownerId: 'p1', originalAmount: rs(30000), emiAmount: rs(5000), tenure: 6, startDate: '2026-01-31' }).emi);
    const c = upcomingCommitments(db, 'household', '2026-01-01', '2026-06-30', '2026-01-01').filter((x) => x.kind === 'emi').map((x) => x.date);
    expect(c).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  });
  it('subscription insight uses monthly equivalents', () => {
    const db = db0(); const a = acct(db, { name: 'S', kind: 'bank', openingBalance: rs(1e5) }); txn(db, { type: 'income', amount: rs(1e5), date: '2026-03-01', toAccountId: a.id });
    expected(db, { name: 'Prime', amount: rs(1499), frequency: 'yearly', startDate: '2025-01-01' });
    const i = generateInsights(db, 'household', '2026-03-20').find((x) => x.id === 'subs-check')!;
    expect(i.body).toMatch(/₹124\.92\/month/);
  });
});

describe('cards: EMI balance semantics', () => {
  it('when tracked balance EXCLUDES EMI principal, non-EMI shows the full balance, used includes EMI, and net worth keeps the EMI debt', () => {
    const db = db0(); const cc = card(db, rs(150000), rs(15000), { openingDate: '2026-01-01' }); cc.card!.emiInLedger = false;
    db.emis.push(buildEmi({ id: 'e', now: NOW, name: 'TV', cardAccountId: cc.id, ownerId: 'p1', originalAmount: rs(60000), emiAmount: rs(5000), tenure: 12, startDate: '2026-01-05', monthsCompleted: 4, outstanding: rs(40000) }).emi);
    const m = cardMetrics(db, cc, '2026-03-10');
    expect([m.nonEmiOutstanding, m.emiOutstanding, m.outstanding, m.used]).toEqual([rs(15000), rs(40000), rs(55000), rs(55000)]);
    expect(computeNetWorth(db, 'household').liabilities.cards).toBe(rs(55000));
    cc.card!.emiInLedger = true; // default semantics unchanged
    expect(cardMetrics(db, cc, '2026-03-10').nonEmiOutstanding).toBe(0);
  });
});

describe('store: audit fixes', () => {
  const open = async () => { const st = new MemoryStorage(); const store = await Store.open(st, { now: () => new Date(2026, 9, 4), idGen: (p) => `${p}_${Math.random().toString(36).slice(2, 9)}` }); return { st, store }; };
  const ok = <T,>(r: any): T => { if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.value; };

  it('EMI instalment billed above principal can record the extra as an interest expense (opt-in); principal never becomes an expense', async () => {
    const { store } = await open();
    const cc = ok<any>(await store.addAccount({ name: 'Card', kind: 'credit_card', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01', card: { creditLimit: rs(150000) } }));
    const { emi } = ok<any>(await store.addEmi({ name: 'Phone', cardAccountId: cc.id, ownerId: 'p1', originalAmount: rs(12000), emiAmount: rs(1100), tenure: 12, startDate: '2026-09-05' }));
    await store.confirmEmiInstalment(emi.id, { dueDate: '2026-09-05', date: '2026-09-05', amount: rs(1100) });
    expect(store.db.transactions).toHaveLength(0);
    await store.confirmEmiInstalment(emi.id, { dueDate: '2026-10-05', date: '2026-10-05', amount: rs(1100), recordInterestExpense: true });
    expect(store.db.transactions).toHaveLength(1);
    expect(store.db.transactions[0]).toMatchObject({ type: 'expense', amount: rs(100), categoryId: 'cat_fees', fromAccountId: cc.id });
  });

  it('valuation without cost basis keeps the gain (carries cost basis forward)', async () => {
    const { store } = await open();
    const bank = ok<any>(await store.addAccount({ name: 'S', kind: 'bank', ownerId: 'p1', openingBalance: rs(500000), openingDate: '2026-01-01' }));
    const i = ok<any>(await store.saveInvestment({ name: 'Fund', type: 'mutual_fund', ownerId: 'p1' }));
    await store.addTransaction({ type: 'investment_contribution', date: '2026-09-01', amount: rs(100000), ownerId: 'p1', fromAccountId: bank.id, investmentId: i.id });
    await store.addValuation({ targetType: 'investment', targetId: i.id, date: '2026-10-01', value: rs(112000) });
    expect(store.db.valuations[0].invested).toBe(rs(100000));
  });

  it('linkOccurrence marks an existing transaction as the occurrence without creating one', async () => {
    const { store } = await open();
    const bank = ok<any>(await store.addAccount({ name: 'S', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' }));
    const e = ok<any>(await store.saveExpected({ kind: 'subscription', name: 'Netflix', amount: rs(649), frequency: 'monthly', startDate: '2026-10-05', ownerId: 'p1', accountId: bank.id, skipped: [], confirmed: {}, status: 'active' }));
    const t = ok<any>(await store.addTransaction({ type: 'expense', date: '2026-10-05', amount: rs(649), ownerId: 'p1', fromAccountId: bank.id, categoryId: 'cat_subscriptions', merchant: 'Netflix' }));
    expect((await store.linkOccurrence(e.id, '2026-10-05', t.id)).ok).toBe(true);
    expect(store.db.transactions).toHaveLength(1);
    expect(expectedOccurrences(store.db, 'household', '2026-10-01', '2026-10-31', '2026-10-10')[0].state).toBe('confirmed');
  });

  it('recovery mode: raw export is a valid-looking envelope; repair removes only broken records, keeps a safety copy and reopens', async () => {
    const st = new MemoryStorage(); const db = db0(); const a = acct(db, { name: 'Keep', kind: 'bank', openingBalance: rs(100) });
    txn(db, { type: 'expense', amount: rs(5), fromAccountId: a.id, categoryId: 'cat_other' });
    txn(db, { type: 'expense', amount: rs(7), fromAccountId: 'ghost-account', categoryId: 'cat_other' }); // dangling (two-tab race)
    await st.replaceAll(db, SCHEMA_VERSION);
    const store = await Store.open(st);
    expect(store.status).toBe('recovery'); expect(JSON.parse(store.recovery!.raw).app).toBe('wealth-os');
    const r = await store.attemptRepair();
    expect(r.ok).toBe(true); if (r.ok) expect(r.value.dropped.join()).toMatch(/refers to something/);
    expect(store.status).toBe('ready'); expect(store.db.accounts).toHaveLength(1); expect(store.db.transactions).toHaveLength(1);
    expect(await st.listSafety()).toHaveLength(1);
    expect(repairDatabase(db).db!.transactions).toHaveLength(1);
  });

  it('another tab’s change is adopted (multi-tab refresh)', async () => {
    const st = new MemoryStorage(); const mk = () => Store.open(st, { channel: 'test-sync' });
    const a = await mk(); const b = await mk();
    await a.addAccount({ name: 'From A', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' });
    await new Promise((r) => setTimeout(r, 60));
    expect(b.db.accounts.map((x) => x.name)).toEqual(['From A']);
  });
});

describe('import rejects values the app’s own forms reject', () => {
  const base = () => JSON.parse(JSON.stringify(db0()));
  it.each([
    ['negative waste', (d: any) => d.wasteEntries.push({ id: 'w', date: '2026-03-01', item: 'x', cost: -500000, category: 'food', ownerId: 'p1', createdAt: NOW, updatedAt: NOW })],
    ['negative valuation', (d: any) => { d.investments.push({ id: 'i', name: 'x', type: 'stock', ownerId: 'p1', createdAt: NOW, updatedAt: NOW }); d.valuations.push({ id: 'v', targetType: 'investment', targetId: 'i', date: '2026-03-01', value: -1000, createdAt: NOW, updatedAt: NOW }); }],
    ['negative expected item', (d: any) => d.expectedItems.push({ id: 'e', kind: 'bill', name: 'x', amount: -100, frequency: 'monthly', startDate: '2026-03-01', ownerId: 'p1', skipped: [], confirmed: {}, status: 'active', createdAt: NOW, updatedAt: NOW })],
    ['goal target -5', (d: any) => d.goals.push({ id: 'g', name: 'x', kind: 'other', ownerId: 'hh', targetAmount: -5, status: 'active', createdAt: NOW, updatedAt: NOW })],
    ['no people', (d: any) => { d.settings.people = []; }],
    ['bad emi tenure', (d: any) => { d.accounts.push({ id: 'c', name: 'c', kind: 'credit_card', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01', card: { creditLimit: 100 }, createdAt: NOW, updatedAt: NOW }); d.emis.push({ id: 'e', name: 'x', cardAccountId: 'c', ownerId: 'p1', originalAmount: 100, emiAmount: 10, tenure: 5, startDate: '2026-01-01', monthsCompletedAtEntry: 9, outstandingAtEntry: 10, payments: [], blockPolicy: 'as_paid', status: 'active', createdAt: NOW, updatedAt: NOW }); }],
    ['positive card opening', (d: any) => d.accounts.push({ id: 'c', name: 'c', kind: 'credit_card', ownerId: 'p1', openingBalance: 100, openingDate: '2026-01-01', card: { creditLimit: 100 }, createdAt: NOW, updatedAt: NOW })],
  ])('%s', (_n, mut) => { const d = base(); mut(d); expect(validateDatabase(d).errors.length).toBeGreaterThan(0); });
});
