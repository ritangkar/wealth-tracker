/**
 * Reactive in-memory store with write-through persistence.
 * All domain mutations go through here so validation + tombstones + persistence stay consistent.
 */
import { COLLECTIONS, SCHEMA_VERSION, type Account, type Asset, type Category, type CardReport, type CollectionName, type Database, type Emi, type ExpectedItem, type Goal, type GoalAllocation, type Id, type Investment, type Liability, type NetWorthSnapshot, type Settings, type Transaction, type Valuation, type WasteEntry } from '../domain/types';
import { validateTransaction, accountBalances, type Issue } from '../domain/ledger';
import { validateAllocation } from '../domain/goals';
import { validateWaste } from '../domain/waste';
import { buildEmi, confirmInstalment, undoLastInstalment, validateEmi, type NewEmiInput } from '../domain/emi';
import { draftFromOccurrence } from '../domain/expected';
import { buildSnapshot } from '../domain/networth';
import { validateDatabase } from '../domain/schema';
import { emptyDatabase } from '../domain/seed';
import { todayISO, isValidDate, type ISODate } from '../domain/dates';
import { newId } from './id';
import { createBackup, mergeDatabases, serializeBackup, type BackupFile } from './backup';
import { migrateData } from './migrations';
import type { Op, Storage } from './storage';

export type Result<T = void> = { ok: true; value: T } | { ok: false; issues: Issue[] };
const fail = (message: string, field = '_'): { ok: false; issues: Issue[] } => ({ ok: false, issues: [{ field, message }] });
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });

type Stamp = 'id' | 'createdAt' | 'updatedAt';
export type Draft<T> = Omit<T, Stamp>;

export interface StoreOptions { now?: () => Date; idGen?: (prefix: string) => string; appVersion?: string }
export type StoreStatus = 'ready' | 'recovery';

class Tx {
  ops: Op[] = [];
  constructor(public db: Database, private nowIso: string) {}
  put<C extends Exclude<CollectionName, never>>(c: C, e: Database[C][number]) {
    const arr = this.db[c] as { id: Id }[];
    const i = arr.findIndex((x) => x.id === (e as { id: Id }).id);
    const next = i >= 0 ? arr.map((x, j) => (j === i ? e : x)) : [...arr, e];
    this.db = { ...this.db, [c]: next } as Database;
    this.ops.push({ kind: 'put', collection: c, value: e as { id: Id } });
  }
  del(c: CollectionName, id: Id) {
    this.db = { ...this.db, [c]: (this.db[c] as { id: Id }[]).filter((x) => x.id !== id) } as Database;
    this.ops.push({ kind: 'delete', collection: c, id });
    const t = { key: `${c}:${id}`, collection: c, id, deletedAt: this.nowIso };
    this.db = { ...this.db, tombstones: [...this.db.tombstones.filter((x) => x.key !== t.key), t] };
    this.ops.push({ kind: 'tombstone', value: t });
  }
  settings(s: Settings) { this.db = { ...this.db, settings: s }; this.ops.push({ kind: 'settings', value: s }); }
}

export class Store {
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private _db: Database;
  status: StoreStatus = 'ready';
  recovery?: { errors: string[]; raw: string };
  persistError?: string;
  readonly appVersion: string;
  private clock: () => Date; private gen: (p: string) => string;

  private constructor(private storage: Storage, db: Database, opts: StoreOptions) {
    this._db = db; this.clock = opts.now ?? (() => new Date()); this.gen = opts.idGen ?? newId; this.appVersion = opts.appVersion ?? 'dev';
  }

