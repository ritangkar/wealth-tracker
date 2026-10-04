import { useMemo, useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import type { Issue } from '../../domain/ledger';
import type { AssetKind, Id, OwnerId, Transaction } from '../../domain/types';
import { inScope } from '../../domain/scope';
import { liabilityOutstanding } from '../../domain/liabilities';
import { DateField, MoneyField, Segmented, SelectField, TextArea, TextField } from '../kit';
import { formatDate, formatMoney } from '../format';
import { defaultOwner, ownerOptions, toast, useDb, useStore } from '../state';
import { ErrText, ErrorSummary, FormShell, Note, SaveBar, accountOptions, nonCard, useTxnSave, type FormProps } from './shared';

type Mode = 'refund' | 'asset' | 'loan_in';
const NEW = '__new';
const ASSET_KINDS: { value: AssetKind; label: string }[] = [
  { value: 'gold', label: 'Gold' }, { value: 'property', label: 'Property' }, { value: 'vehicle', label: 'Vehicle' }, { value: 'other', label: 'Other' },
];

export default function MoreForm(props: FormProps) {
  const db = useDb();
  const old = props.editId ? db.transactions.find((t) => t.id === props.editId) : undefined;
  const [mode, setMode] = useState<Mode>(old?.type === 'asset_acquisition' ? 'asset' : old?.type === 'liability_creation' ? 'loan_in' : 'refund');
  return (
    <>
      {!old && (
        <Segmented<Mode> label="What happened?" value={mode} onChange={setMode}
          options={[{ value: 'refund', label: 'Refund' }, { value: 'asset', label: 'Buy an asset' }, { value: 'loan_in', label: 'Loan taken / top-up' }]} />
      )}
      {mode === 'refund' ? <RefundForm {...props} /> : mode === 'asset' ? <AssetForm {...props} /> : <LoanTakenForm {...props} />}
    </>
  );
}

function RefundForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const [q, setQ] = useState('');
  const [origId, setOrigId] = useState<Id | undefined>(old?.refundOfId);
  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [account, setAccount] = useState<Id | undefined>(old?.toAccountId);
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const { issues, save, busy, remove, dialog } = useTxnSave(editId, onClose);
  const accounts = accountOptions(db, () => true, old?.toAccountId);

  const remaining = (id: Id) => {
    const o = db.transactions.find((t) => t.id === id); if (!o) return 0;
    return o.amount - db.transactions.filter((t) => t.type === 'refund' && t.refundOfId === id && t.id !== editId).reduce((s, t) => s + t.amount, 0);
  };
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return db.transactions.filter((t) => t.type === 'expense' && inScope(t.ownerId, scope) && remaining(t.id) > 0)
      .filter((t) => !term || `${t.merchant ?? ''} ${db.categories.find((c) => c.id === t.categoryId)?.name ?? ''} ${t.notes ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
  }, [db.transactions, q, scope]);
  const orig = db.transactions.find((t) => t.id === origId);

  const pick = (id: Id) => {
    setOrigId(id); const o = db.transactions.find((t) => t.id === id)!;
    setAmount(remaining(id)); setAccount(o.fromAccountId);
  };

  const submit = async () => {
    if (!orig) return;
    const draft: Draft<Transaction> = {
      type: 'refund', date, amount: amount ?? 0, ownerId: orig.ownerId, toAccountId: account, refundOfId: orig.id,
      categoryId: orig.categoryId, subcategoryId: orig.subcategoryId, merchant: orig.merchant, notes: notes.trim() || undefined,
    };
    if (await save(draft, 'Refund saved')) onClose();
  };

  return (
    <FormShell onSubmit={submit}>
      <Note tone="good">A refund brings money back and <b>reduces your spending</b> in the same category. It isn’t income.</Note>
      {orig ? (
        <div class="field">
          <span class="qa-label">Refund for</span>
          <div class="qa-note qa-note-info">
            <b>{orig.merchant || 'Expense'}</b> · {formatMoney(orig.amount)} · {formatDate(orig.date)}<br />
            Still refundable: <b>{formatMoney(remaining(orig.id))}</b>
            {!editId && <> · <button type="button" class="btn btn-ghost btn-sm" onClick={() => { setOrigId(undefined); setAmount(undefined); }}>Change</button></>}
          </div>
        </div>
      ) : (
        <div class="field">
          <TextField label="Find the expense" value={q} onInput={setQ} placeholder="Search merchant, category or note" autoFocus />
          <div role="listbox" aria-label="Recent expenses" class="qa-pick">
            {candidates.length === 0 && <p class="hint">No refundable expenses found.</p>}
            {candidates.map((t) => (
              <button type="button" role="option" aria-selected={false} key={t.id} class="row row-click" onClick={() => pick(t.id)}>
                <div class="row-main"><div class="row-title">{t.merchant || db.categories.find((c) => c.id === t.categoryId)?.name || 'Expense'}</div>
                  <div class="row-sub">{formatDate(t.date)} · refundable {formatMoney(remaining(t.id))}</div></div>
                <div class="row-right"><div class="row-amt">{formatMoney(t.amount)}</div></div>
              </button>
            ))}
          </div>
          <ErrText issues={issues} field="refundOfId" />
        </div>
      )}
      {orig && (
        <>
          <MoneyField label="Refund amount" big value={amount} onChange={setAmount} error={issues.find((i) => i.field === 'amount')?.message} />
          <SelectField label="Received into" value={account} options={accounts} onChange={setAccount} error={issues.find((i) => i.field === 'toAccountId')?.message}
            hint="Defaults to the account that paid. For a card purchase, the refund lowers the card’s outstanding." />
          <DateField label="Date" value={date} onChange={setDate} error={issues.find((i) => i.field === 'date')?.message} />
          <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
          <ErrorSummary issues={issues} known={['amount', 'toAccountId', 'date', 'refundOfId']} />
          <SaveBar busy={busy} onDelete={remove} />
        </>
      )}
      {dialog}
    </FormShell>
  );
}

function AssetForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const defs = db.settings.defaults;
  const assets = db.assets.filter((a) => !a.archived || a.id === old?.assetId);
  const accounts = accountOptions(db, () => true, old?.fromAccountId);
  const validDefault = defs.accountId && accounts.some((a) => a.value === defs.accountId) ? defs.accountId : accounts[0]?.value;
  const [asset, setAsset] = useState<string | undefined>(old?.assetId ?? (assets.length ? undefined : NEW));
  const [nName, setNName] = useState(''); const [nKind, setNKind] = useState<AssetKind>('gold');
  const [owner, setOwner] = useState<OwnerId>(old?.ownerId ?? defaultOwner(db, scope));
  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [account, setAccount] = useState<Id | undefined>(old?.fromAccountId ?? validDefault);
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const [extra, setExtra] = useState<Issue[]>([]);
  const { issues, save, busy, remove, dialog } = useTxnSave(editId, onClose);
  const all = [...issues, ...extra];

  const pick = (v: string) => { setAsset(v); const a = assets.find((x) => x.id === v); if (a) setOwner(a.ownerId); };
  const submit = async () => {
    let assetId = asset === NEW ? undefined : asset;
    if (asset === NEW) {
      const r = await store.saveAsset({ name: nName.trim(), kind: nKind, ownerId: owner });
      if (!r.ok) { setExtra(r.issues); toast(r.issues[0].message, 'error'); return; }
      setExtra([]); assetId = r.value.id; setAsset(r.value.id);
    }
    const draft: Draft<Transaction> = { type: 'asset_acquisition', date, amount: amount ?? 0, ownerId: owner, fromAccountId: account, assetId, notes: notes.trim() || undefined };
    if (await save(draft, 'Asset purchase saved')) onClose();
  };

  return (
    <FormShell onSubmit={submit}>
      <Note tone="good">This moves money from an account into the asset. It is <b>not an expense</b> — your net worth stays the same because cash became an asset. Keep its value up to date under Invest → Update value.</Note>
      <SelectField label="Asset" value={asset} onChange={pick} placeholder="Choose an asset" error={all.find((i) => i.field === 'assetId')?.message}
        options={[...assets.map((a) => ({ value: a.id, label: a.name })), { value: NEW, label: '+ New asset…' }]} />
      {asset === NEW && (
        <div class="qa-sub">
          <TextField label="Asset name" value={nName} onInput={setNName} placeholder="e.g. Gold coins, Flat, Car" error={all.find((i) => i.field === 'name')?.message} />
          <SelectField label="Kind" value={nKind} onChange={setNKind} options={ASSET_KINDS} />
          <div class="field"><span class="qa-label">Owner</span><Segmented label="Owner" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
        </div>
      )}
      <MoneyField label="Amount" big value={amount} onChange={setAmount} error={all.find((i) => i.field === 'amount')?.message} />
      <SelectField label="Paid from" value={account} options={accounts} onChange={setAccount} error={all.find((i) => i.field === 'fromAccountId')?.message} hint="Credit cards are allowed — the card’s outstanding goes up." />
      <DateField label="Date" value={date} onChange={setDate} error={all.find((i) => i.field === 'date')?.message} />
      <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
      <ErrorSummary issues={all} known={['amount', 'assetId', 'name', 'fromAccountId', 'date']} />
      <SaveBar busy={busy} onDelete={remove} />
      {dialog}
    </FormShell>
  );
}

function LoanTakenForm({ editId, onClose }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const loans = db.liabilities.filter((l) => l.status === 'active' || l.id === old?.liabilityId);
  const accounts = accountOptions(db, nonCard, old?.toAccountId);
  const [loan, setLoan] = useState<Id | undefined>(old?.liabilityId ?? (loans.length === 1 ? loans[0].id : undefined));
  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [account, setAccount] = useState<string>(old?.toAccountId ?? '');
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const { issues, setIssues, save, busy, remove, dialog } = useTxnSave(editId, onClose);
  const l = loans.find((x) => x.id === loan);

  const submit = async () => {
    if (!l) { setIssues([{ field: 'liabilityId', message: 'Choose a loan' }]); return; }
    const draft: Draft<Transaction> = { type: 'liability_creation', date, amount: amount ?? 0, ownerId: l.ownerId, liabilityId: l.id, toAccountId: account || undefined, notes: notes.trim() || undefined };
    if (await save(draft, 'Loan saved')) onClose();
  };

  return (
    <FormShell onSubmit={submit}>
      {!loans.length ? <Note>No loans yet. Add one under “Cards, EMIs &amp; loans” first, then record a top-up here.</Note> : (
        <>
          <Note tone="good">Borrowing adds to what you owe and, if you pick an account, to that account’s balance. It is <b>not income</b>, and repaying principal later isn’t spending.</Note>
          <SelectField label="Loan" value={loan} onChange={setLoan} placeholder="Choose a loan" error={issues.find((i) => i.field === 'liabilityId')?.message}
            options={loans.map((x) => ({ value: x.id, label: `${x.name} · ${formatMoney(liabilityOutstanding(db, x))} left` }))} />
          <MoneyField label="Amount borrowed" big value={amount} onChange={setAmount} error={issues.find((i) => i.field === 'amount')?.message} />
          <SelectField label="Received into (optional)" value={account || undefined} onChange={setAccount} options={[{ value: '', label: 'Not received into an account' }, ...accounts]}
            placeholder="Choose account" hint="Leave blank if the money went straight to someone else (e.g. a seller)." error={issues.find((i) => i.field === 'toAccountId')?.message} />
          <DateField label="Date" value={date} onChange={setDate} error={issues.find((i) => i.field === 'date')?.message} />
          <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
          <ErrorSummary issues={issues} known={['amount', 'liabilityId', 'toAccountId', 'date']} />
          <SaveBar busy={busy} onDelete={remove} />
        </>
      )}
      {dialog}
    </FormShell>
  );
}
