/**
 * Financial event rules. The single place that defines what each transaction type
 * does to balances, spending, holdings and liabilities. See docs/FINANCIAL_RULES.md.
 */
import type { Account, Database, Id, OwnerId, Transaction, TxnType } from './types';
import type { Paise } from './money';
import { isValidDate, todayISO } from './dates';

export interface Issue { field: string; message: string }

export const TXN_TYPES: TxnType[] = [
  'income', 'expense', 'refund', 'transfer', 'cc_settlement', 'investment_contribution',
  'investment_redemption', 'asset_acquisition', 'liability_creation', 'liability_payment', 'adjustment',
];

export interface AccountDelta { accountId: Id; delta: Paise }

/** Effect on signed account balances. Card balance is negative = outstanding. */
export function accountEffects(t: Transaction): AccountDelta[] {
  const out: AccountDelta[] = [];
  const from = (a?: Id) => a && out.push({ accountId: a, delta: -t.amount });
  const to = (a?: Id) => a && out.push({ accountId: a, delta: t.amount });
  switch (t.type) {
    case 'income': case 'refund': case 'investment_redemption': case 'liability_creation': case 'adjustment':
      to(t.toAccountId); break;
    case 'expense': case 'investment_contribution': case 'asset_acquisition': case 'liability_payment':
      from(t.fromAccountId); break;
    case 'transfer': case 'cc_settlement':
      from(t.fromAccountId); to(t.toAccountId); break;
  }
  return out;
}

export function interestPortion(t: Transaction): Paise {
  if (t.type !== 'liability_payment') return 0;
  const principal = t.principalPortion ?? t.amount;
  return Math.max(0, t.amount - principal);
}
export function principalPortion(t: Transaction): Paise {
  return t.type === 'liability_payment' ? Math.min(t.amount, t.principalPortion ?? t.amount) : 0;
}

/** Signed spending contribution of a transaction (I1). */
export function spendingOf(t: Transaction): Paise {
  switch (t.type) {
    case 'expense': return t.amount;
    case 'refund': return -t.amount;
    case 'liability_payment': return interestPortion(t);
    default: return 0;
  }
}
export const incomeOf = (t: Transaction): Paise => (t.type === 'income' ? t.amount : 0);
/** Money moved into long-term holdings (not spending). */
export const investedOf = (t: Transaction): Paise =>
  t.type === 'investment_contribution' || t.type === 'asset_acquisition' ? t.amount
    : t.type === 'investment_redemption' ? -t.amount : 0;
export const debtPaydownOf = (t: Transaction): Paise => principalPortion(t);
export const adjustmentOf = (t: Transaction): Paise => (t.type === 'adjustment' ? t.amount : 0);

export const isSpendingEvent = (t: Transaction) => spendingOf(t) !== 0;

export function isCardPurchase(t: Transaction, accounts: Account[]): boolean {
  if (t.type !== 'expense' || !t.fromAccountId) return false;
  return accounts.find((a) => a.id === t.fromAccountId)?.kind === 'credit_card';
}

/** Which person "owns" the event for person-scoped views. */
export const txnOwner = (t: Transaction): OwnerId => t.ownerId;

/**
 * Balance = opening balance (as at the START of openingDate) + effects of transactions dated on/after openingDate
 * and on/before `asOf` (default: today, so future-dated entries don't change today's figures).
 * Transactions dated before an account's openingDate are history only — they are already inside the opening balance.
 */
export function accountBalances(db: Pick<Database, 'accounts' | 'transactions'>, asOf: string = todayISO()): Map<Id, Paise> {
  const bal = new Map<Id, Paise>();
  const opening = new Map<Id, string>();
  for (const a of db.accounts) { bal.set(a.id, a.openingBalance); opening.set(a.id, a.openingDate); }
  for (const t of db.transactions) {
    if (t.date > asOf) continue;
    for (const e of accountEffects(t)) {
      if (!bal.has(e.accountId)) continue; // dangling ref handled by validation
      if (t.date < opening.get(e.accountId)!) continue;
      bal.set(e.accountId, bal.get(e.accountId)! + e.delta);
    }
  }
  return bal;
}

