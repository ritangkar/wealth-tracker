/** Waste is a first-class concept but is NOT spending (I8). */
import type { Database, WasteCategory, WasteEntry, ViewScope } from './types';
import { inScope } from './scope';
import { monthOf, addMonthsKey, monthRange, type MonthKey } from './dates';
import { scopedTxns, monthTxns, summarizeMonth } from './cashflow';
import { spendingOf } from './ledger';
import type { Paise } from './money';

export const wasteInScope = (db: Pick<Database, 'wasteEntries'>, scope: ViewScope) => db.wasteEntries.filter((w) => inScope(w.ownerId, scope));
export const WASTE_LABELS: Record<WasteCategory, string> = { food: 'Cooked food', groceries: 'Groceries', product: 'Purchased products', unused: 'Unused items', spoiled: 'Spoiled items', other: 'Other' };

export interface WasteMonth {
  month: MonthKey; total: Paise; count: number;
  byCategory: { category: WasteCategory; amount: Paise }[];
  topItems: { item: string; amount: Paise; count: number }[];
  /** share of the month's total spending */
  rateOfSpending: number;
  /** food+grocery waste as a share of grocery + food & dining spending */
  foodWasteRate: number;
}
const key = (s: string) => s.trim().toLowerCase();

export function wasteMonth(db: Database, scope: ViewScope, month: MonthKey): WasteMonth {
  const entries = wasteInScope(db, scope).filter((w) => monthOf(w.date) === month);
  const total = entries.reduce((s, w) => s + w.cost, 0);
  const cat = new Map<WasteCategory, number>();
  const items = new Map<string, { item: string; amount: number; count: number }>();
  for (const w of entries) {
    cat.set(w.category, (cat.get(w.category) ?? 0) + w.cost);
    const it = items.get(key(w.item)) ?? { item: w.item.trim(), amount: 0, count: 0 };
    it.amount += w.cost; it.count++; items.set(key(w.item), it);
  }
  const txns = monthTxns(scopedTxns(db, scope), month);
  const spending = summarizeMonth(txns, month).spending;
  const foodCats = new Set(['cat_groceries', 'cat_food']);
  const foodSpend = txns.filter((t) => foodCats.has(db.categories.find((c) => c.id === t.categoryId)?.parentId ?? t.categoryId ?? '')).reduce((s, t) => s + spendingOf(t), 0);
  const foodWaste = entries.filter((w) => w.category === 'food' || w.category === 'groceries' || w.category === 'spoiled').reduce((s, w) => s + w.cost, 0);
  return {
    month, total, count: entries.length,
    byCategory: [...cat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    topItems: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    rateOfSpending: spending > 0 ? (total / spending) * 100 : 0,
    foodWasteRate: foodSpend > 0 ? (foodWaste / foodSpend) * 100 : 0,
  };
}

export const wasteTrend = (db: Database, scope: ViewScope, to: MonthKey, months = 6) =>
  monthRange(addMonthsKey(to, -(months - 1)), to).map((m) => ({ month: m, total: wasteMonth(db, scope, m).total }));

/** Items that show up in 2+ different months — gentle pattern detection. */
export function recurringWaste(db: Database, scope: ViewScope): { item: string; months: number; total: Paise; count: number }[] {
  const m = new Map<string, { item: string; months: Set<string>; total: number; count: number }>();
  for (const w of wasteInScope(db, scope)) {
    const r = m.get(key(w.item)) ?? { item: w.item.trim(), months: new Set<string>(), total: 0, count: 0 };
    r.months.add(monthOf(w.date)); r.total += w.cost; r.count++; m.set(key(w.item), r);
  }
  return [...m.values()].filter((r) => r.months.size >= 2).map((r) => ({ item: r.item, months: r.months.size, total: r.total, count: r.count })).sort((a, b) => b.total - a.total);
}

export function validateWaste(w: WasteEntry): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (!w.item.trim()) out.push({ field: 'item', message: 'What was it?' });
  if (!Number.isInteger(w.cost) || w.cost <= 0) out.push({ field: 'cost', message: 'Enter the approximate cost' });
  return out;
}
