# Architecture

```
₹0 hosting → GitHub repo → GitHub Pages → static PWA → IndexedDB (local-first) → offline → JSON backup/restore → privacy-first
```

## Layers
| Layer | Path | Rule |
|---|---|---|
| Domain | `src/domain` | Pure functions over a plain `Database` object. No DOM, no storage, no clock (callers pass `today`). Everything money-related lives here and is unit-tested. |
| Data | `src/data` | `Storage` port (`storage.ts`) with `IdbStorage` (browser) and `MemoryStorage` (tests). `Store` = in-memory authoritative state + serialised write-through commits with validation, rollback on persist failure, and tombstones. `backup.ts` / `migrations.ts` handle JSON export/import. |
| UI | `src/ui` | Preact. Reads via `useDb()`, writes only via `Store` commands. Hash router. Hand-written SVG charts. |
| PWA | `src/sw.template.js`, `src/pwa/register.ts`, `vite.config.ts` | SW generated at build with precache list + build id. |

The whole dataset is held in memory (a household is thousands of records, not millions); IndexedDB is the durable copy. Each command computes the next immutable state, validates it, updates memory, then persists the touched records in one IDB transaction. If persisting fails, memory rolls back and the user is told.

## Storage (IndexedDB `wealth-os`, version 1)
One object store per collection (keyPath `id`), plus `settings`, `tombstones` (keyPath `key`), `meta` (schemaVersion, lock record), `safety` (last 5 pre-restore snapshots, autoincrement). Opening an unreadable / invalid / newer-schema database puts the app in **recovery mode**: nothing is written, the user can download the raw stored data.
Schema evolution: bump `SCHEMA_VERSION`, add `MIGRATIONS[n]` (n → n+1). Stored data migrates on load, backups migrate on import (same function).

## Sync-readiness (not sync)
Every record has `id`, `createdAt`, `updatedAt`; deletions leave tombstones. `mergeDatabases` (newer `updatedAt` wins, tombstones honoured, result re-validated) already powers "Merge" restore between two devices. A future sync adapter would implement the `Storage` port or exchange backups. See `SYNC.md`.

## Routing & GitHub Pages
`base: './'` (relative assets); hash routes (`#/plan?tab=goals`) so refresh and deep links never hit the server; manifest `start_url`/`scope` = `./`; SW registered as `./sw.js` with scope `./`. `public/404.html` redirects stray paths to the app root.

## Service worker
Precache of every built file (relative URLs, `cache:'reload'` on install). Cache name = build id + content hash, old caches deleted on activate. Navigations are network-first (4 s timeout) with cached `index.html` fallback; static assets cache-first. New workers **wait**; the UI offers "Update now" (`SKIP_WAITING` → `controllerchange` → reload) so a user never loses an in-progress form. Cross-origin requests are never touched. No user data passes through the SW.

## Security & privacy
No network calls for data; no analytics. Optional PIN lock (PBKDF2-SHA256 150k, throttled) hides the UI only — **data at rest and backups are not encrypted** (stated in-app). Never store card numbers/CVV/PINs/passwords; the card form accepts last-4 only. Imported files are validated structurally, referentially and against financial rules before anything is applied; CSV/JSON are never executed; all text is rendered via Preact (escaped).

## Risks tracked
iOS/Safari may evict storage for non-installed PWAs → persist request + backup nudges. Multi-tab writes: last-writer-wins per record (single-user household assumption). Clock/timezone: dates are local calendar strings.
