import { useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import type { Id, OwnerId, Transaction } from '../../domain/types';
import { Badge, DateField, MoneyField, SelectField, Segmented, TextArea } from '../kit';
import { defaultOwner, ownerOptions, useDb, useStore } from '../state';
import { ErrorSummary, FormShell, Note, SaveBar, accountOptions, isCard, nonCard, useTxnSave, type FormProps } from './shared';

export default function TransferForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const defs = db.settings.defaults;
  const fromOpts = accountOptions(db, nonCard, old?.fromAccountId);
  const validDefault = defs.accountId && fromOpts.some((a) => a.value === defs.accountId) ? defs.accountId : fromOpts[0]?.value;

  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [from, setFrom] = useState<Id | undefined>(old?.fromAccountId ?? validDefault);
  const [to, setTo] = useState<Id | undefined>(old?.toAccountId);
  const [owner, setOwner] = useState<OwnerId>(old?.ownerId ?? defaultOwner(db, scope));
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const { issues, busy, save, remove, dialog } = useTxnSave(editId, onClose);

  const toOpts = accountOptions(db, (a) => a.id !== from, old?.toAccountId);
  const settle = isCard(db, to);
  const toKind = db.accounts.find((a) => a.id === to)?.kind;

  const submit = async () => {
    const draft: Draft<Transaction> = { type: settle ? 'cc_settlement' : 'transfer', date, amount: amount ?? 0, ownerId: owner, fromAccountId: from, toAccountId: to, notes: notes.trim() || undefined };
    if (await save(draft, settle ? 'Card bill payment saved' : 'Transfer saved')) onClose();
  };

  return (
    <FormShell onSubmit={submit}>
      <MoneyField label="Amount" big autoFocus value={amount} onChange={setAmount} error={issues.find((i) => i.field === 'amount')?.message} />
      <SelectField label="From" value={from} options={fromOpts} onChange={(v) => { setFrom(v); if (v === to) setTo(undefined); }} error={issues.find((i) => i.field === 'fromAccountId')?.message} />
      <SelectField label="To" value={to} options={toOpts} onChange={setTo} placeholder="Choose where it goes" error={issues.find((i) => i.field === 'toAccountId')?.message} />
      <div class="qa-event"><span class="muted">Saved as</span> <Badge tone={settle ? 'info' : undefined}>{settle ? 'Card bill payment' : 'Transfer'}</Badge></div>
      {settle && <Note tone="good">Paying a card bill moves money; it isn’t a new expense. The purchases were already counted when you made them, so your spending stays the same.</Note>}
      {toKind === 'investment' && <Note>Cash sitting in an investment account still counts as part of your assets until it’s invested. Use “Invest” when you buy something with it.</Note>}
      {!settle && toKind !== 'investment' && <Note>A transfer just moves money between your own accounts, so it never counts as spending or income.</Note>}
      <div class="field"><span class="qa-label">Who does it belong to</span><Segmented label="Owner" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
      <DateField label="Date" value={date} onChange={setDate} error={issues.find((i) => i.field === 'date')?.message} />
      <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
      <ErrorSummary issues={issues} known={['amount', 'fromAccountId', 'toAccountId', 'date']} />
      <SaveBar busy={busy} onDelete={remove} />
      {dialog}
    </FormShell>
  );
}
