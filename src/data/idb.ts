import { COLLECTIONS, type Database } from '../domain/types';
import { emptyDatabase } from '../domain/seed';
import { MAX_SAFETY, type Op, type SafetySnapshot, type Storage } from './storage';

const DB_NAME = 'wealth-os';
const DB_VERSION = 1;

const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('transaction aborted')); });

export class IdbStorage implements Storage {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private name = DB_NAME, private factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((res, rej) => {
      const r = this.factory.open(this.name, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('tombstones')) d.createObjectStore('tombstones', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        if (!d.objectStoreNames.contains('safety')) d.createObjectStore('safety', { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Database upgrade blocked by another open tab. Close other tabs and reload.'));
    });
    return this.dbp;
  }

  async load() {
    const d = await this.open();
    const tx = d.transaction(['meta', 'settings', 'tombstones', ...COLLECTIONS], 'readonly');
    const [version, settings] = await Promise.all([req(tx.objectStore('meta').get('schemaVersion')), req(tx.objectStore('settings').getAll())]);
    if (version === undefined || !settings.length) return null;
    const db = emptyDatabase(); (db as any).settings = settings[0];
    await Promise.all(COLLECTIONS.map(async (c) => { (db as any)[c] = await req(tx.objectStore(c).getAll()); }));
    db.tombstones = await req(tx.objectStore('tombstones').getAll());
    return { db, schemaVersion: version as number };
  }

  async apply(ops: Op[]) {
    if (!ops.length) return;
    const d = await this.open();
    const stores = new Set<string>(); for (const o of ops) stores.add(o.kind === 'settings' ? 'settings' : o.kind === 'tombstone' ? 'tombstones' : o.collection);
    const tx = d.transaction([...stores], 'readwrite');
    for (const o of ops) {
      if (o.kind === 'put') tx.objectStore(o.collection).put(o.value);
      else if (o.kind === 'delete') tx.objectStore(o.collection).delete(o.id);
      else if (o.kind === 'settings') tx.objectStore('settings').put(o.value);
      else tx.objectStore('tombstones').put(o.value);
    }
    await done(tx);
  }

  async replaceAll(db: Database, schemaVersion: number) {
    const d = await this.open();
    const tx = d.transaction([...COLLECTIONS, 'settings', 'tombstones', 'meta'], 'readwrite');
    for (const c of COLLECTIONS) { const s = tx.objectStore(c); s.clear(); for (const v of db[c]) s.put(v); }
    tx.objectStore('settings').clear(); tx.objectStore('settings').put(db.settings);
    tx.objectStore('tombstones').clear(); for (const t of db.tombstones) tx.objectStore('tombstones').put(t);
    tx.objectStore('meta').put(schemaVersion, 'schemaVersion');
    await done(tx);
  }

  async getMeta<T>(key: string) { const d = await this.open(); return req(d.transaction('meta').objectStore('meta').get(key)) as Promise<T | undefined>; }
  async setMeta(key: string, value: unknown) { const d = await this.open(); const tx = d.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value, key); await done(tx); }

  async addSafety(label: string, json: string) {
    const d = await this.open(); const tx = d.transaction('safety', 'readwrite'); const s = tx.objectStore('safety');
    s.add({ label, createdAt: new Date().toISOString(), json });
    const keys = await req(s.getAllKeys());
    for (const k of keys.slice(0, Math.max(0, keys.length + 0 - MAX_SAFETY))) s.delete(k);
    await done(tx);
  }
  async listSafety(): Promise<SafetySnapshot[]> { const d = await this.open(); return (await req(d.transaction('safety').objectStore('safety').getAll())).reverse(); }
  async persist() { try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; } }
}