  /** Load from storage (migrating if needed). Invalid stored data → recovery mode, storage untouched. */
  static async open(storage: Storage, opts: StoreOptions = {}): Promise<Store> {
    const clock = opts.now ?? (() => new Date());
    const loaded = await storage.load();
    if (!loaded) {
      const db = emptyDatabase(clock().toISOString());
      await storage.replaceAll(db, SCHEMA_VERSION);
      return new Store(storage, db, opts);
    }
    let data: any = loaded.db;
    if (loaded.schemaVersion > SCHEMA_VERSION) {
      const s = new Store(storage, emptyDatabase(), opts); s.status = 'recovery';
      s.recovery = { errors: [`Stored data is from a newer app version (schema ${loaded.schemaVersion}). Please update the app. Your data has not been changed.`], raw: JSON.stringify(loaded.db) };
      return s;
    }
    try {
      if (loaded.schemaVersion < SCHEMA_VERSION) {
        data = migrateData(data, loaded.schemaVersion, SCHEMA_VERSION);
      }
    } catch (e) { const s = new Store(storage, emptyDatabase(), opts); s.status = 'recovery'; s.recovery = { errors: [(e as Error).message], raw: JSON.stringify(loaded.db) }; return s; }
    const v = validateDatabase(data);
    if (!v.db) { const s = new Store(storage, emptyDatabase(), opts); s.status = 'recovery'; s.recovery = { errors: v.errors, raw: JSON.stringify(loaded.db) }; return s; }
    const store = new Store(storage, v.db, opts);
    if (loaded.schemaVersion < SCHEMA_VERSION) await storage.replaceAll(v.db, SCHEMA_VERSION);
    return store;
  }

  get db(): Database { return this._db; }
  get meta() { return this.storage; }
  now() { return this.clock().toISOString(); }
  today(): ISODate { return todayISO(this.clock()); }
  newId(prefix: string) { return this.gen(prefix); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }

  /** Serialised commit: build next state, validate, apply optimistically, persist, roll back on failure. */
  private commit<T>(build: (tx: Tx) => Result<T>): Promise<Result<T>> {
    const run = async (): Promise<Result<T>> => {
      if (this.status !== 'ready') return fail('The app is in recovery mode; changes are disabled.');
      const tx = new Tx(this._db, this.now());
      const r = build(tx);
      if (!r.ok) return r;
      const prev = this._db;
      this._db = tx.db; this.emit();
      try { await this.storage.apply(tx.ops); this.persistError = undefined; }
      catch (e) { this._db = prev; this.persistError = (e as Error).message; this.emit(); return fail(`Could not save: ${(e as Error).message}`); }
      return r;
    };
    const p = this.queue.then(run, run); this.queue = p.catch(() => undefined); return p;
  }

  private stamp<T>(d: Draft<T>, prefix: string, _tx?: Tx): T { const n = this.now(); return { ...d, id: this.gen(prefix), createdAt: n, updatedAt: n } as T; }

  // ------------------------------------------------------------ transactions
  addTransaction(d: Draft<Transaction>) {
    return this.commit<Transaction>((tx) => {
      const t = this.stamp<Transaction>(clean(d), 'txn', tx);
      const issues = validateTransaction(t, tx.db); if (issues.length) return { ok: false, issues };
      tx.put('transactions', t); return ok(t);
    });
  }
  updateTransaction(id: Id, patch: Partial<Draft<Transaction>>) {
    return this.commit<Transaction>((tx) => {
      const old = tx.db.transactions.find((t) => t.id === id); if (!old) return fail('Transaction not found');
      const t: Transaction = clean({ ...old, ...patch, id, createdAt: old.createdAt, updatedAt: this.now() });
      const issues = validateTransaction(t, tx.db, old);
      if (t.type === 'expense') {
        const refunded = tx.db.transactions.filter((x) => x.type === 'refund' && x.refundOfId === id).reduce((s, x) => s + x.amount, 0);
        if (refunded > t.amount) issues.push({ field: 'amount', message: 'Amount is below the refunds already recorded against it' });
      } else if (tx.db.transactions.some((x) => x.refundOfId === id)) issues.push({ field: 'type', message: 'This purchase has refunds linked to it' });
      if (issues.length) return { ok: false, issues };
      tx.put('transactions', t); return ok(t);
    });
  }
  deleteTransaction(id: Id) {
    return this.commit((tx) => {
      const t = tx.db.transactions.find((x) => x.id === id); if (!t) return fail('Transaction not found');
      if (tx.db.transactions.some((x) => x.refundOfId === id)) return fail('Delete the linked refunds first');
      for (const e of tx.db.expectedItems) {
        const dates = Object.entries(e.confirmed).filter(([, v]) => v === id).map(([k]) => k);
        if (dates.length) { const confirmed = { ...e.confirmed }; dates.forEach((d) => delete confirmed[d]); tx.put('expectedItems', { ...e, confirmed, updatedAt: this.now() }); }
      }
      for (const w of tx.db.wasteEntries) if (w.txnId === id) tx.put('wasteEntries', { ...w, txnId: undefined, updatedAt: this.now() });
      tx.del('transactions', id); return ok(undefined);
    });
  }

