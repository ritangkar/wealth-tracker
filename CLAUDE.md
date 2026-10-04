# Wealth OS — project memory (read this first)

Personal + Household wealth tracker for Ritangkar, Wife, and the combined household.
Philosophy: Track → Understand → Optimize → Save → Grow Wealth. Simplicity beats customization.

## Non-negotiable architecture
₹0 hosting → GitHub Pages → static PWA → IndexedDB local-first → offline → JSON backup/restore → privacy-first.
- No backend, no analytics, no network calls for data. No mandatory sync service.
- `vite base: './'`, **hash routing** (`#/path`) so refresh/deep links work under any Pages subpath.
- Service worker `sw.js` is generated at build (`vite.config.ts` plugin) with a precache list + build id.
- Domain logic (`src/domain`) is pure TypeScript, storage-independent, fully unit-tested. UI never computes money rules itself.
- Stack: Vite + TypeScript + Preact (no router/state/chart libs; tiny hand-written SVG charts). Tests: Vitest (+fake-indexeddb), Playwright e2e.

## Commands
`npm run dev` · `npm test` (unit) · `npm run typecheck` · `npm run build` · `npm run test:e2e` (builds, serves under `/wealth-tracker/` subpath, tests PWA/offline) · `npm run icons`.
Always run `npm test && npm run build` before committing. CI (`.github/workflows/pages.yml`) does test+build+deploy.

## Money & data conventions
- ALL amounts are **integer paise** (`Paise`). Never floats in storage/logic. UI converts via `src/domain/money.ts`.
- Dates are `YYYY-MM-DD` strings (local calendar dates); months are `YYYY-MM`. No timezone math on stored dates.
- Owner ids: `p1` (Ritangkar), `p2` (Wife), `hh` (joint/household). Names editable in settings. Ownership is stored per record and never collapsed.
- Every entity: `id`, `createdAt`, `updatedAt`. Deletions leave a tombstone (`deleted` collection) for future merge/sync.
- Backup schema is versioned (`SCHEMA_VERSION` in `src/domain/types.ts`). Changing any stored shape REQUIRES: bump version + add migration in `src/data/migrations.ts` + test + update docs.

## Critical financial invariants (tested in `tests/domain`)
See `docs/FINANCIAL_RULES.md` for full detail. Headlines:
1. Only `expense` (+interest part of loan payments, − refunds) is spending. Transfers, investment contributions, asset acquisitions, loan principal, card settlements are NEVER spending.
2. Δ net worth from transactions alone = income − spending (+ adjustments). Property-tested with random ledgers.
3. Card purchase = expense on a credit-card account (raises outstanding). Card settlement moves money bank→card; not an expense.
4. EMI instalments never create transactions/expenses; reduced available credit is never an expense. EMI blocked credit is an *estimate*; bank-reported values override.
5. Goal allocations are conceptual envelopes: never change balances or net worth.
6. Waste entries are not expenses (money already spent) — they never alter spending/net worth.
7. Expected/recurring items never fabricate transactions; user confirms.
8. Restore never silently destroys data: validate → preview → auto safety-snapshot → apply.
9. Never store card numbers, CVV, PINs, passwords.

## Tone rules for insights
Non-judgmental, explain assumptions, label estimates as estimates, never claim savings without price data.

## Layout
`src/domain` pure logic · `src/data` storage/store/backup/migrations · `src/ui` Preact UI · `tests/` · `docs/` · `scripts/`.

## Docs (keep in sync when behaviour changes)
`docs/ARCHITECTURE.md`, `docs/FINANCIAL_RULES.md`, `docs/DECISIONS.md`, `docs/STATUS.md` (implementation status, known limitations), `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/SYNC.md`.
Update `docs/STATUS.md` at the end of every work session.
