# Testing strategy

| Layer | Tool | Where | What |
|---|---|---|---|
| Domain rules | Vitest | `tests/domain` | Every financial event type, double-counting prevention, card/EMI engine (incl. spec example 1.5L limit / 50k EMI), loans, holdings, goals, waste, expected items, savings & projection, insights tone/assumptions, "can I afford". Includes a **randomised property test**: Δ net worth = income − spending (+ adjustments) for random ledgers. |
| Data layer | Vitest + fake-indexeddb | `tests/data` | Store CRUD & validation, rollback on persist failure, serialised commits, real IndexedDB round trip, backup export/import, malformed/truncated/incomplete/newer/tampered files, migrations (stepwise, missing, pure), merge/tombstones, safe restore (safety snapshot, abort paths), recovery mode. |
| PWA / hosting / responsive | Playwright (Chromium; desktop + Pixel 7) | `tests/e2e` | Served under `/wealth-tracker/` like Pages: relative manifest/icons/SW scope, deep links & refresh, offline startup/operation, data persistence offline, update prompt & stale-cache removal across two builds, no horizontal overflow at 390 px, 44 px nav targets, user flows (add expense, backup/restore, lock). |

Run: `npm test` (unit, ~1 s) · `npm run test:e2e` (builds two deploys; needs Chromium; set `CHROMIUM_PATH` if not at `/opt/pw-browsers/chromium`).
Rule: any new financial rule needs a test in `tests/domain` first; any stored-shape change needs a migration test.
Not covered by automation: real-device iOS install behaviour and physical-device offline (manual checklist in `STATUS.md`).