  // ------------------------------------------------------------ accounts
  addAccount(d: Draft<Account>) {
    return this.commit<Account>((tx) => {
      const a = this.stamp<Account>(clean(d), 'acc', tx);
      const issues: Issue[] = [];
      if (!a.name.trim()) issues.push({ field: 'name', message: 'Give the account a name' });
      if (!Number.isInteger(a.openingBalance)) issues.push({ field: 'openingBalance', message: 'Enter a valid balance' });
      if (a.kind === 'credit_card' && !(a.card && a.card.creditLimit > 0)) issues.push({ field: 'creditLimit', message: 'Enter the credit limit' });
      if (a.kind === 'credit_card' && a.openingBalance > 0) issues.push({ field: 'openingBalance', message: 'Card opening balance is the outstanding, stored as negative' });
      if (issues.length) return { ok: false, issues };
      tx.put('accounts', a); return ok(a);
    });
  }
  updateAccount(id: Id, patch: Partial<Draft<Account>>) {
    return this.commit<Account>((tx) => {
      const o = tx.db.accounts.find((a) => a.id === id); if (!o) return fail('Account not found');
      const a = clean({ ...o, ...patch, id, createdAt: o.createdAt, updatedAt: this.now() }) as Account;
      if (a.kind !== o.kind && (tx.db.transactions.some((t) => t.fromAccountId === id || t.toAccountId === id))) return fail('Account type cannot change once it has transactions', 'kind');
      if (!a.name.trim()) return fail('Give the account a name', 'name');
      if (a.kind === 'credit_card' && !(a.card && a.card.creditLimit > 0)) return fail('Enter the credit limit', 'creditLimit');
      tx.put('accounts', a); return ok(a);
    });
  }
  deleteAccount(id: Id) {
    return this.commit((tx) => {
      const d = tx.db;
      if (d.transactions.some((t) => t.fromAccountId === id || t.toAccountId === id) || d.emis.some((e) => e.cardAccountId === id) || d.expectedItems.some((e) => e.accountId === id))
        return fail('This account is used by records. Archive it instead.');
      d.cardReports.filter((r) => r.accountId === id).forEach((r) => tx.del('cardReports', r.id));
      tx.del('accounts', id); return ok(undefined);
    });
  }

  // ------------------------------------------------------------ categories
  addCategory(d: Draft<Category>) {
    return this.commit<Category>((tx) => {
      const name = d.name.trim(); if (!name) return fail('Enter a name', 'name');
      if (tx.db.categories.some((c) => c.parentId === d.parentId && c.kind === d.kind && c.name.toLowerCase() === name.toLowerCase())) return fail('That name already exists here', 'name');
      if (d.parentId && !tx.db.categories.some((c) => c.id === d.parentId && !c.parentId)) return fail('Parent must be a top-level category', 'parentId');
      const c = this.stamp<Category>(clean({ ...d, name }), 'cat', tx); tx.put('categories', c); return ok(c);
    });
  }
  renameCategory(id: Id, name: string) {
    return this.commit<Category>((tx) => {
      const o = tx.db.categories.find((c) => c.id === id); if (!o) return fail('Not found');
      if (!name.trim()) return fail('Enter a name', 'name');
      const c = { ...o, name: name.trim(), updatedAt: this.now() }; tx.put('categories', c); return ok(c);
    });
  }
  deleteCategory(id: Id) {
    return this.commit((tx) => {
      const d = tx.db;
      if (d.categories.some((c) => c.parentId === id)) return fail('Remove its subcategories first');
      if (d.transactions.some((t) => t.categoryId === id || t.subcategoryId === id) || d.expectedItems.some((e) => e.categoryId === id)) return fail('Used by transactions — rename it instead');
      tx.del('categories', id); return ok(undefined);
    });
  }

