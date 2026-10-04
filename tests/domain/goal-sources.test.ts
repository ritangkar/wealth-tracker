import { describe, expect, it } from 'vitest';
import { fundingOverview, fundingSources, goalSourceBreakdown, unallocatedLiquid, validateAllocation, goalProgress } from '../../src/domain/goals';
import { computeNetWorth } from '../../src/domain/networth';
import { validateDatabase } from '../../src/domain/schema';
import { Store } from '../../src/data/store';
import { MemoryStorage } from '../../src/data/storage';
import { repairDatabase } from '../../src/data/repair';
import { db0, acct, inv, val, asset, goal, rs, NOW } from '../helpers';
import type { Database, GoalAllocation } from '../../src/domain/types';

function world() {
  const db = db0();
  const bank = acct(db, { name: 'HDFC Savings', kind: 'bank', ownerId: 'hh', openingBalance: rs(100000) });
  const card = acct(db, { name: 'Card', kind: 'credit_card', openingBalance: -rs(5000), card: { creditLimit: rs(100000) } });
  const fd = inv(db, { name: 'SBI FD', type: 'fd' }); val(db, 'investment', fd.id, '2026-01-01', rs(200000), rs(180000));
  const mf = inv(db, { name: 'Nifty Fund', type: 'mutual_fund' }); val(db, 'investment', mf.id, '2026-01-01', rs(150000), rs(120000));
  const epf = inv(db, { name: 'EPF', type: 'ppf_epf' }); val(db, 'investment', epf.id, '2026-01-01', rs(500000), rs(500000));
  const gold = asset(db, { name: 'Gold', kind: 'gold' }); val(db, 'asset', gold.id, '2026-01-01', rs(80000));
  const prop = asset(db, { name: 'Flat', kind: 'property' }); val(db, 'asset', prop.id, '2026-01-01', rs(5000000));
  const g = goal(db, { name: 'Emergency Fund', targetAmount: rs(300000) });
  return { db, bank, card, fd, mf, epf, gold, prop, g };
}
const alloc = (db: Database, goalId: string, amount: number, src?: { kind: any; id: string }): GoalAllocation => {
  const a: GoalAllocation = { id: `a${db.goalAllocations.length + 1}`, goalId, date: '2026-03-01', amount: rs(amount), ownerId: 'hh', createdAt: NOW, updatedAt: NOW, ...(src ? { sourceKind: src.kind, sourceId: src.id } : {}) };
  db.goalAllocations.push(a); return a;
};

describe('goal funding sources', () => {
  it('lists cash/bank, FD, MF, stocks, gold — but never EPF/PPF, credit cards or property', () => {
    const { db } = world();
    const names = fundingSources(db, 'household').map((s) => s.name).sort();
    expect(names).toEqual(['Gold', 'HDFC Savings', 'Nifty Fund', 'SBI FD']);
    const fd = fundingSources(db, 'household').find((s) => s.name === 'SBI FD')!;
    expect([fd.value, fd.allocated, fd.free, fd.liquid]).toEqual([rs(200000), 0, rs(200000), false]);
  });

  it('spec example: set aside ₹50,000 = ₹30,000 from an FD + ₹20,000 from a mutual fund; shows exactly where it comes from', () => {
    const { db, fd, mf, g } = world();
    alloc(db, g.id, 30000, { kind: 'investment', id: fd.id }); alloc(db, g.id, 20000, { kind: 'investment', id: mf.id });
    expect(goalProgress(db, g, '2026-03-10').allocated).toBe(rs(50000));
    expect(goalSourceBreakdown(db, g.id).map((r) => [r.name, r.amount])).toEqual([['SBI FD', rs(30000)], ['Nifty Fund', rs(20000)]]);
    const ov = fundingOverview(db, 'household');
    expect(ov.sources.find((s) => s.name === 'SBI FD')).toMatchObject({ allocated: rs(30000), free: rs(170000) });
    expect(ov.sources.find((s) => s.name === 'Nifty Fund')).toMatchObject({ allocated: rs(20000), free: rs(130000) });
    expect(ov.totalAllocated).toBe(rs(50000));
  });

  it('allocations stay conceptual: no change to balances or net worth; FD/MF-sourced money does not reduce free cash', () => {
    const { db, bank, fd, g } = world();
    const nw = computeNetWorth(db, 'household').net;
    alloc(db, g.id, 30000, { kind: 'investment', id: fd.id });
    expect(computeNetWorth(db, 'household').net).toBe(nw);
    expect(unallocatedLiquid(db, 'household')).toEqual({ liquid: rs(100000), allocated: 0, unallocated: rs(100000) });
    alloc(db, g.id, 10000, { kind: 'account', id: bank.id });
    expect(unallocatedLiquid(db, 'household').unallocated).toBe(rs(90000));
  });

  it('legacy allocations without a source are counted against cash and shown as "not tied to a source"', () => {
    const { db, g } = world();
    alloc(db, g.id, 15000);
    expect(unallocatedLiquid(db, 'household').unallocated).toBe(rs(85000));
    expect(fundingOverview(db, 'household').unassigned).toBe(rs(15000));
    expect(goalSourceBreakdown(db, g.id)[0]).toMatchObject({ name: 'Not tied to a source', amount: rs(15000) });
  });

  it('a source can be over-allocated (value fell or two goals) — shows negative free, never blocks', () => {
    const { db, fd, g } = world();
    const g2 = goal(db, { name: 'Trip', kind: 'trip' });
    alloc(db, g.id, 150000, { kind: 'investment', id: fd.id }); alloc(db, g2.id, 100000, { kind: 'investment', id: fd.id });
    expect(fundingSources(db, 'household').find((s) => s.name === 'SBI FD')!.free).toBe(-rs(50000));
    expect(validateAllocation({ ...db.goalAllocations[0], id: 'new', amount: rs(1000) }, db)).toEqual([]);
  });

  it('validation: EPF / credit card / property / missing sources rejected; release limited to what the goal holds from that source', () => {
    const { db, epf, card, prop, fd, g } = world();
    const base = { id: 'x', goalId: g.id, date: '2026-03-02', amount: rs(1000), ownerId: 'hh' as const, createdAt: NOW, updatedAt: NOW };
    expect(validateAllocation({ ...base, sourceKind: 'investment', sourceId: epf.id }, db).some((i) => i.field === 'source')).toBe(true);
    expect(validateAllocation({ ...base, sourceKind: 'account', sourceId: card.id }, db).some((i) => i.field === 'source')).toBe(true);
    expect(validateAllocation({ ...base, sourceKind: 'asset', sourceId: prop.id }, db).some((i) => i.field === 'source')).toBe(true);
    expect(validateAllocation({ ...base, sourceKind: 'investment', sourceId: 'ghost' }, db).some((i) => i.field === 'source')).toBe(true);
    expect(validateAllocation({ ...base, sourceKind: 'investment' }, db).some((i) => i.field === 'source')).toBe(true);
    alloc(db, g.id, 30000, { kind: 'investment', id: fd.id }); alloc(db, g.id, 20000);
    // goal total is 50k but only 30k is from the FD
    expect(validateAllocation({ ...base, amount: -rs(40000), sourceKind: 'investment', sourceId: fd.id }, db).some((i) => i.field === 'source')).toBe(true);
    expect(validateAllocation({ ...base, amount: -rs(30000), sourceKind: 'investment', sourceId: fd.id }, db)).toEqual([]);
  });

  it('person scope only sees that person’s sources', () => {
    const { db } = world();
    acct(db, { name: 'Wife savings', kind: 'bank', ownerId: 'p2', openingBalance: rs(10000) });
    expect(fundingSources(db, 'p2').map((s) => s.name)).toEqual(['Wife savings']);
  });
});

