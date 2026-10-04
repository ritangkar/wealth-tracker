# UI guide (for contributors / agents)

Stack: Preact 11 + TS, hash routing, hand-written CSS in `src/ui/styles.css` (CSS variables, dark mode). No UI libs.

## Rules
- Pages are `export default function Page()` in `src/ui/pages/*.tsx`. They read data with `const db = useDb()`, scope with `const [scope] = useScope()`, mutate ONLY through `useStore()` commands (never mutate `db`).
- NEVER re-implement money rules in UI. Use `src/domain/*` (cashflow, networth, cards, emi, expected, goals, waste, insights, afford, holdings, liabilities, ledger).
- Money is integer paise. Show with `formatMoney`/`formatCompact` (`src/ui/format.ts`). Inputs use `<MoneyField value={paise} onChange={...}>`.
- Person-scoped: filter with `inScope(record.ownerId, scope)` (or domain fns that take `scope`). Ownership shown with `personName(db, ownerId)`.
- Tone: calm, non-judgmental. Estimates must be labelled "estimate"; show assumptions (`<Disclosure>`).
- Mobile first: one column, ≥44px targets, `Card`/`Row` lists rather than tables. Desktop: `.cols .cols-2`.
- Accessibility: every input has a label (use Field components), charts have text summaries (`summary` prop), dialogs use `Sheet`, errors via `fieldError`/`FormErrors`.
- Sub-views use query tabs: `#/plan?tab=goals` read via `useRoute().query`; switch with `navigate('/plan?tab=goals')`. Use a `Tabs` row (role=tablist; see `.tabs/.tab` CSS).
- Async commands: `const { run, busy } = useAction(); await run(() => store.addX(...), 'Saved')` shows toast and returns the value, or undefined on error. For forms that must show field errors, call the store directly and use `result.issues` with `fieldError(issues,'field')`.
- Confirm destructive actions with `const [ask, dialog] = useConfirm()` (render `{dialog}`).
- Don't add dependencies.

## Kit (`src/ui/kit/index.tsx`, `charts.tsx`)
Page, Card, Grid, Stat, EmptyState, Banner, Badge, Progress, Row, Disclosure, Button, Segmented, Chips, Field, TextField, TextArea, MoneyField, DateField, SelectField, Check, IntField, FormErrors, fieldError, Sheet, ConfirmDialog, useConfirm, cx; charts: BarChart, LineChart, Breakdown, Sparkline.

## State (`src/ui/state.ts`)
useStore, useDb, useScope, personName, ownerOptions, defaultOwner, toast, useAction, openQuickAdd(kind, editId?), closeQuickAdd. Quick kinds: expense | income | transfer | invest | loan | waste | goal.

## Store commands (`src/data/store.ts`) — all return `Promise<Result>` = `{ok:true,value}|{ok:false,issues}`
Transactions: addTransaction, updateTransaction, deleteTransaction. Accounts: addAccount, updateAccount, deleteAccount. Categories: addCategory, renameCategory, deleteCategory.
Holdings: saveInvestment, saveAsset, addValuation, deleteValuation, deleteHolding. Liabilities: saveLiability, deleteLiability. Goals: saveGoal, deleteGoal, addAllocation, deleteAllocation. Waste: saveWaste, deleteWaste.
Cards: addCardReport(draft,{reconcile}), deleteCardReport, addEmi, updateEmi, confirmEmiInstalment (creates NO transaction), undoEmiInstalment, deleteEmi.
Expected: saveExpected, confirmOccurrence (creates the real txn), skipOccurrence, stopExpected(id, resume?), deleteExpected. Settings: updateSettings. Snapshot: captureSnapshot.
Draft<T> = entity without id/createdAt/updatedAt.
