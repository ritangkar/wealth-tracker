import { describe, expect, it } from 'vitest';
import { createBackup, mergeDatabases, parseBackup, previewRestore, serializeBackup, stableStringify, backupFilename } from '../../src/data/backup';
import { Store } from '../../src/data/store';
import { MemoryStorage } from '../../src/data/storage';
import { migrateData } from '../../src/data/migrations';
import { SCHEMA_VERSION } from '../../src/domain/types';
import { db0, acct, txn, rs } from '../helpers';
import { emptyDatabase } from '../../src/domain/seed';

function sampleDb() {
  const db = db0();
  const b = acct(db, { name: 'HDFC Savings', kind: 'bank', openingBalance: rs(1000) });
  txn(db, { type: 'expense', amount: rs(50), fromAccountId: b.id, categoryId: 'cat_other', tags: ['a'] });
  return db;
}
const ser = async (db = sampleDb()) => serializeBackup(await createBackup(db, 'test'));

describe('backup export/import', () => {
  it('round-trips losslessly with versioned schema and checksum', async () => {
    const db = sampleDb(); const text = await ser(db);
    expect(JSON.parse(text)).toMatchObject({ app: 'wealth-os', schemaVersion: SCHEMA_VERSION });
    const r = await parseBackup(text);
    expect(r.ok).toBe(true); expect(r.checksumMismatch).toBe(false);
    expect(stableStringify(r.db)).toBe(stableStringify(db));
    expect(backupFilename(new Date(2026, 2, 5, 7, 8))).toBe('wealth-os-backup-20260305-0708.json');
  });

  it.each([
    ['empty', ''], ['whitespace', '   '], ['not json', '{oops'], ['truncated', '{"app":"wealth-os","schemaVersion":1,"data":{"accounts":['],
    ['array', '[]'], ['null', 'null'], ['wrong app', '{"app":"other","schemaVersion":1,"data":{}}'],
    ['no version', '{"app":"wealth-os","data":{}}'], ['string version', '{"app":"wealth-os","schemaVersion":"1","data":{}}'],
    ['no data', '{"app":"wealth-os","schemaVersion":1}'], ['data array', '{"app":"wealth-os","schemaVersion":1,"data":[]}'],
  ])('rejects %s safely', async (_n, text) => {
    const r = await parseBackup(text); expect(r.ok).toBe(false); expect(r.errors.length).toBeGreaterThan(0); expect(r.db).toBeUndefined();
  });

  it('rejects newer schema versions without touching data', async () => {
    const b = JSON.parse(await ser()); b.schemaVersion = SCHEMA_VERSION + 1;
    const r = await parseBackup(JSON.stringify(b)); expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/newer version/);
  });

  it('detects schema violations with row-level messages', async () => {
    const mut = async (f: (b: any) => void) => { const b = JSON.parse(await ser()); f(b); return parseBackup(JSON.stringify(b)); };
    let r = await mut((b) => { b.data.transactions[0].amount = 12.5; }); expect(r.ok).toBe(false); expect(r.errors.join()).toMatch(/transactions\[0\] amount/);
    r = await mut((b) => { b.data.transactions[0].date = '2026-13-45'; }); expect(r.ok).toBe(false);
    r = await mut((b) => { b.data.transactions[0].type = 'bogus'; }); expect(r.ok).toBe(false);
    r = await mut((b) => { b.data.transactions[0].fromAccountId = 'ghost'; }); expect(r.errors.join()).toMatch(/missing account/);
    r = await mut((b) => { b.data.accounts.push({ ...b.data.accounts[0] }); }); expect(r.errors.join()).toMatch(/duplicate id/);
    r = await mut((b) => { b.data.accounts = 'x'; }); expect(r.ok).toBe(false);
    r = await mut((b) => { b.data.transactions[0].ownerId = 'p3'; }); expect(r.ok).toBe(false);
    r = await mut((b) => { delete b.data.settings.people; }); expect(r.ok).toBe(false);
    r = await mut((b) => { b.data.transactions[0].tags = [1]; }); expect(r.ok).toBe(false);
    r = await mut((b) => { b.data.transactions[0].type = 'transfer'; }); expect(r.errors.join()).toMatch(/toAccountId/); // business rules
    r = await mut((b) => { b.data.accounts[0].card = { creditLimit: 1, last4: '12345678' }; }); expect(r.ok).toBe(false);
  });

  it('incomplete backup: missing sections are empty with a warning; checksum mismatch flagged', async () => {
    const b = JSON.parse(await ser()); delete b.data.goals; delete b.data.wasteEntries; delete b.data.tombstones;
    const r = await parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true); expect(r.db!.goals).toEqual([]); expect(r.warnings.join()).toMatch(/goals/); expect(r.checksumMismatch).toBe(true);
    delete b.checksum; const r2 = await parseBackup(JSON.stringify(b)); expect(r2.ok).toBe(true); expect(r2.warnings.join()).toMatch(/no checksum/);
  });

  it('missing accounts while transactions remain is rejected (incomplete)', async () => {
    const b = JSON.parse(await ser()); delete b.data.accounts;
    expect((await parseBackup(JSON.stringify(b))).ok).toBe(false);
  });

  it('tampered data fails checksum', async () => {
    const b = JSON.parse(await ser()); b.data.accounts[0].name = 'Tampered';
    expect((await parseBackup(JSON.stringify(b))).checksumMismatch).toBe(true);
  });

  it('migrations: older schemas upgrade stepwise; missing migration is an error', async () => {
    const mig = { 1: (d: any) => ({ ...d, accounts: d.accounts.map((a: any) => ({ ...a, name: a.name.toUpperCase() })) }), 2: (d: any) => ({ ...d, goals: [] }) };
    const b = JSON.parse(await ser()); b.schemaVersion = 1;
    const r = await parseBackup(JSON.stringify(b), { migrations: mig, currentVersion: 3 });
    expect(r.ok).toBe(true); expect(r.migratedFrom).toBe(1); expect(r.db!.accounts[0].name).toBe('HDFC SAVINGS');
    const bad = await parseBackup(JSON.stringify(b), { migrations: { 1: mig[1] }, currentVersion: 3 });
    expect(bad.ok).toBe(false); expect(bad.errors[0]).toMatch(/No migration/);
    const input = { accounts: [] }; migrateData(input, 1, 2, { 1: () => ({}) }); expect(input).toEqual({ accounts: [] }); // pure
  });

  it('preview counts + merge: newer wins, adds new, honours tombstones, validates result', async () => {
    const a = sampleDb(); const b = structuredClone(a);
    b.accounts[0] = { ...b.accounts[0], name: 'Renamed', updatedAt: '2026-06-01T00:00:00.000Z' };
    const extra = acct(b, { name: 'Wife account', kind: 'bank', ownerId: 'p2' });
    b.transactions.push({ ...b.transactions[0], id: 'newtxn', fromAccountId: extra.id, updatedAt: '2026-06-01T00:00:00.000Z' });
    const p = previewRestore(a, b, 'merge').find((r) => r.collection === 'accounts')!;
    expect(p).toMatchObject({ current: 1, incoming: 2, added: 1, updated: 1 });
    const m = mergeDatabases(a, b); expect(m.db!.accounts.map((x) => x.name).sort()).toEqual(['Renamed', 'Wife account']); expect(m.db!.transactions).toHaveLength(2);
    // tombstone in `a` newer than record in b removes it
    const a2 = structuredClone(a); a2.transactions = []; a2.tombstones.push({ key: `transactions:${a.transactions[0].id}`, collection: 'transactions', id: a.transactions[0].id, deletedAt: '2027-01-01T00:00:00.000Z' });
    expect(mergeDatabases(a2, a).db!.transactions).toHaveLength(0);
    // dangling reference after merge (txn in b references account deleted in a) → error not corruption
    const a3 = structuredClone(a); a3.accounts = []; a3.transactions = []; a3.tombstones.push({ key: `accounts:${a.accounts[0].id}`, collection: 'accounts', id: a.accounts[0].id, deletedAt: '2027-01-01T00:00:00.000Z' });
    const dm = mergeDatabases(a3, a); expect(dm.db).toBeUndefined(); expect(dm.errors.join()).toMatch(/missing account/);
  });
});

