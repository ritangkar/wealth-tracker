/**
 * Backup/storage migrations. MIGRATIONS[n] upgrades a data object from schema n to n+1.
 * Adding a migration is REQUIRED whenever stored shapes change (bump SCHEMA_VERSION too).
 */
export type Migration = (data: Record<string, any>) => Record<string, any>;
export const MIGRATIONS: Record<number, Migration> = {
  // 1: (data) => ({ ...data, newCollection: [] })   // example for 1 → 2
};

export function migrateData(data: Record<string, any>, from: number, to: number, migrations: Record<number, Migration> = MIGRATIONS): Record<string, any> {
  let cur = structuredClone(data);
  for (let v = from; v < to; v++) {
    const m = migrations[v];
    if (!m) throw new Error(`No migration available from schema version ${v} to ${v + 1}.`);
    cur = m(cur);
  }
  return cur;
}
