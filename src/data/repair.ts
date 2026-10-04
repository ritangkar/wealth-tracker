/**
 * Best-effort repair of a database that fails validation (e.g. dangling references after two tabs edited at once).
 * Never invents data: it only removes or detaches records that cannot be valid. Always paired with a safety copy.
 */
import { COLLECTIONS } from '../domain/types';
import { SPECS, checkObject, validateDatabase } from '../domain/schema';
import { validateTransaction } from '../domain/ledger';
import type { Database } from '../domain/types';

export interface RepairResult { db?: Database; dropped: string[]; errors: string[] }

export function repairDatabase(raw: any): RepairResult {
  const dropped: string[] = [];
  const d: any = structuredClone(raw ?? {});
  for (const c of COLLECTIONS) if (!Array.isArray(d[c])) d[c] = [];
  d.tombstones = Array.isArray(d.tombstones) ? d.tombstones.filter((t: any) => t && typeof t.key === 'string' && typeof t.deletedAt === 'string') : [];
  const note = (c: string, id: unknown, why: string) => dropped.push(`${c}: removed ${String(id)} (${why})`);

  // 1. structural: drop rows that fail their schema / duplicate ids
  for (const c of COLLECTIONS) {
    const seen = new Set<string>();
    d[c] = d[c].filter((r: any) => {
      if (!r || typeof r !== 'object') { note(c, '?', 'not an object'); return false; }
      const errs = checkObject(r, SPECS[c]);
      if (errs.length) { note(c, r.id, errs[0]); return false; }
      if (seen.has(r.id)) { note(c, r.id, 'duplicate id'); return false; }
      seen.add(r.id); return true;
    });
  }
  const ids = (c: string) => new Set<string>(d[c].map((x: any) => x.id));
  // 2. referential: iterate until stable (dropping a parent can orphan children)
  for (let pass = 0; pass < 4; pass++) {
    const accounts = ids('accounts'), invs = ids('investments'), assets = ids('assets'), liabs = ids('liabilities'), goals = ids('goals'), cats = ids('categories');
    const ok = (set: Set<string>, id?: string) => !id || set.has(id);
    const before = JSON.stringify([d.transactions.length, d.emis.length, d.cardReports.length, d.valuations.length, d.goalAllocations.length]);
    d.categories = d.categories.filter((c: any) => (ok(cats, c.parentId) ? true : (note('categories', c.id, 'missing parent'), false)));
    d.transactions = d.transactions.filter((t: any) => {
      const bad = !ok(accounts, t.fromAccountId) || !ok(accounts, t.toAccountId) || !ok(invs, t.investmentId) || !ok(assets, t.assetId) || !ok(liabs, t.liabilityId);
      if (bad) note('transactions', t.id, 'refers to something that no longer exists');
      return !bad;
    });
    for (const t of d.transactions) {
      if (t.categoryId && !cats.has(t.categoryId)) { t.categoryId = cats.has('cat_other') ? 'cat_other' : undefined; delete t.subcategoryId; dropped.push(`transactions: ${t.id} category reset`); }
      if (t.subcategoryId && !cats.has(t.subcategoryId)) { delete t.subcategoryId; }
      if (t.refundOfId && !d.transactions.some((x: any) => x.id === t.refundOfId)) { delete t.refundOfId; }
    }
    d.emis = d.emis.filter((e: any) => (ok(accounts, e.cardAccountId) ? true : (note('emis', e.id, 'card missing'), false)));
    d.cardReports = d.cardReports.filter((r: any) => (ok(accounts, r.accountId) ? true : (note('cardReports', r.id, 'card missing'), false)));
    d.valuations = d.valuations.filter((v: any) => (ok(v.targetType === 'investment' ? invs : assets, v.targetId) ? true : (note('valuations', v.id, 'item missing'), false)));
    d.goalAllocations = d.goalAllocations.filter((a: any) => (ok(goals, a.goalId) ? true : (note('goalAllocations', a.id, 'goal missing'), false)));
    for (const a of d.goalAllocations) { if (a.sourceKind && !(a.sourceKind === 'account' ? accounts : a.sourceKind === 'investment' ? invs : assets).has(a.sourceId)) { delete a.sourceKind; delete a.sourceId; } }
    for (const e of d.expectedItems) { if (e.accountId && !accounts.has(e.accountId)) delete e.accountId; if (e.investmentId && !invs.has(e.investmentId)) delete e.investmentId; }
    if (before === JSON.stringify([d.transactions.length, d.emis.length, d.cardReports.length, d.valuations.length, d.goalAllocations.length])) break;
  }
  // 3. business rules: drop transactions that still violate financial rules
  const probe = validateDatabase({ ...d, transactions: [] });
  if (!probe.db) return { dropped, errors: probe.errors };
  const kept = d.transactions.filter((t: any) => {
    const issues = validateTransaction(t, probe.db!, t);
    if (issues.length) { note('transactions', t.id, issues[0].message); return false; }
    return true;
  });
  d.transactions = kept;
  const v = validateDatabase(d);
  return v.db ? { db: v.db, dropped, errors: [] } : { dropped, errors: v.errors };
}