describe('safe restore via Store', () => {
  async function open() { const st = new MemoryStorage(); const store = await Store.open(st, { now: () => new Date(2026, 2, 10) }); return { st, store }; }

  it('replace: writes safety snapshot first, new data active, old data recoverable', async () => {
    const { st, store } = await open();
    await store.addAccount({ name: 'Mine', kind: 'bank', ownerId: 'p1', openingBalance: rs(5), openingDate: '2026-01-01' });
    const r = await store.restore(sampleDb(), 'replace');
    expect(r.ok).toBe(true); expect(store.db.accounts.map((a) => a.name)).toEqual(['HDFC Savings']);
    const safety = await st.listSafety(); expect(safety).toHaveLength(1);
    const prev = await parseBackup(safety[0].json); expect(prev.ok).toBe(true); expect(prev.db!.accounts[0].name).toBe('Mine');
  });

  it('invalid incoming data never replaces existing data', async () => {
    const { st, store } = await open(); await store.addAccount({ name: 'Mine', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' });
    const bad = sampleDb(); bad.transactions[0].fromAccountId = 'ghost';
    const r = await store.restore(bad, 'replace');
    expect(r.ok).toBe(false); expect(store.db.accounts[0].name).toBe('Mine'); expect((await st.listSafety())).toHaveLength(0);
  });

  it('aborts if safety snapshot cannot be written', async () => {
    const { st, store } = await open(); await store.addAccount({ name: 'Mine', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' });
    st.addSafety = async () => { throw new Error('quota'); };
    const r = await store.restore(sampleDb(), 'replace'); expect(r.ok).toBe(false); expect(store.db.accounts[0].name).toBe('Mine');
  });

  it('merge keeps both devices’ data', async () => {
    const { store } = await open(); await store.addAccount({ name: 'Mine', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' });
    const r = await store.restore(sampleDb(), 'merge'); expect(r.ok).toBe(true);
    expect(store.db.accounts.map((a) => a.name).sort()).toEqual(['HDFC Savings', 'Mine']);
  });

  it('reset requires and creates a safety snapshot; settings default restored', async () => {
    const { st, store } = await open(); await store.addAccount({ name: 'Mine', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' });
    expect((await store.resetAll()).ok).toBe(true); expect(store.db.accounts).toEqual([]); expect(await st.listSafety()).toHaveLength(1);
  });

  it('corrupt stored data → recovery mode, writes blocked, storage untouched', async () => {
    const st = new MemoryStorage(); const db = emptyDatabase(); (db.accounts as any).push({ id: 'a' }); await st.replaceAll(db, SCHEMA_VERSION);
    const store = await Store.open(st);
    expect(store.status).toBe('recovery'); expect(store.recovery!.errors.length).toBeGreaterThan(0);
    expect((await store.addAccount({ name: 'x', kind: 'bank', ownerId: 'p1', openingBalance: 0, openingDate: '2026-01-01' })).ok).toBe(false);
    expect((await st.load())!.db.accounts).toHaveLength(1);
  });

  it('stored data from newer schema → recovery, not overwritten', async () => {
    const st = new MemoryStorage(); await st.replaceAll(emptyDatabase(), SCHEMA_VERSION + 1);
    const store = await Store.open(st); expect(store.status).toBe('recovery'); expect((await st.load())!.schemaVersion).toBe(SCHEMA_VERSION + 1);
  });
});

describe('sample data', () => {
  it('is valid, balances sensibly, and round-trips through backup', async () => {
    const { sampleDatabase } = await import('../../src/data/sample');
    const { computeNetWorth } = await import('../../src/domain/networth');
    const db = sampleDatabase('2026-10-04');
    const r = await parseBackup(serializeBackup(await createBackup(db, 't')));
    expect(r.ok, r.errors.join('\n')).toBe(true);
    const nw = computeNetWorth(db, 'household');
    expect(nw.assets.total).toBeGreaterThan(0); expect(nw.net).toBeGreaterThan(0);
  });
});
