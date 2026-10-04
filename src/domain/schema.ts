/** Tiny structural validator used for backup import and defensive checks. No dependencies. */
import { isValidDate, isValidMonth } from './dates';
import { COLLECTIONS, type CollectionName, type Database } from './types';
import { TXN_TYPES, validateTransaction } from './ledger';
import { defaultSettings } from './seed';
import { validateEmi } from './emi';
import { validateWaste } from './waste';

type Check = (v: unknown) => string | null;
type Spec = Record<string, Check>;

const opt = (c: Check): Check => (v) => (v === undefined ? null : c(v));
const str: Check = (v) => (typeof v === 'string' ? null : 'must be text');
const nstr: Check = (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be non-empty text');
const int: Check = (v) => (Number.isSafeInteger(v) ? null : 'must be a whole number');
const num: Check = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number');
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be true/false');
const date: Check = (v) => (isValidDate(v) ? null : 'must be a valid date (YYYY-MM-DD)');
const ts: Check = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? null : 'must be a timestamp');
const oneOf = (xs: readonly string[]): Check => (v) => (typeof v === 'string' && xs.includes(v) ? null : `must be one of ${xs.join(', ')}`);
const arrOf = (c: Check): Check => (v) => {
  if (!Array.isArray(v)) return 'must be a list';
  for (const x of v) { const e = c(x); if (e) return `item ${e}`; }
  return null;
};
const obj = (spec: Spec): Check => (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'must be an object';
  const e = checkObject(v as Record<string, unknown>, spec);
  return e.length ? e[0] : null;
};
const recordOf = (c: Check): Check => (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'must be an object';
  for (const [k, x] of Object.entries(v)) { const e = c(x); if (e) return `"${k}" ${e}`; }
  return null;
};
const posInt: Check = (v) => (Number.isSafeInteger(v) && (v as number) > 0 ? null : 'must be a positive whole number');

const OWNER = oneOf(['p1', 'p2', 'hh']);
const PAY = oneOf(['upi', 'credit_card', 'debit_card', 'cash', 'bank_transfer', 'other']);
const stamped: Spec = { id: nstr, createdAt: ts, updatedAt: ts };

export function checkObject(o: Record<string, unknown>, spec: Spec): string[] {
  const errs: string[] = [];
  for (const [k, c] of Object.entries(spec)) { const e = c(o[k]); if (e) errs.push(`${k} ${e}`); }
  return errs;
}

const cardDetails = obj({ creditLimit: int, statementDay: opt(int), dueDay: opt(int), emiInLedger: opt(bool), last4: opt((v) => (typeof v === 'string' && /^\d{4}$/.test(v) ? null : 'must be exactly 4 digits')) });

