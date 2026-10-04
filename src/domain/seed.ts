import type { Category, Database, Settings } from './types';
import { toPaise } from './money';

const CATS: { key: string; name: string; subs: [string, string][] }[] = [
  { key: 'groceries', name: 'Groceries', subs: [['online_grocery', 'Online grocery'], ['local_market', 'Local market'], ['staples', 'Staples & bulk']] },
  { key: 'food', name: 'Food & dining', subs: [['delivery', 'Food delivery'], ['dining_out', 'Dining out'], ['snacks', 'Coffee & snacks']] },
  { key: 'transport', name: 'Transport', subs: [['cab', 'Cabs & rides'], ['fuel', 'Fuel'], ['public', 'Public transit'], ['travel_local', 'Other local']] },
  { key: 'shopping', name: 'Shopping', subs: [['online_shopping', 'Online shopping'], ['clothing', 'Clothing'], ['electronics', 'Electronics'], ['home', 'Home & kitchen']] },
  { key: 'subscriptions', name: 'Subscriptions', subs: [['streaming', 'Streaming'], ['apps', 'Apps & software'], ['memberships', 'Memberships']] },
  { key: 'bills', name: 'Bills & utilities', subs: [['electricity', 'Electricity'], ['internet', 'Internet & phone'], ['water_gas', 'Water & gas']] },
  { key: 'housing', name: 'Housing', subs: [['rent', 'Rent'], ['maintenance', 'Maintenance']] },
  { key: 'health', name: 'Health', subs: [['medical', 'Doctor & medicines'], ['fitness', 'Fitness']] },
  { key: 'travel', name: 'Travel & trips', subs: [['flights', 'Flights & trains'], ['stay', 'Stay'], ['activities', 'Activities']] },
  { key: 'entertainment', name: 'Entertainment', subs: [] },
  { key: 'education', name: 'Education', subs: [] },
  { key: 'gifts', name: 'Gifts & festivals', subs: [['festival', 'Festivals & pujas'], ['gifts', 'Gifts'], ['donations', 'Donations']] },
  { key: 'personal', name: 'Personal care', subs: [] },
  { key: 'fees', name: 'Fees & interest', subs: [] },
  { key: 'other', name: 'Other', subs: [] },
];

export const catId = (key: string) => `cat_${key}`;
export const subId = (key: string) => `sub_${key}`;

export function defaultCategories(now: string): Category[] {
  const out: Category[] = [];
  for (const c of CATS) {
    out.push({ id: catId(c.key), name: c.name, kind: 'expense', system: c.key, createdAt: now, updatedAt: now });
    for (const [k, n] of c.subs) out.push({ id: subId(k), name: n, kind: 'expense', parentId: catId(c.key), system: k, createdAt: now, updatedAt: now });
  }
  return out;
}

export function defaultSettings(now: string): Settings {
  return {
    id: 'settings', createdAt: now, updatedAt: now,
    people: [{ id: 'p1', name: 'Ritangkar', savingsTarget: toPaise(50000) }, { id: 'p2', name: 'Wife', savingsTarget: toPaise(10000) }],
    householdName: 'Our household',
    householdSavingsTarget: toPaise(60000), householdSavingsMinimum: toPaise(50000),
    transportReviewThreshold: toPaise(3000), spikeFactor: 1.5, spikeMinimum: toPaise(1500),
    homeCookSavingsPct: 40, localMarketSavingsPct: 10, subscriptionReviewDays: 60,
    incomeTypes: ['Salary', 'Bonus', 'Side income', 'Interest', 'Dividends', 'Gift', 'Other'],
    lockEnabled: false, monthNotes: {}, defaults: {},
  };
}

export function emptyDatabase(now = new Date().toISOString()): Database {
  return {
    settings: defaultSettings(now), categories: defaultCategories(now), accounts: [], cardReports: [], transactions: [],
    investments: [], assets: [], valuations: [], liabilities: [], emis: [], expectedItems: [], goals: [], goalAllocations: [],
    wasteEntries: [], snapshots: [], tombstones: [],
  };
}
