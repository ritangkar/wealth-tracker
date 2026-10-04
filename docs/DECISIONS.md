# Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Vite + TypeScript + Preact, no router/state/chart/validation libraries | Small bundle (~25 kB gz app code), full control, fewer supply-chain risks. |
| D2 | Integer paise everywhere | Exact arithmetic; no float drift in sums/splits. |
| D3 | Hash routing | Pages has no SPA fallback; hash survives refresh/deep link under any subpath. |
| D4 | Hand-written service worker (generated at build) | Fully inspectable, relative paths, controlled update flow; avoids a plugin dependency. |
| D5 | Waiting-worker update flow | Never swap code under an open form; user-initiated reload. |
| D6 | In-memory authoritative state + IndexedDB write-through | Simple, fast domain functions; durable; easy rollback. |
| D7 | Credit-card purchase = `expense` from a `credit_card` account (no separate type) | One spending rule; liability effect falls out of signed balances. `isCardPurchase()` classifies. |
| D8 | Card balance stored negative; outstanding = −balance | Uniform account arithmetic: every event is `from −amt / to +amt`. |
| D9 | Savings = income − spending (principal repayments & investing are *uses* of savings, not spending) | Matches net-worth identity (I2) and the user's mental model. |
| D10 | Interest part of loan payments is spending; EMI instalments create no transaction | Avoid double counting the original purchase; interest on EMIs is recorded manually as a Fees & interest expense if billed. |
| D11 | Holding value = latest manual snapshot + flows after it | Contributions don't vanish from net worth before the user updates valuation; no fabricated transactions. |
| D12 | Bank-reported card values override estimates, adjusted by later ledger activity and labelled | Spec precedence + honesty about staleness. Optional "reconcile" adds an `adjustment`, never an expense. |
| D13 | EMI credit blocking is a per-EMI policy (`as_paid` default / `on_completion` / manual override) | Issuers differ; always labelled estimate. |
| D14 | Goal allocations are signed envelope entries, never touching balances | Prevents double counting (I7). |
| D15 | No card reward rules hard-coded | HDFC site unreachable from the build environment and rules change; the user supplies the rule (blocks, points, value, exclusions). |
| D16 | Joint (`hh`) is a third owner value; person views exclude joint records, household view includes everything | Ownership stays distinct; no arbitrary 50/50 splitting. |
| D17 | App lock is UI-only; honest wording | Real at-rest encryption needs a key the user must remember; deferred (see STATUS). |
| D18 | Backup checksum mismatch is a warning requiring explicit acknowledgement; structural/referential/business-rule failures block | Hand-edited files are legitimate but risky. |
| D19 | Net-worth history = real daily snapshots only (auto-captured on use) | Never fabricate history. |
| D20 | Insights are pure functions with explicit assumptions and configurable thresholds | Explainable, testable, non-judgmental. |
