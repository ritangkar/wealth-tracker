# Project status

_Last updated: end of build session 1 (after independent audit + remediation)._

## Implemented
- **Domain** (`src/domain`): 11 financial event types with explicit effects; spending/savings/net-worth invariants (property-tested); accounts incl. credit cards (signed balances); card metrics with bank-report precedence + estimates; EMI engine (new/existing, instalments without transactions, completion, blocking policies); loans (zero/interest, debt-free projection); investments/assets with manual valuation snapshots; net worth per person + daily snapshots; savings, projection (explicit assumptions), comparisons; goals as non-double-counting envelopes; waste; expected/recurring occurrences (confirm/skip/stop, no fabricated transactions, duplicate-avoidance heuristic); insights; "can I afford this".
- **Data**: IndexedDB storage + store with validated commands, rollback, tombstones; versioned JSON backup, strict validation (structure, references, financial rules), checksum, migrations framework, merge + replace restore with automatic safety snapshots, recovery mode; CSV export.
- **UI**: Home dashboard, Activity, quick-add (expense/income/transfer/invest+valuation/loan+EMI instalment/waste/goal), Wealth (overview/accounts/investments/assets), Debt (cards/EMIs/loans), Plan (savings/goals/upcoming/afford), Subscriptions, Waste, Insights (nudges/spending/trends), Settings (backup/restore, people & targets, categories, income types, lock, theme, storage, demo/reset), Welcome onboarding.
- **PWA**: relative paths, hash routing, generated service worker (precache, versioned caches, waiting-worker update prompt, navigation revalidation), manifest + maskable icons, offline, 404 redirect, CI deploy workflow.
- **Tests**: 117 unit/data tests (incl. audit regression suite), 20 Playwright tests (desktop + Pixel 7) run against a Pages-style `/wealth-tracker/` subpath.

## Known limitations / not done
- No cross-device sync (by design; backup + merge, see SYNC.md).
- App lock is UI-only; data at rest and backups are unencrypted (stated in-app). Passphrase-encrypted backups are a good next step.
- Card rewards: no bank rules hard-coded (bank site unreachable during build; rules change). User-entered rule only.
- EMI interest/fees are not auto-recorded as expenses (record billed interest as "Fees & interest").
- Archived accounts/investments/assets still count in net worth if they hold value (set value to 0 to remove).
- `holdingValue` assumes invested = value for a snapshot saved without a cost basis.
- Multi-tab concurrent editing is last-writer-wins per record.
- iOS install/eviction behaviour and real-device offline are not automatable here — manual checklist below.
- Editing a recurring item's start date/frequency can orphan past confirmations (they may reappear as pending; 'Mark as recorded' resolves it).
- No asset sale/disposal flow (use a withdrawal/valuation update); no CSV import.
- Quick Add → More covers refund, asset purchase, loan taken/top-up.

## Manual checklist before relying on it
1. Deploy; open `https://<user>.github.io/<repo>/` on iPhone Safari → Add to Home Screen; airplane mode → launches and works.
2. Add a few records, Settings → Download backup; restore on a second device with Merge.
3. Publish a trivial change; confirm "A new version is ready" appears and data persists after Update.

## Audit
An independent read-only audit found 24 issues (3 high). All high/medium and nearly all low items were fixed with regression tests (`tests/domain/audit-regressions.test.ts`): opening-date semantics, EMI interest & EMI-in-ledger semantics, multi-tab consistency (BroadcastChannel) + recovery repair, stricter import validation, merge conflict handling, projection double-counting, SW shell caching, CSV formula injection, lock hardening, radio-group keyboard support.
