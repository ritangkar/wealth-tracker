/** Credit-card EMI engine. Never creates transactions (I5). */
import type { Emi, EmiPayment, Id } from './types';
import type { Paise } from './money';
import { addMonths, isValidDate, type ISODate } from './dates';

export interface EmiState {
  monthsCompleted: number; monthsRemaining: number; outstanding: Paise; blocked: Paise;
  completed: boolean; active: boolean; nextDueDate: ISODate | null; paidPrincipal: Paise;
  /** Total interest/fees over the life vs. original amount; informational. */
  totalInterestCost: Paise;
}

export function emiState(e: Emi): EmiState {
  const monthsCompleted = Math.min(e.tenure, e.monthsCompletedAtEntry + e.payments.length);
  const paidPrincipal = e.payments.reduce((s, p) => s + p.principal, 0);
  const done = e.status === 'completed' || monthsCompleted >= e.tenure;
  const stopped = e.status === 'stopped';
  const monthsRemaining = done || stopped ? 0 : e.tenure - monthsCompleted;
  const outstanding = done || stopped ? 0 : Math.max(0, e.outstandingAtEntry - paidPrincipal);
  let blocked = 0;
  if (!done && !stopped) {
    blocked = e.blockedOverride !== undefined ? e.blockedOverride : e.blockPolicy === 'on_completion' ? e.originalAmount : outstanding;
  }
  return {
    monthsCompleted, monthsRemaining, outstanding, blocked, completed: done, active: !done && !stopped,
    nextDueDate: done || stopped ? null : addMonths(e.startDate, monthsCompleted),
    paidPrincipal,
    totalInterestCost: Math.max(0, e.emiAmount * e.tenure - e.originalAmount),
  };
}

export interface NewEmiInput {
  name: string; cardAccountId: Id; ownerId: Emi['ownerId']; originalAmount: Paise; emiAmount: Paise; tenure: number;
  startDate: ISODate; paymentDay?: number; blockPolicy?: Emi['blockPolicy']; notes?: string; purchaseTxnId?: Id;
  /** Existing EMI: instalments already paid before entering it here. */
  monthsCompleted?: number;
  /** Existing EMI: principal remaining if known; otherwise estimated pro-rata (labelled estimate). */
  outstanding?: Paise;
  blockedOverride?: Paise;
  now: string; id: Id;
}
export function buildEmi(i: NewEmiInput): { emi: Emi; outstandingEstimated: boolean } {
  const done = i.monthsCompleted ?? 0;
  const remaining = Math.max(0, i.tenure - done);
  const estimated = i.outstanding === undefined && done > 0;
  const outstanding = i.outstanding ?? (done === 0 ? i.originalAmount : Math.round((i.originalAmount * remaining) / i.tenure));
  return {
    outstandingEstimated: estimated,
    emi: {
      id: i.id, createdAt: i.now, updatedAt: i.now, name: i.name, cardAccountId: i.cardAccountId, ownerId: i.ownerId,
      originalAmount: i.originalAmount, emiAmount: i.emiAmount, tenure: i.tenure, startDate: i.startDate, paymentDay: i.paymentDay,
      monthsCompletedAtEntry: done, outstandingAtEntry: remaining === 0 ? 0 : outstanding, payments: [],
      blockPolicy: i.blockPolicy ?? 'as_paid', blockedOverride: i.blockedOverride, purchaseTxnId: i.purchaseTxnId, status: remaining === 0 ? 'completed' : 'active', notes: i.notes,
    },
  };
}

export function validateEmi(e: Emi): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  const bad = (field: string, message: string) => out.push({ field, message });
  if (!e.name.trim()) bad('name', 'Give this EMI a name');
  if (!Number.isInteger(e.originalAmount) || e.originalAmount <= 0) bad('originalAmount', 'Enter the original amount');
  if (!Number.isInteger(e.emiAmount) || e.emiAmount <= 0) bad('emiAmount', 'Enter the monthly EMI');
  if (!Number.isInteger(e.tenure) || e.tenure < 1 || e.tenure > 360) bad('tenure', 'Tenure must be 1–360 months');
  if (!Number.isInteger(e.monthsCompletedAtEntry) || e.monthsCompletedAtEntry < 0 || e.monthsCompletedAtEntry > e.tenure) bad('monthsCompleted', 'Months completed must be between 0 and the tenure');
  if (e.outstandingAtEntry < 0 || e.outstandingAtEntry > e.originalAmount * 2) bad('outstanding', 'Outstanding looks wrong');
  if (!isValidDate(e.startDate)) bad('startDate', 'Enter a valid start date');
  if (!e.cardAccountId) bad('cardAccountId', 'Choose the card');
  return out;
}

/** Confirm one instalment. Returns updated EMI or an error. No transaction is created. */
export function confirmInstalment(e: Emi, opts: { dueDate: ISODate; date: ISODate; amount?: Paise; id: Id; now: string }): { emi?: Emi; error?: string } {
  const s = emiState(e);
  if (!s.active) return { error: 'This EMI is not active' };
  if (e.payments.some((p) => p.dueDate === opts.dueDate)) return { error: 'This instalment is already confirmed' };
  const principal = s.monthsRemaining === 1 ? s.outstanding : Math.min(s.outstanding, Math.round(s.outstanding / s.monthsRemaining));
  const payment: EmiPayment = { id: opts.id, date: opts.date, dueDate: opts.dueDate, principal, amount: opts.amount ?? e.emiAmount };
  const next: Emi = { ...e, payments: [...e.payments, payment], updatedAt: opts.now };
  if (emiState(next).monthsRemaining === 0) next.status = 'completed';
  return { emi: next };
}

export function undoLastInstalment(e: Emi, now: string): Emi {
  if (!e.payments.length) return e;
  const payments = e.payments.slice(0, -1);
  return { ...e, payments, status: e.status === 'completed' && e.monthsCompletedAtEntry + payments.length < e.tenure ? 'active' : e.status, updatedAt: now };
}
