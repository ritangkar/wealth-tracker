/** JSON backup: export, safe parse/validate/migrate, preview, merge. Never mutates current data. */
import { APP_ID, COLLECTIONS, SCHEMA_VERSION, type CollectionName, type Database, type Tombstone } from '../domain/types';
import { validateDatabase } from '../domain/schema';
import { MIGRATIONS, migrateData, type Migration } from './migrations';

export interface BackupFile { app: string; schemaVersion: number; appVersion: string; exportedAt: string; checksum?: string; data: Database }

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export async function checksum(data: unknown): Promise<string> {
  const text = stableStringify(data);
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const h = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return 'sha256:' + [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let x = 2166136261; for (const b of bytes) { x ^= b; x = Math.imul(x, 16777619); }
  return 'fnv1a:' + (x >>> 0).toString(16);
}

export async function createBackup(db: Database, appVersion: string, now = new Date().toISOString()): Promise<BackupFile> {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, appVersion, exportedAt: now, checksum: await checksum(db), data: db };
}
export const serializeBackup = (b: BackupFile) => JSON.stringify(b, null, 2);

export function backupFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `wealth-os-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

export interface ParseResult {
  ok: boolean; errors: string[]; warnings: string[];
  db?: Database; schemaVersion?: number; migratedFrom?: number; exportedAt?: string; appVersion?: string;
  /** Checksum didn't match: file was edited or damaged. Requires explicit user acknowledgement. */
  checksumMismatch?: boolean;
}

const MAX_BYTES = 50 * 1024 * 1024;

export async function parseBackup(text: string, opts: { migrations?: Record<number, Migration>; currentVersion?: number } = {}): Promise<ParseResult> {
  const migrations = opts.migrations ?? MIGRATIONS; const current = opts.currentVersion ?? SCHEMA_VERSION;
  const fail = (...errors: string[]): ParseResult => ({ ok: false, errors, warnings: [] });
  if (typeof text !== 'string' || text.trim() === '') return fail('The file is empty.');
  if (text.length > MAX_BYTES) return fail('The file is too large to be a Wealth OS backup.');
  let raw: any;
  try { raw = JSON.parse(text); } catch { return fail('This is not valid JSON — the file may be truncated or damaged.'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('This file is not a Wealth OS backup.');
  if (raw.app !== APP_ID) return fail('This file is not a Wealth OS backup (missing app marker).');
  if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) return fail('The backup has no valid schema version.');
  if (raw.schemaVersion > current) return fail(`This backup was made by a newer version of the app (schema ${raw.schemaVersion}; this app supports up to ${current}). Update the app and try again — nothing was changed.`);
  if (typeof raw.data !== 'object' || raw.data === null || Array.isArray(raw.data)) return fail('The backup has no data section.');

  const warnings: string[] = [];
  let checksumMismatch = false;
  if (typeof raw.checksum === 'string') {
    const actual = await checksum(raw.data);
    if (actual !== raw.checksum) { checksumMismatch = true; warnings.push('The checksum does not match: the file was edited or damaged after export.'); }
  } else warnings.push('The backup has no checksum, so its integrity cannot be verified.');

  let data = raw.data;
  const migratedFrom = raw.schemaVersion < current ? raw.schemaVersion : undefined;
  if (migratedFrom !== undefined) {
    try { data = migrateData(data, raw.schemaVersion, current, migrations); warnings.push(`Upgraded from schema ${raw.schemaVersion} to ${current}.`); }
    catch (e) { return fail(`Could not upgrade this older backup: ${(e as Error).message}`); }
  }
  const v = validateDatabase(data);
  warnings.push(...v.warnings);
  if (v.errors.length || !v.db) return { ok: false, errors: v.errors, warnings, schemaVersion: raw.schemaVersion, checksumMismatch };
  return { ok: true, errors: [], warnings, db: v.db, schemaVersion: raw.schemaVersion, migratedFrom, exportedAt: raw.exportedAt, appVersion: raw.appVersion, checksumMismatch };
}

export interface PreviewRow { collection: string; current: number; incoming: number; added?: number; updated?: number }
export function previewRestore(current: Database, incoming: Database, mode: 'replace' | 'merge'): PreviewRow[] {
  return COLLECTIONS.map((c) => {
    const cur = new Map((current[c] as { id: string; updatedAt: string }[]).map((x) => [x.id, x]));
    const inc = incoming[c] as { id: string; updatedAt: string }[];
    const row: PreviewRow = { collection: c, current: cur.size, incoming: inc.length };
    if (mode === 'merge') {
      row.added = inc.filter((x) => !cur.has(x.id)).length;
      row.updated = inc.filter((x) => cur.has(x.id) && cur.get(x.id)!.updatedAt < x.updatedAt).length;
    }
    return row;
  });
}

/** Union by id; newer updatedAt wins; tombstones newer than the record delete it. Returns validated result or errors. */
export function mergeDatabases(current: Database, incoming: Database): { db?: Database; errors: string[] } {
  const tomb = new Map<string, Tombstone>();
  for (const t of [...current.tombstones, ...incoming.tombstones]) { const o = tomb.get(t.key); if (!o || o.deletedAt < t.deletedAt) tomb.set(t.key, t); }
  const out: any = { ...current, tombstones: [...tomb.values()] };
  for (const c of COLLECTIONS as readonly CollectionName[]) {
    const m = new Map<string, any>();
    for (const x of [...(current[c] as any[]), ...(incoming[c] as any[])]) {
      const o = m.get(x.id); if (!o || o.updatedAt < x.updatedAt) m.set(x.id, x);
    }
    out[c] = [...m.values()].filter((x) => { const t = tomb.get(`${c}:${x.id}`); return !t || t.deletedAt < x.updatedAt; });
  }
  out.settings = incoming.settings.updatedAt > current.settings.updatedAt ? incoming.settings : current.settings;
  const v = validateDatabase(out);
  return v.errors.length ? { errors: v.errors } : { db: v.db, errors: [] };
}