  // ------------------------------------------------------------ generic simple entities
  private upsertSimple<C extends 'investments' | 'assets' | 'liabilities' | 'goals'>(c: C, prefix: string, d: Draft<Database[C][number]> & { name: string }, id?: Id, extra?: (tx: Tx, e: Database[C][number]) => Issue[]) {
    return this.commit<Database[C][number]>((tx) => {
      if (!d.name.trim()) return fail('Enter a name', 'name');
      const old = id ? (tx.db[c] as any[]).find((x) => x.id === id) : undefined;
      if (id && !old) return fail('Not found');
      const e = (old ? clean({ ...old, ...d, id, createdAt: old.createdAt, updatedAt: this.now() }) : this.stamp<any>(clean(d), prefix, tx)) as Database[C][number];
      const issues = extra?.(tx, e) ?? []; if (issues.length) return { ok: false, issues };
      tx.put(c as any, e as any); return ok(e);
    });
  }
  saveInvestment(d: Draft<Investment>, id?: Id) { return this.upsertSimple('investments', 'inv', d, id); }
  saveAsset(d: Draft<Asset>, id?: Id) { return this.upsertSimple('assets', 'ast', d, id); }
  saveGoal(d: Draft<Goal>, id?: Id) {
    return this.upsertSimple('goals', 'goal', d, id, (_tx, g) => (g.targetAmount > 0 && Number.isInteger(g.targetAmount) ? [] : [{ field: 'targetAmount', message: 'Enter a target amount' }]));
  }
  saveLiability(d: Draft<Liability>, id?: Id) {
    return this.upsertSimple('liabilities', 'loan', d, id, (_tx, l) => {
      const i: Issue[] = [];
      if (![l.originalPrincipal, l.baselineOutstanding, l.emi].every(Number.isInteger) || l.originalPrincipal < 0 || l.baselineOutstanding < 0 || l.emi < 0) i.push({ field: 'originalPrincipal', message: 'Enter valid amounts' });
      if (!isValidDate(l.startDate) || !isValidDate(l.baselineDate)) i.push({ field: 'startDate', message: 'Enter valid dates' });
      if (l.interestRate < 0 || l.interestRate > 100) i.push({ field: 'interestRate', message: 'Interest must be between 0 and 100%' });
      return i;
    });
  }
  deleteHolding(kind: 'investment' | 'asset', id: Id) {
    return this.commit((tx) => {
      if (tx.db.transactions.some((t) => t.investmentId === id || t.assetId === id)) return fail('This has transactions linked to it. Archive it instead.');
      if (tx.db.expectedItems.some((e) => e.investmentId === id)) return fail('A recurring item uses this. Remove that first.');
      tx.db.valuations.filter((v) => v.targetId === id).forEach((v) => tx.del('valuations', v.id));
      tx.del(kind === 'investment' ? 'investments' : 'assets', id); return ok(undefined);
    });
  }
  deleteLiability(id: Id) {
    return this.commit((tx) => {
      if (tx.db.transactions.some((t) => t.liabilityId === id)) return fail('This has payments recorded. Close it instead.');
      tx.del('liabilities', id); return ok(undefined);
    });
  }
  deleteGoal(id: Id) {
    return this.commit((tx) => { tx.db.goalAllocations.filter((a) => a.goalId === id).forEach((a) => tx.del('goalAllocations', a.id)); tx.del('goals', id); return ok(undefined); });
  }

  // ------------------------------------------------------------ valuations (investments & assets)
  addValuation(d: Draft<Valuation>) {
    return this.commit<Valuation>((tx) => {
      const exists = d.targetType === 'investment' ? tx.db.investments.some((i) => i.id === d.targetId) : tx.db.assets.some((a) => a.id === d.targetId);
      if (!exists) return fail('Item not found');
      if (!isValidDate(d.date)) return fail('Enter a valid date', 'date');
      if (!Number.isInteger(d.value) || d.value < 0) return fail('Enter a valid value', 'value');
      if (d.invested !== undefined && (!Number.isInteger(d.invested) || d.invested < 0)) return fail('Enter a valid invested amount', 'invested');
      // one snapshot per item per day: replace
      const same = tx.db.valuations.find((v) => v.targetId === d.targetId && v.date === d.date);
      const v = same ? clean({ ...same, ...d, id: same.id, createdAt: same.createdAt, updatedAt: this.now() }) : this.stamp<Valuation>(clean(d), 'val', tx);
      tx.put('valuations', v); return ok(v);
    });
  }
  deleteValuation(id: Id) { return this.commit((tx) => { tx.del('valuations', id); return ok(undefined); }); }

