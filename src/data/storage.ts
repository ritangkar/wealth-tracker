import { COLLECTIONS, type CollectionName, type Database, type Id, type Tombstone } from '../domain/types';

export type Op =
  | { kind: 'put'; collection: CollectionName; value: { id: Id } }
  | { kind: 'delete'; collection: CollectionName; id: Id }
  | { kind: 'settings'; value: Database['settings'] }
  | { kind: 'tombstone'; value: Tombstone };

export interface SafetySnapshot { id: number; label: string; createdAt: string; json: string }

/** Persistence port. The domain never touches it; the store does. Swap for a sync adapter later. */
export interface Storage {
  /** null when nothing has been stored yet. */
  load(): Promise<{ db: Database; schemaVersion: number } | null>;
  apply(ops: Op[]): Promise<void>;
  /** Atomically replace everything (restore / import). */
  replaceAll(db: Database, schemaVersion: number): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  addSafety(label: string, json: string): Promise<void>;
  listSafety(): Promise<SafetySnapshot[]>;
  persist?(): Promise<boolean>;
}

export const STORE_NAMES = [...COLLECTIONS, 'settings', 'tombstones', 'meta', 'safety'] as const;
export const MAX_SAFETY = 5;

export class MemoryStorage implements Storage {
  data: { db: Database; schemaVersion: number } | null = null;
  meta = new Map<string, unknown>();
  safety: SafetySnapshot[] = [];
  failNext = false;
  async load() { return this.data ? structuredClone(this.data) : null; }
  async apply(ops: Op[]) {
    if (this.failNext) { this.failNext = false; throw new Error('simulated storage failure'); }
    if (!this.data) throw new Error('not initialised');
    const db = this.data.db;
    for (const op of ops) {
      if (op.kind === 'settings') db.settings = structuredClone(op.value);
      else if (op.kind === 'tombstone') { db.tombstones = db.tombstones.filter((t) => t.key !== op.value.key); db.tombstones.push(structuredClone(op.value)); }
      else {
        const arr = db[op.collection] as { id: Id }[];
        const i = arr.findIndex((x) => x.id === (op.kind === 'put' ? op.value.id : op.id));
        if (op.kind === 'put') { if (i >= 0) arr[i] = structuredClone(op.value); else arr.push(structuredClone(op.value)); }
        else if (i >= 0) arr.splice(i, 1);
      }
    }
  }
  async replaceAll(db: Database, schemaVersion: number) { this.data = { db: structuredClone(db), schemaVersion }; }
  async getMeta<T>(k: string) { return this.meta.get(k) as T | undefined; }
  async setMeta(k: string, v: unknown) { this.meta.set(k, v); }
  async addSafety(label: string, json: string) {
    this.safety.push({ id: (this.safety.at(-1)?.id ?? 0) + 1, label, createdAt: new Date().toISOString(), json });
    this.safety = this.safety.slice(-MAX_SAFETY);
  }
  async listSafety() { return [...this.safety].reverse(); }
}
