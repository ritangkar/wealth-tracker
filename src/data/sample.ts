/** Fictional demo data (never real records). Dates are relative to `today` so the demo always looks current. */
import type { Database, Transaction } from '../domain/types';
import { emptyDatabase } from '../domain/seed';
import { addDays, addMonths, monthOf, monthStart, type ISODate } from '../domain/dates';
import { toPaise as rs } from '../domain/money';
import { buildEmi } from '../domain/emi';
import { buildSnapshot } from '../domain/networth';

export function sampleDatabase(today: ISODate, now = new Date().toISOString()): Database {
  const db = emptyDatabase(now);
  let n = 0; const id = (p: string) => `${p}_demo${++n}`;
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const stamp = { createdAt: now, updatedAt: now };
  const acc = (name: string, kind: Database['accounts'][number]['kind'], ownerId: 'p1' | 'p2' | 'hh', opening: number, extra: object = {}) => {
    const a = { id: id('acc'), name, kind, ownerId, openingBalance: rs(opening), openingDate: addMonths(today, -5), ...stamp, ...extra }; db.accounts.push(a); return a;
  };
  const sav = acc('HDFC Savings', 'bank', 'p1', 240000);
  const salary = acc('HDFC Salary Account', 'bank', 'p1', 35000);
  const wifeBank = acc('Wife’s Savings', 'bank', 'p2', 90000);
  const cash = acc('Cash', 'cash', 'hh', 6000);
  const broker = acc('Investment Account', 'investment', 'p1', 0);
  const cc = acc('HDFC Regalia Gold', 'credit_card', 'p1', -48000, { card: { creditLimit: rs(150000), statementDay: 20, dueDay: 8 } });
  void broker; void cash;
  const t = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amount'>) => db.transactions.push({ id: id('txn'), ownerId: 'p1', ...stamp, ...p } as Transaction);

  const inv1 = { id: id('inv'), name: 'Nifty 50 Index Fund', type: 'mutual_fund' as const, institution: 'Demo AMC', ownerId: 'p1' as const, ...stamp };
  const inv2 = { id: id('inv'), name: 'Flexi-cap Fund', type: 'sip' as const, institution: 'Demo AMC', ownerId: 'p2' as const, ...stamp };
  const inv3 = { id: id('inv'), name: 'Bank FD', type: 'fd' as const, institution: 'Demo Bank', ownerId: 'hh' as const, ...stamp };
  db.investments.push(inv1, inv2, inv3);
  const first = addMonths(today, -4);
  const val = (targetId: string, date: string, value: number, invested: number) => db.valuations.push({ id: id('val'), targetType: 'investment', targetId, date, value: rs(value), invested: rs(invested), ...stamp });
  val(inv1.id, first, 410000, 380000); val(inv1.id, addMonths(today, -2), 452000, 410000); val(inv1.id, addDays(today, -3), 471000, 430000);
  val(inv2.id, first, 120000, 115000); val(inv2.id, addDays(today, -3), 139000, 130000);
  val(inv3.id, first, 200000, 200000);
  const gold = { id: id('ast'), name: 'Gold jewellery', kind: 'gold' as const, ownerId: 'p2' as const, ...stamp }; db.assets.push(gold);
  db.valuations.push({ id: id('val'), targetType: 'asset', targetId: gold.id, date: first, value: rs(260000), ...stamp });

  const loan = { id: id('loan'), name: 'Education loan', type: 'education' as const, ownerId: 'p1' as const, originalPrincipal: rs(400000), baselineOutstanding: rs(30000), baselineDate: addMonths(today, -1), emi: rs(10000), interestRate: 0, startDate: '2021-07-05', paymentDay: 5, status: 'active' as const, ...stamp };
  db.liabilities.push(loan);

  // 5 months of activity
  for (let m = -4; m <= 0; m++) {
    const ms = monthStart(monthOf(addMonths(today, m)));
    const day = (d: number) => { const x = addDays(ms, d - 1); return x > today ? today : x; };
    if (day(1) <= today) {
      t({ type: 'income', date: day(1), amount: rs(165000), toAccountId: salary.id, incomeType: 'Salary', recurring: true });
      t({ type: 'income', date: day(2), amount: rs(42000), ownerId: 'p2', toAccountId: wifeBank.id, incomeType: 'Salary', recurring: true });
      t({ type: 'transfer', date: day(2), amount: rs(120000), fromAccountId: salary.id, toAccountId: sav.id });
      t({ type: 'investment_contribution', date: day(5), amount: rs(25000), fromAccountId: sav.id, investmentId: inv1.id, recurring: true });
      t({ type: 'investment_contribution', date: day(5), ownerId: 'p2', amount: rs(5000), fromAccountId: wifeBank.id, investmentId: inv2.id, recurring: true });
      t({ type: 'expense', date: day(3), amount: rs(32000), ownerId: 'hh', fromAccountId: sav.id, paymentMethod: 'bank_transfer', categoryId: 'cat_housing', subcategoryId: 'sub_rent', merchant: 'Landlord', recurring: true });
    }
    for (let k = 0; k < 6; k++) { const d = day(2 + k * 4); if (d <= today) t({ type: 'expense', date: d, amount: rs(Math.round(700 + rnd() * 1100)), fromAccountId: sav.id, paymentMethod: 'upi', categoryId: 'cat_groceries', subcategoryId: 'sub_online_grocery', merchant: 'Blinkit' }); }
    for (let k = 0; k < 2; k++) { const d = day(6 + k * 9); if (d <= today) t({ type: 'expense', date: d, amount: rs(Math.round(500 + rnd() * 600)), ownerId: 'p2', fromAccountId: wifeBank.id, paymentMethod: 'upi', categoryId: 'cat_groceries', subcategoryId: 'sub_local_market', merchant: 'Local market' }); }
    for (let k = 0; k < (m === 0 ? 3 : 5); k++) { const d = day(3 + k * 5); if (d <= today) t({ type: 'expense', date: d, amount: rs(Math.round(300 + rnd() * 450)), fromAccountId: cc.id, paymentMethod: 'credit_card', categoryId: 'cat_food', subcategoryId: 'sub_delivery', merchant: rnd() > 0.5 ? 'Swiggy' : 'Zomato' }); }
    for (let k = 0; k < 4; k++) { const d = day(4 + k * 7); if (d <= today) t({ type: 'expense', date: d, amount: rs(Math.round(180 + rnd() * 380)), fromAccountId: sav.id, paymentMethod: 'upi', categoryId: 'cat_transport', subcategoryId: 'sub_cab', merchant: rnd() > 0.5 ? 'Uber' : 'Ola' }); }
    if (day(12) <= today) t({ type: 'expense', date: day(12), amount: rs(m === -1 ? 9400 : Math.round(1800 + rnd() * 1600)), ownerId: 'p2', fromAccountId: cc.id, paymentMethod: 'credit_card', categoryId: 'cat_shopping', subcategoryId: 'sub_online_shopping', merchant: 'Amazon', oneOff: m === -1 });
    if (day(16) <= today) t({ type: 'expense', date: day(16), amount: rs(3200), ownerId: 'p2', fromAccountId: cc.id, paymentMethod: 'credit_card', categoryId: 'cat_shopping', merchant: 'Amazon' });
    if (day(9) <= today) t({ type: 'expense', date: day(9), amount: rs(Math.round(2400 + rnd() * 800)), ownerId: 'hh', fromAccountId: sav.id, paymentMethod: 'upi', categoryId: 'cat_bills', subcategoryId: 'sub_electricity', merchant: 'Electricity board', recurring: true });
    if (day(10) <= today) t({ type: 'expense', date: day(10), amount: rs(1499), ownerId: 'hh', fromAccountId: sav.id, paymentMethod: 'upi', categoryId: 'cat_bills', subcategoryId: 'sub_internet', merchant: 'Broadband', recurring: true });
    if (day(5) <= today) t({ type: 'liability_payment', date: day(5), amount: rs(10000), fromAccountId: sav.id, liabilityId: loan.id, paymentMethod: 'bank_transfer' });
    if (m < 0 && day(8) <= today) t({ type: 'cc_settlement', date: addDays(ms, 7), amount: rs(Math.round(9000 + rnd() * 2500)), fromAccountId: sav.id, toAccountId: cc.id, paymentMethod: 'bank_transfer' });
  }
  // The baseline for the loan is last month; drop payments on/before baseline from counting twice (ledger ignores them).

  const emi = buildEmi({ id: id('emi'), now, name: 'Laptop (0% EMI)', cardAccountId: cc.id, ownerId: 'p1', originalAmount: rs(60000), emiAmount: rs(5000), tenure: 12, startDate: addMonths(today, -5), monthsCompleted: 5, outstanding: rs(35000), paymentDay: 8 }).emi;
  db.emis.push(emi);

  const sub = (name: string, amount: number, merchant: string, lastUsed?: string, day = 12) => db.expectedItems.push({ id: id('exp'), kind: 'subscription', name, amount: rs(amount), frequency: 'monthly', startDate: addMonths(monthStart(monthOf(today)), -5).slice(0, 8) + String(day).padStart(2, '0'), ownerId: 'hh', accountId: cc.id, paymentMethod: 'credit_card', categoryId: 'cat_subscriptions', merchant, skipped: [], confirmed: {}, status: 'active', lastUsed, ...stamp });
  sub('YouTube Premium', 149, 'YouTube', addDays(today, -4), 3); sub('Amazon Prime', 1499 / 12, 'Amazon', addDays(today, -10), 18); sub('Netflix', 649, 'Netflix', addDays(today, -80), 14); sub('Sony LIV', 299, 'Sony LIV', addDays(today, -120), 21); sub('FanCode', 199, 'FanCode', undefined, 25);
  db.expectedItems.push({ id: id('exp'), kind: 'salary', name: 'Salary (Ritangkar)', amount: rs(165000), frequency: 'monthly', startDate: addMonths(monthStart(monthOf(today)), -5), ownerId: 'p1', accountId: salary.id, incomeType: 'Salary', skipped: [], confirmed: {}, status: 'active', ...stamp });
  db.expectedItems.push({ id: id('exp'), kind: 'sip', name: 'Nifty 50 SIP', amount: rs(25000), frequency: 'monthly', startDate: addMonths(monthStart(monthOf(today)), -5).slice(0, 8) + '05', ownerId: 'p1', accountId: sav.id, investmentId: inv1.id, skipped: [], confirmed: {}, status: 'active', ...stamp });

  const g1 = { id: id('goal'), name: 'Emergency Fund', kind: 'emergency' as const, ownerId: 'hh' as const, targetAmount: rs(400000), status: 'active' as const, ...stamp };
  const g2 = { id: id('goal'), name: 'Next Trip', kind: 'trip' as const, ownerId: 'hh' as const, targetAmount: rs(180000), targetDate: addMonths(today, 8), location: 'Kerala', status: 'active' as const, ...stamp };
  const g3 = { id: id('goal'), name: 'Land', kind: 'land' as const, ownerId: 'p1' as const, targetAmount: rs(2500000), status: 'active' as const, ...stamp };
  db.goals.push(g1, g2, g3);
  // each allocation says which money it is set aside from (plan only — nothing moves)
  const al = (goalId: string, amount: number, o: 'hh' | 'p1', src: { sourceKind: 'account' | 'investment'; sourceId: string }) => db.goalAllocations.push({ id: id('alloc'), goalId, date: addDays(today, -20), amount: rs(amount), ownerId: o, ...src, ...stamp });
  al(g1.id, 100000, 'hh', { sourceKind: 'investment', sourceId: inv3.id }); al(g1.id, 50000, 'hh', { sourceKind: 'account', sourceId: sav.id });
  al(g2.id, 45000, 'hh', { sourceKind: 'investment', sourceId: inv1.id });
  al(g3.id, 120000, 'p1', { sourceKind: 'investment', sourceId: inv2.id });

  const w = (daysAgo: number, item: string, cost: number, category: Database['wasteEntries'][number]['category'], reason: string, ownerId: 'p1' | 'p2' | 'hh' = 'hh') => db.wasteEntries.push({ id: id('waste'), date: addDays(today, -daysAgo), item, cost: rs(cost), category, reason, ownerId, ...stamp });
  w(2, 'Spinach & coriander', 110, 'groceries', 'Spoiled before use'); w(5, 'Leftover biryani', 320, 'food', 'Ordered too much'); w(9, 'Yoga mat', 1400, 'unused', 'Bought, never used', 'p2'); w(34, 'Spinach & coriander', 90, 'groceries', 'Spoiled before use'); w(40, 'Cut fruit box', 260, 'spoiled', 'Forgot in fridge');

  db.snapshots.push(buildSnapshot(db, today, id('snap'), now));
  return db;
}