  // ------------------------------------------------------------ credit card reports & EMIs
  /** Save a bank-reported card snapshot. Optionally add a reconciling adjustment so the ledger matches the reported outstanding. */
  addCardReport(d: Draft<CardReport>, opts: { reconcile?: boolean } = {}) {
    return this.commit<CardReport>((tx) => {
      const acc = tx.db.accounts.find((a) => a.id === d.accountId && a.kind === 'credit_card'); if (!acc) return fail('Card not found');
      if (!isValidDate(d.date)) return fail('Enter a valid date', 'date');
      for (const k of ['creditLimit', 'availableLimit', 'outstanding', 'nonEmiOutstanding', 'emiOutstanding', 'emiBlocked'] as const) {
        const v = d[k]; if (v !== undefined && (!Number.isInteger(v) || v < 0)) return fail('Amounts must be zero or more', k);
      }
      if (d.creditLimit === undefined && d.availableLimit === undefined && d.outstanding === undefined && d.nonEmiOutstanding === undefined && d.emiOutstanding === undefined && d.emiBlocked === undefined) return fail('Enter at least one value from your bank');
      const r = this.stamp<CardReport>(clean(d), 'rep', tx); tx.put('cardReports', r);
      if (opts.reconcile && d.outstanding !== undefined) {
        const bal = accountBalances({ accounts: tx.db.accounts, transactions: tx.db.transactions.filter((t) => t.date <= d.date) }).get(acc.id) ?? 0;
        const diff = -d.outstanding - bal; // desired balance - current
        if (diff !== 0) {
          const n = this.now();
          tx.put('transactions', { id: this.gen('txn'), type: 'adjustment', date: d.date, amount: diff, ownerId: acc.ownerId, toAccountId: acc.id, notes: 'Reconciled to bank-reported outstanding', createdAt: n, updatedAt: n });
        }
      }
      return ok(r);
    });
  }
  deleteCardReport(id: Id) { return this.commit((tx) => { tx.del('cardReports', id); return ok(undefined); }); }

  addEmi(i: Omit<NewEmiInput, 'id' | 'now'>) {
    return this.commit<{ emi: Emi; outstandingEstimated: boolean }>((tx) => {
      if (!tx.db.accounts.some((a) => a.id === i.cardAccountId && a.kind === 'credit_card')) return fail('Choose a credit card', 'cardAccountId');
      const built = buildEmi({ ...i, id: this.gen('emi'), now: this.now() });
      const issues = validateEmi(built.emi); if (issues.length) return { ok: false, issues };
      tx.put('emis', built.emi); return ok(built);
    });
  }
  updateEmi(id: Id, patch: Partial<Draft<Emi>>) {
    return this.commit<Emi>((tx) => {
      const o = tx.db.emis.find((e) => e.id === id); if (!o) return fail('EMI not found');
      const e = clean({ ...o, ...patch, id, createdAt: o.createdAt, updatedAt: this.now() }) as Emi;
      const issues = validateEmi(e); if (issues.length) return { ok: false, issues };
      tx.put('emis', e); return ok(e);
    });
  }
  /** Confirms an EMI instalment. Deliberately creates NO transaction. */
  confirmEmiInstalment(id: Id, opts: { dueDate: ISODate; date: ISODate; amount?: number }) {
    return this.commit<Emi>((tx) => {
      const o = tx.db.emis.find((e) => e.id === id); if (!o) return fail('EMI not found');
      const r = confirmInstalment(o, { ...opts, id: this.gen('pay'), now: this.now() });
      if (!r.emi) return fail(r.error!);
      tx.put('emis', r.emi); return ok(r.emi);
    });
  }
  undoEmiInstalment(id: Id) {
    return this.commit<Emi>((tx) => { const o = tx.db.emis.find((e) => e.id === id); if (!o) return fail('EMI not found'); const e = undoLastInstalment(o, this.now()); tx.put('emis', e); return ok(e); });
  }
  deleteEmi(id: Id) { return this.commit((tx) => { tx.del('emis', id); return ok(undefined); }); }