// ---------------------------------------------------------------- validation
export function validateTransaction(t: Transaction, db: Database, existing?: Transaction): Issue[] {
  const issues: Issue[] = [];
  const bad = (field: string, message: string) => issues.push({ field, message });
  if (!TXN_TYPES.includes(t.type)) { bad('type', 'Unknown transaction type'); return issues; }
  if (!isValidDate(t.date)) bad('date', 'Enter a valid date');
  if (!Number.isInteger(t.amount)) bad('amount', 'Amount must be a whole number of paise');
  else if (t.type === 'adjustment' ? t.amount === 0 : t.amount <= 0) bad('amount', 'Enter an amount greater than zero');
  if (!t.ownerId) bad('ownerId', 'Choose who this belongs to');

  const acct = (id?: Id) => db.accounts.find((a) => a.id === id);
  const needFrom = () => { if (!t.fromAccountId) bad('fromAccountId', 'Choose the paying account'); else if (!acct(t.fromAccountId)) bad('fromAccountId', 'Account not found'); };
  const needTo = () => { if (!t.toAccountId) bad('toAccountId', 'Choose the receiving account'); else if (!acct(t.toAccountId)) bad('toAccountId', 'Account not found'); };
  const noCard = (id: Id | undefined, f: string) => { if (acct(id)?.kind === 'credit_card') bad(f, 'A credit card cannot be used here'); };
  const cardOnly = (id: Id | undefined, f: string) => { if (acct(id) && acct(id)!.kind !== 'credit_card') bad(f, 'Must be a credit card'); };

  switch (t.type) {
    case 'income': needTo(); noCard(t.toAccountId, 'toAccountId'); break;
    case 'expense': needFrom(); break;
    case 'refund': needTo();
      if (t.refundOfId) {
        const orig = db.transactions.find((x) => x.id === t.refundOfId);
        if (!orig || orig.type !== 'expense') bad('refundOfId', 'Refund must refer to an expense');
        else {
          const already = db.transactions.filter((x) => x.type === 'refund' && x.refundOfId === orig.id && x.id !== existing?.id)
            .reduce((s, x) => s + x.amount, 0);
          if (already + t.amount > orig.amount) bad('amount', 'Refunds exceed the original purchase');
        }
      }
      break;
    case 'transfer': needFrom(); needTo(); noCard(t.fromAccountId, 'fromAccountId'); noCard(t.toAccountId, 'toAccountId');
      if (t.fromAccountId && t.fromAccountId === t.toAccountId) bad('toAccountId', 'Choose two different accounts');
      break;
    case 'cc_settlement': needFrom(); needTo(); noCard(t.fromAccountId, 'fromAccountId'); cardOnly(t.toAccountId, 'toAccountId'); break;
    case 'investment_contribution': needFrom(); noCard(t.fromAccountId, 'fromAccountId');
      if (!t.investmentId || !db.investments.some((i) => i.id === t.investmentId)) bad('investmentId', 'Choose an investment'); break;
    case 'investment_redemption': needTo(); noCard(t.toAccountId, 'toAccountId');
      if (!t.investmentId || !db.investments.some((i) => i.id === t.investmentId)) bad('investmentId', 'Choose an investment'); break;
    case 'asset_acquisition': needFrom();
      if (!t.assetId || !db.assets.some((a) => a.id === t.assetId)) bad('assetId', 'Choose an asset'); break;
    case 'liability_creation':
      if (!t.liabilityId || !db.liabilities.some((l) => l.id === t.liabilityId)) bad('liabilityId', 'Choose a liability');
      if (t.toAccountId && !acct(t.toAccountId)) bad('toAccountId', 'Account not found'); break;
    case 'liability_payment': needFrom(); noCard(t.fromAccountId, 'fromAccountId');
      if (!t.liabilityId || !db.liabilities.some((l) => l.id === t.liabilityId)) bad('liabilityId', 'Choose a liability');
      if (t.principalPortion !== undefined && (!Number.isInteger(t.principalPortion) || t.principalPortion < 0 || t.principalPortion > t.amount))
        bad('principalPortion', 'Principal must be between 0 and the payment amount');
      break;
    case 'adjustment': needTo(); break;
  }
  if (t.type === 'expense' && !t.categoryId) bad('categoryId', 'Pick a category');
  if (t.categoryId && !db.categories.some((c) => c.id === t.categoryId)) bad('categoryId', 'Category not found');
  if (t.subcategoryId) {
    const sub = db.categories.find((c) => c.id === t.subcategoryId);
    if (!sub) bad('subcategoryId', 'Subcategory not found');
    else if (sub.parentId !== t.categoryId) bad('subcategoryId', 'Subcategory does not belong to the chosen category');
  }
  return issues;
}
