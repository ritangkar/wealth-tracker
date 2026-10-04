import { useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import type { Id, InvestmentType, OwnerId, Transaction } from '../../domain/types';
import { Button, DateField, MoneyField, SelectField, Segmented, TextArea, TextField, fieldError } from '../kit';
import { defaultOwner, ownerOptions, toast, useDb, useStore } from '../state';
import type { Issue } from '../../domain/ledger';
import { ErrorSummary, FormShell, Note, SaveBar, accountOptions, nonCard, useTxnSave, type FormProps } from './shared';

type Mode = 'add' | 'value' | 'out';
const NEW = '__new';
export const INVESTMENT_TYPES: { value: InvestmentType; label: string }[] = [
  { value: 'mutual_fund', label: 'Mutual fund' }, { value: 'stock', label: 'Stocks' }, { value: 'fd', label: 'Fixed deposit' },
  { value: 'rd', label: 'Recurring deposit' }, { value: 'sip', label: 'SIP' }, { value: 'ppf_epf', label: 'PPF / EPF' }, { value: 'other', label: 'Other' },
];

export default function InvestForm({ editId, onClose, scope }: FormProps) {
  const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const [mode, setMode] = useState<Mode>(old?.type === 'investment_redemption' ? 'out' : 'add');
  return (
    <>
      {!old && (
        <Segmented<Mode> label="What are you doing?" value={mode} onChange={setMode}
          options={[{ value: 'add', label: 'Add money' }, { value: 'value', label: 'Update value' }, { value: 'out', label: 'Withdraw' }]} />
      )}
      {mode === 'value' ? <ValueForm onClose={onClose} /> : <FlowForm key={mode} mode={mode} editId={editId} onClose={onClose} scope={scope} />}
    </>
  );
}

function FlowForm({ mode, editId, onClose, scope }: FormProps & { mode: 'add' | 'out' }) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const defs = db.settings.defaults;
  const invs = db.investments.filter((i) => !i.archived || i.id === old?.investmentId);
  const accounts = accountOptions(db, nonCard, old?.fromAccountId ?? old?.toAccountId);
  const validDefault = defs.accountId && accounts.some((a) => a.value === defs.accountId) ? defs.accountId : accounts[0]?.value;
  const adding = mode === 'add';

  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [inv, setInv] = useState<string | undefined>(old?.investmentId ?? (invs.length === 1 ? invs[0].id : invs.length ? undefined : adding ? NEW : undefined));
  const [account, setAccount] = useState<Id | undefined>((adding ? old?.fromAccountId : old?.toAccountId) ?? validDefault);
  const [owner, setOwner] = useState<OwnerId>(old?.ownerId ?? defaultOwner(db, scope));
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const [nName, setNName] = useState(''); const [nType, setNType] = useState<InvestmentType>('mutual_fund'); const [nInst, setNInst] = useState('');
  const [extra, setExtra] = useState<Issue[]>([]);
  const { issues, busy, save, remove, dialog } = useTxnSave(editId, onClose);

  const pick = (v: string) => { setInv(v); const i = invs.find((x) => x.id === v); if (i) setOwner(i.ownerId); };

  const submit = async () => {
    let investmentId = inv === NEW ? undefined : inv;
    if (inv === NEW) {
      const r = await store.saveInvestment({ name: nName, type: nType, institution: nInst.trim() || undefined, ownerId: owner });
      if (!r.ok) { setExtra(r.issues); toast(r.issues[0].message, 'error'); return; }
      setExtra([]); investmentId = r.value.id; setInv(r.value.id);
    }
    const draft: Draft<Transaction> = {
      type: adding ? 'investment_contribution' : 'investment_redemption', date, amount: amount ?? 0, ownerId: owner, investmentId,
      fromAccountId: adding ? account : undefined, toAccountId: adding ? undefined : account, paymentMethod: adding ? 'bank_transfer' : undefined, notes: notes.trim() || undefined,
    };
    if (await save(draft, adding ? 'Investment saved' : 'Withdrawal saved')) onClose();
  };

  const all = [...issues, ...extra];
  return (
    <FormShell onSubmit={submit}>
      <Note tone="good">{adding
        ? 'Adding money moves cash from your account into an investment. It isn’t spending — it’s counted as “invested”.'
        : 'A withdrawal moves money from an investment back into an account. It isn’t income.'}</Note>
      <MoneyField label={adding ? 'Amount invested' : 'Amount withdrawn'} big autoFocus value={amount} onChange={setAmount} error={fieldError(all, 'amount')} />
      <SelectField label="Investment" value={inv} onChange={pick} placeholder="Choose an investment" error={fieldError(all, 'investmentId')}
        options={[...invs.map((i) => ({ value: i.id, label: i.name })), ...(adding ? [{ value: NEW, label: '＋ New investment…' }] : [])]} />
      {inv === NEW && (
        <div class="qa-sub">
          <TextField label="Investment name" value={nName} onInput={setNName} placeholder="e.g. Nifty 50 index fund" error={fieldError(extra, 'name')} />
          <div class="form-row">
            <SelectField label="Type" value={nType} onChange={(v) => setNType(v as InvestmentType)} options={INVESTMENT_TYPES} />
            <TextField label="Institution (optional)" value={nInst} onInput={setNInst} placeholder="e.g. Zerodha" />
          </div>
        </div>
      )}
      <SelectField label={adding ? 'Paid from' : 'Received into'} value={account} options={accounts} onChange={setAccount} error={fieldError(all, adding ? 'fromAccountId' : 'toAccountId')} />
      <div class="field"><span class="qa-label">Whose investment</span><Segmented label="Owner" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
      <DateField label="Date" value={date} onChange={setDate} error={fieldError(all, 'date')} />
      <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
      <ErrorSummary issues={all} known={['amount', 'investmentId', 'fromAccountId', 'toAccountId', 'date', 'name']} />
      <SaveBar busy={busy} onDelete={remove} />
      {dialog}
    </FormShell>
  );
}

