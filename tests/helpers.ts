import { emptyDatabase } from '../src/domain/seed';
import type { Account, Database, Transaction, Liability, Investment, Asset, Valuation, Goal, ExpectedItem } from '../src/domain/types';
import { toPaise } from '../src/domain/money';

export const NOW = '2026-01-01T00:00:00.000Z';
let n = 0;
export const uid = (p = 'x') => `${p}${++n}`;
export const rs = toPaise;

export function db0(): Database { return emptyDatabase(NOW); }

export function acct(db: Database, p: Partial<Account> & { name: string; kind: Account['kind'] }): Account {
  const a: Account = { id: uid('acc'), ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01', createdAt: NOW, updatedAt: NOW, ...p };
  db.accounts.push(a); return a;
}
export function card(db: Database, limit = rs(150000), opening = 0, p: Partial<Account> = {}): Account {
  return acct(db, { name: 'HDFC Regalia Gold', kind: 'credit_card', openingBalance: -opening, card: { creditLimit: limit, dueDay: 5, statementDay: 20 }, ...p });
}
export function txn(db: Database, p: Partial<Transaction> & { type: Transaction['type']; amount: number }): Transaction {
  const t: Transaction = { id: uid('t'), date: '2026-03-10', ownerId: 'p1', createdAt: NOW, updatedAt: NOW, ...p } as Transaction;
  db.transactions.push(t); return t;
}
export function inv(db: Database, p: Partial<Investment> = {}): Investment {
  const i: Investment = { id: uid('inv'), name: 'Index Fund', type: 'mutual_fund', ownerId: 'p1', createdAt: NOW, updatedAt: NOW, ...p }; db.investments.push(i); return i;
}
export function asset(db: Database, p: Partial<Asset> = {}): Asset {
  const a: Asset = { id: uid('ast'), name: 'Gold', kind: 'gold', ownerId: 'p1', createdAt: NOW, updatedAt: NOW, ...p }; db.assets.push(a); return a;
}
export function val(db: Database, targetType: 'investment' | 'asset', targetId: string, date: string, value: number, invested?: number): Valuation {
  const v: Valuation = { id: uid('val'), targetType, targetId, date, value, invested, createdAt: NOW, updatedAt: NOW }; db.valuations.push(v); return v;
}
export function loan(db: Database, p: Partial<Liability> = {}): Liability {
  const l: Liability = { id: uid('loan'), name: 'Education loan', type: 'education', ownerId: 'p1', originalPrincipal: rs(100000), baselineOutstanding: rs(100000), baselineDate: '2026-01-01', emi: rs(10000), interestRate: 0, startDate: '2025-01-01', status: 'active', createdAt: NOW, updatedAt: NOW, ...p };
  db.liabilities.push(l); return l;
}
export function goal(db: Database, p: Partial<Goal> = {}): Goal {
  const g: Goal = { id: uid('goal'), name: 'Emergency Fund', kind: 'emergency', ownerId: 'hh', targetAmount: rs(300000), status: 'active', createdAt: NOW, updatedAt: NOW, ...p }; db.goals.push(g); return g;
}
export function expected(db: Database, p: Partial<ExpectedItem> = {}): ExpectedItem {
  const e: ExpectedItem = { id: uid('exp'), kind: 'subscription', name: 'Netflix', amount: rs(649), frequency: 'monthly', startDate: '2026-01-15', ownerId: 'p1', skipped: [], confirmed: {}, status: 'active', createdAt: NOW, updatedAt: NOW, ...p };
  db.expectedItems.push(e); return e;
}
