import type { Database, NetWorthSnapshot, OwnerId, ViewScope } from './types';
import { accountBalances } from './ledger';
import { holdingValue } from './holdings';
import { liabilityOutstanding } from './liabilities';
import { emiState } from './emi';
import { inScope } from './scope';
import type { Paise } from './money';
import type { ISODate } from './dates';

export interface NetWorth {
  assets: { bank: Paise; cash: Paise; brokerageCash: Paise; investments: Paise; gold: Paise; property: Paise; other: Paise; total: Paise };
  liabilities: { cards: Paise; loans: Paise; overdrafts: Paise; total: Paise };
  net: Paise;
  liquid: Paise;
}

export function computeNetWorth(db: Database, scope: ViewScope, asOf?: ISODate): NetWorth {
  const a = { bank: 0, cash: 0, brokerageCash: 0, investments: 0, gold: 0, property: 0, other: 0, total: 0 };
  const l = { cards: 0, loans: 0, overdrafts: 0, total: 0 };
  const bal = accountBalances(db, asOf);  // asOf defaults to today
  for (const acc of db.accounts) {
    if (!inScope(acc.ownerId, scope)) continue;
    const b = bal.get(acc.id) ?? 0;
    if (acc.kind === 'credit_card') {
      if (b < 0) l.cards += -b; else a.bank += b;
      // if the tracked balance excludes EMI principal, that debt still exists: add it
      if (acc.card?.emiInLedger === false) for (const e of db.emis) if (e.cardAccountId === acc.id) l.cards += emiState(e).outstanding;
      continue;
    }
    if (b < 0) { l.overdrafts += -b; continue; }
    if (acc.kind === 'cash') a.cash += b; else if (acc.kind === 'investment') a.brokerageCash += b; else a.bank += b;
  }
  for (const inv of db.investments) if (inScope(inv.ownerId, scope)) a.investments += holdingValue(db, 'investment', inv.id, asOf).value;
  for (const as of db.assets) {
    if (!inScope(as.ownerId, scope)) continue;
    const v = holdingValue(db, 'asset', as.id, asOf).value;
    if (as.kind === 'gold') a.gold += v; else if (as.kind === 'property') a.property += v; else a.other += v;
  }
  for (const li of db.liabilities) if (inScope(li.ownerId, scope) && li.status === 'active') l.loans += liabilityOutstanding(db, li);
  a.total = a.bank + a.cash + a.brokerageCash + a.investments + a.gold + a.property + a.other;
  l.total = l.cards + l.loans + l.overdrafts;
  return { assets: a, liabilities: l, net: a.total - l.total, liquid: a.bank + a.cash };
}

export function buildSnapshot(db: Database, date: ISODate, id: string, now: string): NetWorthSnapshot {
  const owners: OwnerId[] = ['p1', 'p2', 'hh'];
  const byOwner = {} as NetWorthSnapshot['byOwner'];
  for (const o of owners) {
    const nw = computeNetWorth(db, o === 'hh' ? 'household' : o);
    byOwner[o] = { assets: nw.assets.total, liabilities: nw.liabilities.total };
  }
  // 'hh' above would be the whole household; store joint-only by subtraction for exact additivity.
  byOwner.hh = {
    assets: byOwner.hh.assets - byOwner.p1.assets - byOwner.p2.assets,
    liabilities: byOwner.hh.liabilities - byOwner.p1.liabilities - byOwner.p2.liabilities,
  };
  return { id, date, byOwner, createdAt: now, updatedAt: now };
}

/** Net worth series for a scope from stored snapshots. */
export function snapshotSeries(db: Pick<Database, 'snapshots'>, scope: ViewScope): { date: ISODate; net: Paise; assets: Paise; liabilities: Paise }[] {
  return [...db.snapshots].sort((x, y) => x.date.localeCompare(y.date)).map((s) => {
    const owners: OwnerId[] = scope === 'household' ? ['p1', 'p2', 'hh'] : [scope];
    const assets = owners.reduce((t, o) => t + (s.byOwner[o]?.assets ?? 0), 0);
    const liabilities = owners.reduce((t, o) => t + (s.byOwner[o]?.liabilities ?? 0), 0);
    return { date: s.date, assets, liabilities, net: assets - liabilities };
  });
}
