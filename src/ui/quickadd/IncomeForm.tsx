import { useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import type { Id, OwnerId, Transaction } from '../../domain/types';
import { Button, Check, Chips, DateField, MoneyField, SelectField, Segmented, TextArea, TextField } from '../kit';
import { defaultOwner, ownerOptions, toast, useDb, useStore } from '../state';
import { ErrText, ErrorSummary, FormShell, SaveBar, accountOptions, nonCard, useTxnSave, type FormProps } from './shared';

export default function IncomeForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const defs = db.settings.defaults;
  const accounts = accountOptions(db, nonCard, old?.toAccountId);
  const validDefault = defs.accountId && accounts.some((a) => a.value === defs.accountId) ? defs.accountId : accounts[0]?.value;
  const types = db.settings.incomeTypes;

  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [owner, setOwner] = useState<OwnerId>(old?.ownerId ?? defaultOwner(db, scope));
  const [type, setType] = useState<string | undefined>(old?.incomeType ?? types[0]);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('');
  const [account, setAccount] = useState<Id | undefined>(old?.toAccountId ?? validDefault);
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const [recurring, setRecurring] = useState(!!old?.recurring);
  const { issues, busy, save, remove, dialog } = useTxnSave(editId, onClose);

  const typeOptions = [...new Set([...(old?.incomeType ? [old.incomeType] : []), ...types])].map((t) => ({ value: t, label: t }));

  const addType = async () => {
    const name = newType.trim(); if (!name) { setAdding(false); return; }
    if (!types.some((t) => t.toLowerCase() === name.toLowerCase())) {
      const r = await store.updateSettings({ incomeTypes: [...types, name] });
      if (!r.ok) { toast(r.issues.map((i) => i.message).join(' · '), 'error'); return; }
    }
    setType(types.find((t) => t.toLowerCase() === name.toLowerCase()) ?? name); setNewType(''); setAdding(false);
  };

  const submit = async () => {
    const draft: Draft<Transaction> = { type: 'income', date, amount: amount ?? 0, ownerId: owner, toAccountId: account, incomeType: type, notes: notes.trim() || undefined, recurring: recurring || undefined };
    if (await save(draft, 'Income saved')) onClose();
  };

  return (
    <FormShell onSubmit={submit}>
      <MoneyField label="Amount received" big autoFocus value={amount} onChange={setAmount} error={issues.find((i) => i.field === 'amount')?.message} />
      <div class="field"><span class="qa-label">Who earned it</span><Segmented label="Who earned it" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
      <div class="field">
        <span class="qa-label">Income type</span>
        <Chips label="Income type" value={type} options={typeOptions} onChange={setType} />
        {adding ? (
          <div class="qa-inline">
            <TextField label="New income type" value={newType} onInput={setNewType} placeholder="e.g. Freelance" maxLength={30} autoFocus />
            <Button variant="primary" size="sm" onClick={addType}>Add</Button>
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setNewType(''); }}>Cancel</Button>
          </div>
        ) : <div><Button variant="ghost" size="sm" onClick={() => setAdding(true)}>+ Add type</Button></div>}
      </div>
      <SelectField label="Received into" value={account} options={accounts} onChange={setAccount} hint="Salary and other income goes to a bank, cash or wallet account." error={issues.find((i) => i.field === 'toAccountId')?.message} />
      <DateField label="Date" value={date} onChange={setDate} error={issues.find((i) => i.field === 'date')?.message} />
      <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
      <Check label="Recurring" checked={recurring} onChange={setRecurring} hint="— e.g. monthly salary" />
      <ErrText issues={issues} field="incomeType" />
      <ErrorSummary issues={issues} known={['amount', 'toAccountId', 'date', 'incomeType']} />
      <SaveBar busy={busy} onDelete={remove} />
      {dialog}
    </FormShell>
  );
}
