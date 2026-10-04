import type { Database, Id, PaymentMethod, TxnType } from '../domain/types';
export { formatMoney, formatCompact, parseRupees, toPaise, toRupees } from '../domain/money';
export { formatDate, monthLabel } from '../domain/dates';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { upi: 'UPI', credit_card: 'Credit card', debit_card: 'Debit card', cash: 'Cash', bank_transfer: 'Bank transfer', other: 'Other' };
export const TXN_LABELS: Record<TxnType, string> = {
  income: 'Income', expense: 'Expense', refund: 'Refund', transfer: 'Transfer', cc_settlement: 'Card bill payment', investment_contribution: 'Invested', investment_redemption: 'Withdrawn from investment',
  asset_acquisition: 'Asset bought', liability_creation: 'Loan taken', liability_payment: 'Loan payment', adjustment: 'Balance correction',
};
export const accountName = (db: Database, id?: Id) => db.accounts.find((a) => a.id === id)?.name ?? '—';
export const categoryName = (db: Database, id?: Id) => db.categories.find((c) => c.id === id)?.name ?? '';
export const ACCOUNT_KIND_LABELS = { bank: 'Bank account', cash: 'Cash', wallet: 'Wallet', credit_card: 'Credit card', investment: 'Investment account (cash held)' } as const;