describe('store + persistence of sourced allocations', () => {
  const open = async () => Store.open(new MemoryStorage(), { now: () => new Date(2026, 2, 10), idGen: (p) => `${p}_${Math.random().toString(36).slice(2, 9)}` });
  it('addAllocations is atomic: all lines saved, or none (with line-numbered error)', async () => {
    const store = await open();
    const fd = (await store.saveInvestment({ name: 'FD', type: 'fd', ownerId: 'p1' })) as any;
    const epf = (await store.saveInvestment({ name: 'EPF', type: 'ppf_epf', ownerId: 'p1' })) as any;
    const g = (await store.saveGoal({ name: 'Trip', kind: 'trip', ownerId: 'hh', targetAmount: rs(100000), status: 'active' })) as any;
    const bad = await store.addAllocations([
      { goalId: g.value.id, date: '2026-03-10', amount: rs(30000), ownerId: 'hh', sourceKind: 'investment', sourceId: fd.value.id },
      { goalId: g.value.id, date: '2026-03-10', amount: rs(20000), ownerId: 'hh', sourceKind: 'investment', sourceId: epf.value.id },
    ]);
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.issues[0].message).toMatch(/^Line 2/);
    expect(store.db.goalAllocations).toHaveLength(0);
    const good = await store.addAllocations([
      { goalId: g.value.id, date: '2026-03-10', amount: rs(30000), ownerId: 'hh', sourceKind: 'investment', sourceId: fd.value.id },
      { goalId: g.value.id, date: '2026-03-10', amount: rs(20000), ownerId: 'hh' },
    ]);
    expect(good.ok).toBe(true); expect(store.db.goalAllocations).toHaveLength(2);
    expect((await store.deleteAllocation(store.db.goalAllocations[0].id)).ok).toBe(true);
    expect((await store.addAllocations([])).ok).toBe(false);
  });

  it('backup validation: source refs must exist; repair detaches a dangling source instead of losing the allocation', () => {
    const { db, fd, g } = world();
    alloc(db, g.id, 30000, { kind: 'investment', id: fd.id });
    const raw = JSON.parse(JSON.stringify(db));
    expect(validateDatabase(raw).errors).toEqual([]);
    raw.investments = raw.investments.filter((i: any) => i.id !== fd.id); raw.valuations = raw.valuations.filter((v: any) => v.targetId !== fd.id);
    expect(validateDatabase(raw).errors.join()).toMatch(/source/);
    const r = repairDatabase(raw);
    expect(r.db!.goalAllocations).toHaveLength(1); expect(r.db!.goalAllocations[0].sourceKind).toBeUndefined();
  });
});