export const SPECS: Record<CollectionName, Spec> = {
  categories: { ...stamped, name: nstr, kind: oneOf(['expense', 'income']), parentId: opt(str), system: opt(str) },
  accounts: { ...stamped, name: nstr, kind: oneOf(['bank', 'cash', 'wallet', 'credit_card', 'investment']), ownerId: OWNER, openingBalance: int, openingDate: date, archived: opt(bool), notes: opt(str), card: opt(cardDetails) },
  cardReports: { ...stamped, accountId: nstr, date, source: oneOf(['statement', 'app', 'sms', 'manual']), creditLimit: opt(int), availableLimit: opt(int), outstanding: opt(int), nonEmiOutstanding: opt(int), emiOutstanding: opt(int), emiBlocked: opt(int) },
  transactions: { ...stamped, type: oneOf(TXN_TYPES), date, amount: int, ownerId: OWNER, fromAccountId: opt(str), toAccountId: opt(str), paymentMethod: opt(PAY), categoryId: opt(str), subcategoryId: opt(str), merchant: opt(str), incomeType: opt(str), tags: opt(arrOf(str)), notes: opt(str), recurring: opt(bool), oneOff: opt(bool), investmentId: opt(str), assetId: opt(str), liabilityId: opt(str), principalPortion: opt(int), refundOfId: opt(str), expectedItemId: opt(str), expectedDate: opt(date) },
  investments: { ...stamped, name: nstr, type: oneOf(['mutual_fund', 'stock', 'fd', 'rd', 'sip', 'ppf_epf', 'other']), institution: opt(str), ownerId: OWNER, notes: opt(str), archived: opt(bool) },
  assets: { ...stamped, name: nstr, kind: oneOf(['gold', 'property', 'vehicle', 'other']), ownerId: OWNER, notes: opt(str), archived: opt(bool) },
  valuations: { ...stamped, targetType: oneOf(['investment', 'asset']), targetId: nstr, date, value: int, invested: opt(int) },
  liabilities: { ...stamped, name: nstr, type: oneOf(['education', 'appliance', 'personal', 'home', 'vehicle', 'other']), ownerId: OWNER, originalPrincipal: int, baselineOutstanding: int, baselineDate: date, emi: int, interestRate: num, startDate: date, endDate: opt(date), paymentDay: opt(int), status: oneOf(['active', 'closed']), notes: opt(str) },
  emis: { ...stamped, name: nstr, cardAccountId: nstr, ownerId: OWNER, originalAmount: int, emiAmount: int, tenure: posInt, startDate: date, paymentDay: opt(int), monthsCompletedAtEntry: int, outstandingAtEntry: int, payments: arrOf((p) => (obj({ id: nstr, date, dueDate: date, principal: int, amount: int })(p))), blockPolicy: oneOf(['as_paid', 'on_completion']), blockedOverride: opt(int), purchaseTxnId: opt(str), status: oneOf(['active', 'completed', 'stopped']), notes: opt(str) },
  expectedItems: { ...stamped, kind: oneOf(['subscription', 'sip', 'salary', 'bill', 'other']), name: nstr, amount: int, frequency: oneOf(['weekly', 'monthly', 'quarterly', 'yearly']), startDate: date, endDate: opt(date), ownerId: OWNER, accountId: opt(str), paymentMethod: opt(PAY), categoryId: opt(str), merchant: opt(str), investmentId: opt(str), incomeType: opt(str), skipped: arrOf(date), confirmed: recordOf(str), lastUsed: opt(date), status: oneOf(['active', 'stopped']), notes: opt(str) },
  goals: { ...stamped, name: nstr, kind: oneOf(['emergency', 'trip', 'land', 'purchase', 'vehicle', 'home', 'wealth', 'other']), ownerId: OWNER, targetAmount: int, targetDate: opt(date), location: opt(str), description: opt(str), status: oneOf(['active', 'achieved', 'paused']) },
  goalAllocations: { ...stamped, goalId: nstr, date, amount: int, ownerId: OWNER, notes: opt(str), sourceKind: opt(oneOf(['account', 'investment', 'asset'])), sourceId: opt(str) },
  wasteEntries: { ...stamped, date, item: nstr, quantity: opt(str), cost: int, category: oneOf(['food', 'groceries', 'product', 'unused', 'spoiled', 'other']), reason: opt(str), ownerId: OWNER, notes: opt(str), txnId: opt(str) },
  snapshots: { ...stamped, date, byOwner: obj({ p1: obj({ assets: int, liabilities: int }), p2: obj({ assets: int, liabilities: int }), hh: obj({ assets: int, liabilities: int }) }) },
};

const SETTINGS_SPEC: Spec = {
  ...stamped,
  people: arrOf((p) => obj({ id: oneOf(['p1', 'p2']), name: nstr, savingsTarget: int })(p)),
  householdName: str, householdSavingsTarget: int, householdSavingsMinimum: int, transportReviewThreshold: int,
  spikeFactor: num, spikeMinimum: int, homeCookSavingsPct: num, localMarketSavingsPct: num, subscriptionReviewDays: int,
  incomeTypes: arrOf(nstr), lockEnabled: bool, monthNotes: (v) => recordOf(str)(v) ?? (typeof v === 'object' && v && Object.keys(v).every(isValidMonth) ? null : 'keys must be months'),
  defaults: obj({}), lastBackupAt: opt(ts),
};

