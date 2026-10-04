/** Credit-card metrics. Bank-reported values override estimates (I6). */
import type { Account, CardReport, Database, Id } from './types';
import type { Paise } from './money';
import { emiState } from './emi';
import { accountBalances, accountEffects } from './ledger';
import { makeDate, monthOf, parseDate, type ISODate } from './dates';

export type Source = 'bank' | 'estimate';
export interface CardMetrics {
  accountId: Id; name: string;
  creditLimit: Paise;
  available: Paise; availableSource: Source;
  used: Paise;
  outstanding: Paise; outstandingSource: Source;
  nonEmiOutstanding: Paise; emiOutstanding: Paise; emiBlocked: Paise;
  utilizationPct: number; overLimit: boolean;
  estimate: { available: Paise; used: Paise; outstanding: Paise };
  reportDate?: ISODate; laterActivityCount: number;
  nextStatementDate?: ISODate; nextDueDate?: ISODate;
  activeEmiCount: number; ledgerCredit: Paise;
}

export function latestReport(db: Pick<Database, 'cardReports'>, accountId: Id): CardReport | undefined {
  return db.cardReports.filter((r) => r.accountId === accountId).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)).pop();
}

export function nextDayOccurrence(day: number | undefined, today: ISODate): ISODate | undefined {
  if (!day || day < 1 || day > 31) return undefined;
  const { y, m } = parseDate(today);
  const thisMonth = makeDate(y, m, day);
  if (thisMonth >= today) return thisMonth;
  return makeDate(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, day);
}

export function cardMetrics(db: Database, card: Account, today: ISODate): CardMetrics {
  const bal = accountBalances(db, undefined).get(card.id) ?? card.openingBalance;
  const ledgerOutstanding = Math.max(0, -bal);
  const emis = db.emis.filter((e) => e.cardAccountId === card.id).map(emiState).filter((s) => s.active);
  const emiOutstanding = emis.reduce((s, e) => s + e.outstanding, 0);
  const blocked = emis.reduce((s, e) => s + e.blocked, 0);
  const inLedger = card.card?.emiInLedger !== false;
  const nonEmi = inLedger ? Math.max(0, ledgerOutstanding - emiOutstanding) : ledgerOutstanding;
  const totalEstimate = inLedger ? ledgerOutstanding : ledgerOutstanding + emiOutstanding;
  const rep = latestReport(db, card.id);
  const limit = rep?.creditLimit ?? card.card?.creditLimit ?? 0;

  const estUsed = nonEmi + blocked;
  const estAvailable = Math.max(0, limit - estUsed);

  // ledger activity after the report date (spend raises outstanding, settlement lowers it)
  let later = 0; let spendSince = 0;
  if (rep) for (const t of db.transactions) {
    if (t.date <= rep.date) continue;
    for (const e of accountEffects(t)) if (e.accountId === card.id) { spendSince += -e.delta; later++; }
  }
  const outstanding = rep?.outstanding !== undefined ? Math.max(0, rep.outstanding + spendSince) + (inLedger ? 0 : (rep.emiOutstanding ?? emiOutstanding)) : totalEstimate;
  const available = rep?.availableLimit !== undefined ? Math.min(limit, Math.max(0, rep.availableLimit - spendSince)) : estAvailable;
  const used = rep?.availableLimit !== undefined ? Math.max(0, limit - available) : estUsed;
  const emiOut = rep?.emiOutstanding ?? emiOutstanding;
  const blockedOut = rep?.emiBlocked ?? blocked;
  const nonEmiOut = rep?.nonEmiOutstanding !== undefined ? Math.max(0, rep.nonEmiOutstanding + spendSince) : rep?.outstanding !== undefined ? (inLedger ? Math.max(0, outstanding - emiOut) : Math.max(0, rep.outstanding + spendSince)) : nonEmi;
  return {
    accountId: card.id, name: card.name, creditLimit: limit, available, availableSource: rep?.availableLimit !== undefined ? 'bank' : 'estimate',
    used, outstanding, outstandingSource: rep?.outstanding !== undefined ? 'bank' : 'estimate',
    nonEmiOutstanding: nonEmiOut, emiOutstanding: emiOut, emiBlocked: blockedOut,
    utilizationPct: limit > 0 ? (used / limit) * 100 : 0, overLimit: limit > 0 && (rep?.availableLimit !== undefined ? rep.availableLimit - spendSince < 0 : estUsed > limit),
    estimate: { available: estAvailable, used: estUsed, outstanding: totalEstimate },
    reportDate: rep?.date, laterActivityCount: later,
    nextStatementDate: nextDayOccurrence(card.card?.statementDay, today), nextDueDate: nextDayOccurrence(card.card?.dueDay, today),
    activeEmiCount: emis.length, ledgerCredit: Math.max(0, bal),
  };
}

/** Estimated reward points for a month, from a USER-SUPPLIED rule. Returns null without a rule. */
export function rewardsEstimate(db: Database, card: Account, month: string) {
  const r = card.card?.rewards;
  if (!r || r.blockAmount <= 0) return null;
  const spend = db.transactions.filter((t) => t.type === 'expense' && t.fromAccountId === card.id && monthOf(t.date) === month && !(t.categoryId && r.excludedCategoryIds.includes(t.categoryId)))
    .reduce((s, t) => s + t.amount, 0);
  const points = Math.floor(spend / r.blockAmount) * r.pointsPerBlock;
  return { eligibleSpend: spend, points, value: points * r.pointValue };
}