function ValueForm({ onClose }: { onClose: () => void }) {
  const store = useStore(); const db = useDb();
  const targets = [
    ...db.investments.filter((i) => !i.archived).map((i) => ({ value: `investment:${i.id}`, label: i.name })),
    ...db.assets.filter((a) => !a.archived).map((a) => ({ value: `asset:${a.id}`, label: `${a.name} (asset)` })),
  ];
  const [target, setTarget] = useState<string | undefined>(targets.length === 1 ? targets[0].value : undefined);
  const [value, setValue] = useState<number | undefined>();
  const [invested, setInvested] = useState<number | undefined>();
  const [date, setDate] = useState(store.today());
  const [issues, setIssues] = useState<Issue[]>([]); const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) { setIssues([{ field: 'target', message: 'Choose what you’re updating' }]); return; }
    if (value === undefined) { setIssues([{ field: 'value', message: 'Enter the current value' }]); return; }
    const [targetType, targetId] = target.split(':') as ['investment' | 'asset', string];
    setBusy(true);
    try {
      const r = await store.addValuation({ targetType, targetId, date, value, invested: targetType === 'investment' ? invested : undefined });
      if (r.ok) { toast('Value updated'); onClose(); } else { setIssues(r.issues); toast(r.issues[0].message, 'error'); }
    } finally { setBusy(false); }
  };

  if (!targets.length) return <Note>Add an investment first (use “Add money” → “New investment”), then come back to record what it’s worth.</Note>;
  return (
    <FormShell onSubmit={submit}>
      <Note tone="good">Updating a value records what something is worth today. It changes your net worth, but not your bank balance — no transaction is created.</Note>
      <SelectField label="Investment or asset" value={target} options={targets} onChange={setTarget} placeholder="Choose…" error={fieldError(issues, 'target')} />
      <MoneyField label="Value as of the date" big autoFocus value={value} onChange={setValue} error={fieldError(issues, 'value')} />
      {target?.startsWith('investment:') && <MoneyField label="Amount invested so far (optional)" value={invested} onChange={setInvested} hint="Your total cost, if you know it — lets us show gains." error={fieldError(issues, 'invested')} />}
      <DateField label="As of" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
      <ErrorSummary issues={issues} known={['target', 'value', 'invested', 'date']} />
      <div class="qa-bar"><span class="qa-spacer" /><Button type="submit" variant="primary" disabled={busy}>Update value</Button></div>
    </FormShell>
  );
}