export interface ValidationResult { errors: string[]; warnings: string[] }
const MAX_REPORTED = 40;

/** Structural + referential + business-rule validation of a full database. */
export function validateDatabase(input: unknown): ValidationResult & { db?: Database } {
  const errors: string[] = []; const warnings: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { errors: ['Data section is not an object.'], warnings };
  const d = input as Record<string, unknown>;
  const push = (arr: string[], m: string) => { if (arr.length < MAX_REPORTED) arr.push(m); else if (arr.length === MAX_REPORTED) arr.push('…and more problems (list truncated).'); };

  if (!d.settings) push(warnings, 'Settings missing — defaults will be used.');
  else for (const e of checkObject(d.settings as Record<string, unknown>, SETTINGS_SPEC)) push(errors, `settings: ${e}`);

  for (const c of COLLECTIONS) {
    const rows = d[c];
    if (rows === undefined) { push(warnings, `Section "${c}" is missing and is treated as empty.`); continue; }
    if (!Array.isArray(rows)) { push(errors, `Section "${c}" must be a list.`); continue; }
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (typeof r !== 'object' || r === null || Array.isArray(r)) { push(errors, `${c}[${i}] is not an object.`); return; }
      const rec = r as Record<string, unknown>;
      for (const e of checkObject(rec, SPECS[c])) push(errors, `${c}[${i}] ${e}`);
      if (typeof rec.id === 'string') { if (seen.has(rec.id)) push(errors, `${c}: duplicate id "${rec.id}".`); seen.add(rec.id); }
    });
  }
  if (d.tombstones !== undefined) {
    if (!Array.isArray(d.tombstones) || d.tombstones.some((t) => typeof t !== 'object' || !t || typeof (t as any).key !== 'string' || typeof (t as any).deletedAt !== 'string')) push(errors, 'Section "tombstones" is malformed.');
  }
  if (errors.length) return { errors, warnings };

  const full = { ...d, tombstones: d.tombstones ?? [] } as unknown as Database;
  for (const c of COLLECTIONS) if (!Array.isArray((full as any)[c])) (full as any)[c] = [];
  // referential integrity
  const ids = (c: CollectionName) => new Set(((full as any)[c] as { id: string }[]).map((x) => x.id));
  const accounts = ids('accounts'), cats = ids('categories'), invs = ids('investments'), assets = ids('assets'), liabs = ids('liabilities'), goals = ids('goals'), txns = ids('transactions');
  const ref = (what: string, id: string | undefined, set: Set<string>, where: string) => { if (id && !set.has(id)) push(errors, `${where} refers to a missing ${what} ("${id}").`); };
  full.transactions.forEach((t, i) => {
    const w = `transactions[${i}]`;
    ref('account', t.fromAccountId, accounts, w); ref('account', t.toAccountId, accounts, w);
    ref('investment', t.investmentId, invs, w); ref('asset', t.assetId, assets, w); ref('liability', t.liabilityId, liabs, w);
    ref('category', t.categoryId, cats, w); ref('category', t.subcategoryId, cats, w); ref('transaction', t.refundOfId, txns, w);
  });
  full.cardReports.forEach((r, i) => ref('account', r.accountId, accounts, `cardReports[${i}]`));
  full.emis.forEach((e, i) => ref('account', e.cardAccountId, accounts, `emis[${i}]`));
  full.valuations.forEach((v, i) => ref(v.targetType, v.targetId, v.targetType === 'investment' ? invs : assets, `valuations[${i}]`));
  full.goalAllocations.forEach((a, i) => {
    ref('goal', a.goalId, goals, `goalAllocations[${i}]`);
    if (!!a.sourceKind !== !!a.sourceId) push(errors, `goalAllocations[${i}] needs both sourceKind and sourceId, or neither.`);
    if (a.sourceKind) ref(a.sourceKind, a.sourceId, a.sourceKind === 'account' ? accounts : a.sourceKind === 'investment' ? invs : assets, `goalAllocations[${i}] source`);
  });
  full.categories.forEach((c, i) => ref('parent category', c.parentId, cats, `categories[${i}]`));
  full.expectedItems.forEach((e, i) => { ref('account', e.accountId, accounts, `expectedItems[${i}]`); ref('investment', e.investmentId, invs, `expectedItems[${i}]`); });
  if (errors.length) return { errors, warnings };
  // value rules the app's own forms enforce (imports must not bypass them)
  const neg = (where: string, n: number | undefined, label: string, min = 0) => { if (n !== undefined && n < min) push(errors, `${where} ${label} must be ${min === 0 ? 'zero or more' : 'positive'}.`); };
  if (full.settings) {
    const ps = full.settings.people;
    if (!(ps.length === 2 && ps[0].id === 'p1' && ps[1].id === 'p2')) push(errors, 'settings: exactly two people (p1 and p2) are required.');
    for (const k of ['householdSavingsTarget', 'householdSavingsMinimum', 'transportReviewThreshold', 'spikeMinimum'] as const) neg('settings', full.settings[k], k);
    ps.forEach((p) => neg('settings.people', p.savingsTarget, 'savingsTarget'));
    if (full.settings.spikeFactor < 1) push(errors, 'settings: spikeFactor must be at least 1.');
  }
  full.accounts.forEach((a, i) => { if (a.kind === 'credit_card') { if (!a.card || !(a.card.creditLimit > 0)) push(errors, `accounts[${i}] credit card needs a credit limit.`); if (a.openingBalance > 0) push(errors, `accounts[${i}] card opening balance must not be positive.`); } });
  full.cardReports.forEach((r, i) => (['creditLimit', 'availableLimit', 'outstanding', 'nonEmiOutstanding', 'emiOutstanding', 'emiBlocked'] as const).forEach((k) => neg(`cardReports[${i}]`, r[k], k)));
  full.valuations.forEach((v, i) => { neg(`valuations[${i}]`, v.value, 'value'); neg(`valuations[${i}]`, v.invested, 'invested'); });
  full.liabilities.forEach((l, i) => { neg(`liabilities[${i}]`, l.originalPrincipal, 'originalPrincipal'); neg(`liabilities[${i}]`, l.baselineOutstanding, 'baselineOutstanding'); neg(`liabilities[${i}]`, l.emi, 'emi'); if (l.interestRate < 0 || l.interestRate > 100) push(errors, `liabilities[${i}] interestRate must be 0–100.`); });
  full.emis.forEach((e, i) => { for (const is of validateEmi(e)) push(errors, `emis[${i}] ${is.field}: ${is.message}`); });
  full.expectedItems.forEach((e, i) => neg(`expectedItems[${i}]`, e.amount, 'amount', 1));
  full.goals.forEach((g, i) => neg(`goals[${i}]`, g.targetAmount, 'targetAmount', 1));
  full.goalAllocations.forEach((a, i) => { if (a.amount === 0) push(errors, `goalAllocations[${i}] amount must not be zero.`); });
  full.wasteEntries.forEach((w, i) => { for (const is of validateWaste(w)) push(errors, `wasteEntries[${i}] ${is.field}: ${is.message}`); });
  if (errors.length) return { errors, warnings };
  // business rules (reported as errors: such data would corrupt balances)
  full.transactions.forEach((t, i) => {
    for (const is of validateTransaction(t, full, t)) push(errors, `transactions[${i}] ${is.field}: ${is.message}`);
  });
  if (errors.length) return { errors, warnings };
  if (!full.settings) full.settings = defaultSettings(new Date().toISOString());
  return { errors, warnings, db: full };
}
