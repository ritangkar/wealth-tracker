import { describe, expect, it } from 'vitest';
import { generateInsights } from '../../src/domain/insights';
import { canIAfford } from '../../src/domain/afford';
import { buildEmi } from '../../src/domain/emi';
import { db0, acct, card, txn, goal, expected, loan, rs, NOW } from '../helpers';

const today = '2026-03-20';
function base() {
  const db = db0(); const b = acct(db, { name: 'S', kind: 'bank', ownerId: 'hh', openingBalance: rs(200000) });
  txn(db, { type: 'income', amount: rs(150000), date: '2026-03-01', toAccountId: b.id });
  return { db, b };
}

describe('insights', () => {
  it('transport over threshold is informational, mentions travel/road conditions, labelled configurable', () => {
    const { db, b } = base(); txn(db, { type: 'expense', amount: rs(3500), date: '2026-03-05', fromAccountId: b.id, categoryId: 'cat_transport', subcategoryId: 'sub_cab' });
    const i = generateInsights(db, 'household', today).find((x) => x.id === 'transport-review')!;
    expect(i.tone).toBe('info'); expect(i.body).toMatch(/road conditions/); expect(i.assumptions[0]).toMatch(/setting/);
    db.settings.transportReviewThreshold = rs(5000);
    expect(generateInsights(db, 'household', today).some((x) => x.id === 'transport-review')).toBe(false);
  });
  it('food delivery and online grocery estimates are labelled estimates with stated assumptions; no claim of actual savings', () => {
    const { db, b } = base();
    for (let d = 1; d <= 4; d++) {
      txn(db, { type: 'expense', amount: rs(500), date: `2026-03-0${d}`, fromAccountId: b.id, categoryId: 'cat_food', subcategoryId: 'sub_delivery' });
      txn(db, { type: 'expense', amount: rs(1000), date: `2026-03-1${d}`, fromAccountId: b.id, categoryId: 'cat_groceries', subcategoryId: 'sub_online_grocery', merchant: 'Blinkit' });
    }
    const ins = generateInsights(db, 'household', today);
    const f = ins.find((x) => x.id === 'food-delivery')!; const g = ins.find((x) => x.id === 'online-grocery')!;
    expect(f.estimate && g.estimate).toBe(true); expect(f.assumptions[0]).toMatch(/40%/); expect(g.body).toMatch(/no price comparison data/i);
    expect(f.body).not.toMatch(/you (will|can) save/i);
    for (const x of ins) expect(x.title + x.body).not.toMatch(/\b(wasteful|guilty|overspend|bad|lazy)\b/i);
  });
  it('spikes ignore one-offs; need factor and absolute rise', () => {
    const { db, b } = base();
    for (const m of ['2026-01', '2026-02']) txn(db, { type: 'expense', amount: rs(2000), date: `${m}-10`, fromAccountId: b.id, categoryId: 'cat_shopping' });
    txn(db, { type: 'expense', amount: rs(9000), date: '2026-03-10', fromAccountId: b.id, categoryId: 'cat_shopping', merchant: 'Amazon' });
    expect(generateInsights(db, 'household', today).some((x) => x.id === 'spike-cat_shopping')).toBe(true);
    db.transactions[db.transactions.length - 1].oneOff = true;
    expect(generateInsights(db, 'household', today).some((x) => x.id === 'spike-cat_shopping')).toBe(false);
  });
  it('savings gap is gentle and acknowledges month note', () => {
    const { db, b } = base(); db.settings.monthNotes['2026-03'] = 'Durga Puja';
    txn(db, { type: 'expense', amount: rs(120000), date: '2026-03-10', fromAccountId: b.id, categoryId: 'cat_gifts' });
    const i = generateInsights(db, 'household', today).find((x) => x.id === 'savings-gap')!;
    expect(i.body).toMatch(/Durga Puja/); expect(i.body).toMatch(/Nothing here is a failure/); expect(i.estimate).toBe(true);
  });
  it('subscriptions are only "worth a check" when not marked used; never called wasteful', () => {
    const { db } = base(); expected(db, { name: 'Sony LIV', startDate: '2025-10-01' }); expected(db, { name: 'YouTube', startDate: '2025-10-01', lastUsed: '2026-03-10' });
    const i = generateInsights(db, 'household', today).find((x) => x.id === 'subs-check')!;
    expect(i.body).toMatch(/Sony LIV/); expect(i.body).not.toMatch(/YouTube/); expect(i.body).not.toMatch(/wast/i);
  });
  it('person scope only sees own spending', () => {
    const { db, b } = base(); txn(db, { type: 'expense', amount: rs(9000), ownerId: 'p2', date: '2026-03-05', fromAccountId: b.id, categoryId: 'cat_transport' });
    expect(generateInsights(db, 'p1', today).some((x) => x.id === 'transport-review')).toBe(false);
    expect(generateInsights(db, 'p2', today).some((x) => x.id === 'transport-review')).toBe(true);
  });
  it('no data → no fabricated insights', () => { expect(generateInsights(db0(), 'household', today)).toEqual([]); });
});

describe('can I afford this', () => {
  it('comfortable vs goals vs exceeds cash; EMIs and card bills count as commitments; never negative-claims', () => {
    const { db } = base();
    goal(db, { targetAmount: rs(300000) }); db.goalAllocations.push({ id: 'g1', goalId: db.goals[0].id, date: '2026-03-01', amount: rs(150000), ownerId: 'hh', createdAt: NOW, updatedAt: NOW });
    expected(db, { amount: rs(5000), startDate: '2026-03-25', kind: 'bill' });
    const cc = card(db, rs(150000), rs(20000));
    db.emis.push(buildEmi({ id: 'e', now: NOW, name: 'Phone', cardAccountId: cc.id, ownerId: 'hh', originalAmount: rs(20000), emiAmount: rs(5000), tenure: 4, startDate: '2026-03-28' }).emi);
    loan(db, { ownerId: 'hh', emi: rs(10000), paymentDay: 28, baselineOutstanding: rs(30000) });
    const small = canIAfford(db, 'household', rs(2000), today);
    expect(small.verdict).toBe('comfortable');
    // commitments: bill 5000 + loan 10000 + card (non-EMI 0 + EMI due 5000) = 20000
    expect(small.lines[1].value).toBe(-rs(20000));
    expect(canIAfford(db, 'household', rs(40000), today).verdict).toBe('dips_into_goals');
    const big = canIAfford(db, 'household', rs(190000), today);
    expect(big.verdict).toBe('exceeds_cash'); expect(big.disclaimer).toMatch(/not financial advice/);
  });
});