  // ------------------------------------------------------------ expected items
  saveExpected(d: Draft<ExpectedItem>, id?: Id) {
    return this.commit<ExpectedItem>((tx) => {
      if (!d.name.trim()) return fail('Enter a name', 'name');
      if (!Number.isInteger(d.amount) || d.amount <= 0) return fail('Enter an amount', 'amount');
      if (!isValidDate(d.startDate)) return fail('Enter a valid start date', 'startDate');
      const old = id ? tx.db.expectedItems.find((e) => e.id === id) : undefined; if (id && !old) return fail('Not found');
      const e = (old ? clean({ ...old, ...d, id, createdAt: old.createdAt, updatedAt: this.now() }) : this.stamp<ExpectedItem>(clean(d), 'exp', tx)) as ExpectedItem;
      tx.put('expectedItems', e); return ok(e);
    });
  }
  /** User confirms an occurrence → creates the real transaction (optionally edited). */
  confirmOccurrence(itemId: Id, date: ISODate, overrides: Partial<Draft<Transaction>> = {}) {
    return this.commit<Transaction>((tx) => {
      const item = tx.db.expectedItems.find((e) => e.id === itemId); if (!item) return fail('Not found');
      if (item.confirmed[date] && tx.db.transactions.some((t) => t.id === item.confirmed[date])) return fail('Already confirmed');
      const t = this.stamp<Transaction>(clean({ ...draftFromOccurrence(item, date), ...overrides }), 'txn', tx);
      const issues = validateTransaction(t, tx.db); if (issues.length) return { ok: false, issues };
      tx.put('transactions', t);
      tx.put('expectedItems', { ...item, confirmed: { ...item.confirmed, [date]: t.id }, skipped: item.skipped.filter((d) => d !== date), updatedAt: this.now() });
      return ok(t);
    });
  }
  skipOccurrence(itemId: Id, date: ISODate, skip = true) {
    return this.commit((tx) => {
      const item = tx.db.expectedItems.find((e) => e.id === itemId); if (!item) return fail('Not found');
      const skipped = skip ? [...new Set([...item.skipped, date])] : item.skipped.filter((d) => d !== date);
      tx.put('expectedItems', { ...item, skipped, updatedAt: this.now() }); return ok(undefined);
    });
  }
  stopExpected(itemId: Id, resume = false) {
    return this.commit((tx) => {
      const item = tx.db.expectedItems.find((e) => e.id === itemId); if (!item) return fail('Not found');
      const next: ExpectedItem = resume ? { ...item, status: 'active', endDate: undefined, updatedAt: this.now() } : { ...item, status: 'stopped', endDate: this.today(), updatedAt: this.now() };
      tx.put('expectedItems', next); return ok(undefined);
    });
  }
  deleteExpected(itemId: Id) { return this.commit((tx) => { tx.del('expectedItems', itemId); return ok(undefined); }); }

