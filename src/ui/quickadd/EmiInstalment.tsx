import type { Emi } from '../../domain/types';
import type { EmiState } from '../../domain/emi';
import { Check, MoneyField } from '../kit';
import { formatMoney } from '../format';

/** Scheduled principal of the next instalment (mirrors the domain's pro-rata rule; display only). */
export const emiScheduledPrincipal = (s: EmiState) =>
  s.monthsRemaining <= 1 ? s.outstanding : Math.min(s.outstanding, Math.round(s.outstanding / s.monthsRemaining));

/** "Amount billed this month" + optional interest/fees checkbox, shared by Quick Add and the EMI page. */
export function EmiBilledFields({ e, s, billed, onBilled, record, onRecord }: {
  e: Emi; s: EmiState; billed: number | undefined; onBilled: (v: number | undefined) => void; record: boolean; onRecord: (v: boolean) => void;
}) {
  const principal = emiScheduledPrincipal(s);
  const extra = (billed ?? 0) - principal;
  return (
    <>
      <MoneyField label="Amount billed this month (optional)" value={billed} onChange={onBilled}
        hint={`Defaults to the EMI amount (${formatMoney(e.emiAmount)}). Change it if your bank billed a different amount.`} />
      {extra > 0 && (
        <Check label="Record the extra as interest/fees (counts as spending)" checked={record} onChange={onRecord}
          hint={`— about ${formatMoney(extra)} above the ${formatMoney(principal)} principal.`} />
      )}
      <p class="hint">The principal part was already counted when the card purchase was recorded, so it is not recorded again. Only interest or fees on top are new spending.</p>
    </>
  );
}

export const EMI_LEDGER_HINT = 'Indian bank apps often show “total outstanding” without the remaining EMI principal. Leave this ticked if the balance you track includes your EMI balances (the usual case when you recorded the full purchase). Untick it if your tracked balance matches the bank’s “total outstanding excluding EMI” — the app then adds EMI principal on top.';

/** Card-account setting: does the tracked balance already include remaining EMI balances? */
export function EmiInLedgerCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <Check label="My tracked balance already includes remaining EMI balances" checked={checked} onChange={onChange} />
      <p class="hint">{EMI_LEDGER_HINT}</p>
    </div>
  );
}
