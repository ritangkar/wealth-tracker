# Financial event model & invariants

Amounts: integer paise, always positive on transactions (except `adjustment`, signed).
Fields that carry meaning separately: `ownerId` (who spent/earned), `fromAccountId` / `toAccountId` (money movement), `paymentMethod` (UPI/card/cash… never an account).

| type | from | to | spending? | savings? | balance effect |
|---|---|---|---|---|---|
| income | – | account | no (income +) | income − spending | to +amt |
| expense | funding account | – | **yes** | – | from −amt (card: outstanding +amt) |
| refund | – | account | **negative spending** | – | to +amt |
| transfer | bank/cash/wallet/investment acct | same kinds (not card) | no | no | from −, to + |
| cc_settlement | non-card acct | credit-card acct | no | no | from −, card outstanding −amt |
| investment_contribution | non-card acct | investment holding | no | counted as "invested" | from −; holding value/invested + |
| investment_redemption | holding | non-card acct | no | no | holding −; to + |
| asset_acquisition | account | asset | no | "invested" | from −; asset + at cost |
| liability_creation | – | optional account (disbursement) | no | no | liability +; account + if given |
| liability_payment | account | liability | **interest part only** (`amount − principalPortion`) | principal = debt paydown | from −amt; liability −principal |
| adjustment | – | account (signed amt) | no | no | account ± (reconciliation) |

A credit-card purchase is an `expense` whose funding account has kind `credit_card` (helper `isCardPurchase`).

## Account balances
`balance = openingBalance + Σ effects` (signed). Card balance is negative = outstanding. Overdraft/negative bank counts as liability; overpaid card counts as asset.

## Invariants
- I1 spending = Σexpense + Σinterest(liability_payment) − Σrefund. Nothing else.
- I2 For any ledger with static valuations: Δ(net worth) = income − spending + adjustments + liability_creation-without-account effects(0). (Property test.)
- I3 transfer/settlement/contribution/loan principal never change net worth (assets↔assets, or assets↔liabilities equally).
- I4 Holdings (investments, assets): value = latest valuation snapshot + flows dated after it. Flows before/at snapshot date are already inside the snapshot.
- I5 EMI: months remaining = tenure − (monthsAtEntry + confirmed instalments), floor 0; final instalment clears outstanding exactly (absorbs rounding); completed ⇒ outstanding 0, blocked 0, no commitment. No transaction is ever created by EMI confirmation.
- I6 Card: `used = nonEmiOutstanding + blockedEmi`, `available = limit − used`, `nonEmi = max(0, ledgerOutstanding − emiOutstanding)`. Blocked policy per EMI: `as_paid` (blocked = remaining principal) or `on_completion` (blocked = original amount until complete) or manual override. All blocked values are estimates. A bank report (limit/available/outstanding, dated) takes precedence; later ledger activity is applied on top and labelled.
- I7 Goal allocations Σ do not alter any balance. "Unallocated cash" = liquid balances − Σ allocations (may go negative → warning).
- I8 Waste ≠ spending.
- I9 Expected items generate *occurrences*, not transactions.
- I10 Savings = income − spending (period). Projection method is explicit & shown with assumptions.