  // ------------------------------------------------------------ goals allocations / waste
  addAllocation(d: Draft<GoalAllocation>) {
    return this.commit<GoalAllocation>((tx) => {
      const a = this.stamp<GoalAllocation>(clean(d), 'alloc', tx);
      const issues = validateAllocation(a, tx.db); if (issues.length) return { ok: false, issues };
      tx.put('goalAllocations', a); return ok(a);
    });
  }
  deleteAllocation(id: Id) {
    return this.commit((tx) => {
      const a = tx.db.goalAllocations.find((x) => x.id === id); if (!a) return fail('Not found');
      if (a.amount > 0 && tx.db.goalAllocations.filter((x) => x.goalId === a.goalId && x.id !== id).reduce((s, x) => s + x.amount, 0) < 0) return fail('Removing this would leave the goal negative');
      tx.del('goalAllocations', id); return ok(undefined);
    });
  }
  saveWaste(d: Draft<WasteEntry>, id?: Id) {
    return this.commit<WasteEntry>((tx) => {
      const old = id ? tx.db.wasteEntries.find((w) => w.id === id) : undefined; if (id && !old) return fail('Not found');
      const w = (old ? clean({ ...old, ...d, id, createdAt: old.createdAt, updatedAt: this.now() }) : this.stamp<WasteEntry>(clean(d), 'waste', tx)) as WasteEntry;
      const issues = validateWaste(w); if (!isValidDate(w.date)) issues.push({ field: 'date', message: 'Enter a valid date' });
      if (issues.length) return { ok: false, issues };
      tx.put('wasteEntries', w); return ok(w);
    });
  }
  deleteWaste(id: Id) { return this.commit((tx) => { tx.del('wasteEntries', id); return ok(undefined); }); }

  // ------------------------------------------------------------ settings & snapshots
  updateSettings(patch: Partial<Omit<Settings, 'id' | 'createdAt'>>) {
    return this.commit<Settings>((tx) => {
      const s = { ...tx.db.settings, ...patch, updatedAt: this.now() };
      if (s.people.some((p) => !p.name.trim())) return fail('Names cannot be empty');
      if (![s.householdSavingsTarget, s.householdSavingsMinimum, s.transportReviewThreshold, s.spikeMinimum].every((n) => Number.isInteger(n) && n >= 0)) return fail('Amounts must be zero or more');
      tx.settings(s); return ok(s);
    });
  }
  /** Record (upsert) today's real net-worth snapshot. */
  captureSnapshot(date = this.today()) {
    return this.commit<NetWorthSnapshot>((tx) => {
      const old = tx.db.snapshots.find((s) => s.date === date);
      const s = buildSnapshot(tx.db, date, old?.id ?? this.gen('snap'), old?.createdAt ?? this.now());
      const snap = { ...s, updatedAt: this.now() };
      if (old && JSON.stringify(old.byOwner) === JSON.stringify(snap.byOwner)) return ok(old);
      tx.put('snapshots', snap); return ok(snap);
    });
  }

  // ------------------------------------------------------------ backup / restore
  async exportBackup(): Promise<{ file: BackupFile; json: string }> {
    const file = await createBackup(this._db, this.appVersion, this.now());
    return { file, json: serializeBackup(file) };
  }
  async markBackedUp() { await this.updateSettings({ lastBackupAt: this.now() }); }

  /** Replace or merge. Always writes a safety snapshot of current data first; aborts if that fails. */
  async restore(incoming: Database, mode: 'replace' | 'merge'): Promise<Result<{ safetyLabel: string }>> {
    return this.enqueue(async () => {
      let next = incoming;
      if (mode === 'merge') { const m = mergeDatabases(this._db, incoming); if (!m.db) return { ok: false, issues: m.errors.map((e) => ({ field: '_', message: e })) } as Result<{ safetyLabel: string }>; next = m.db; }
      const v = validateDatabase(next); if (!v.db) return { ok: false, issues: v.errors.map((e) => ({ field: '_', message: e })) } as Result<{ safetyLabel: string }>;
      const label = `Before ${mode} on ${this.now()}`;
      try { await this.storage.addSafety(label, (await this.exportBackup()).json); }
      catch (e) { return fail(`Could not create a safety copy of your current data, so nothing was changed: ${(e as Error).message}`); }
      const prev = this._db;
      try { await this.storage.replaceAll(v.db, SCHEMA_VERSION); } catch (e) { this._db = prev; return fail(`Restore failed and your data was kept: ${(e as Error).message}`); }
      this._db = v.db; this.emit(); return ok({ safetyLabel: label });
    });
  }
  /** Erase everything (after a safety snapshot). */
  async resetAll(): Promise<Result> {
    const r = await this.restore(emptyDatabase(this.now()), 'replace'); return r.ok ? ok(undefined) : r;
  }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => undefined); return p; }
}

/** Drop undefined/empty-string optional fields so stored JSON stays tidy. */
function clean<T extends object>(o: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}
export { COLLECTIONS };
