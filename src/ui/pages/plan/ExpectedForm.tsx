import { useState } from 'preact/hooks';
import { Button, DateField, FormErrors, MoneyField, SelectField, Sheet, TextArea, TextField, fieldError } from '../../kit';
import { toast, useAction, useDb, useScope, useStore, ownerOptions, defaultOwner } from '../../state';
import { PAYMENT_LABELS } from '../../format';
import type { ExpectedItem, ExpectedKind, Frequency, OwnerId, PaymentMethod } from '../../../domain/types';
import './plan.css';

export const KIND_OPTIONS: { value: ExpectedKind; label: string }[] = [
  { value: 'subscription', label: 'Subscription' }, { value: 'sip', label: 'SIP (investment)' }, { value: 'salary', label: 'Salary / income' }, { value: 'bill', label: 'Bill' }, { value: 'other', label: 'Other' },
];
export const KIND_LABEL: Record<ExpectedKind, string> = { subscription: 'Subscription', sip: 'SIP', salary: 'Salary', bill: 'Bill', other: 'Other' };
const DEFAULT_CAT: Partial<Record<ExpectedKind, string>> = { bill: 'cat_bills', subscription: 'cat_subscriptions', other: 'cat_other' };
export const FREQ_OPTIONS: { value: Frequency; label: string }[] = [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Every 3 months' }, { value: 'yearly', label: 'Yearly' }];
export const FREQ_LABEL: Record<Frequency, string> = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' };

/** Add / edit an expected (recurring) item. Nothing here creates a transaction. */
export function ExpectedFormSheet({ item, defaultKind = 'subscription', lockKind, onClose }: { item?: ExpectedItem; defaultKind?: ExpectedKind; lockKind?: boolean; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope(); const { busy } = useAction();
  const [kind, setKind] = useState<ExpectedKind>(item?.kind ?? defaultKind);
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState<number | undefined>(item?.amount);
  const [freq, setFreq] = useState<Frequency>(item?.frequency ?? 'monthly');
  const [start, setStart] = useState(item?.startDate ?? store.today());
  const [owner, setOwner] = useState<OwnerId>(item?.ownerId ?? defaultOwner(db, scope));
  const [acct, setAcct] = useState(item?.accountId ?? db.settings.defaults.accountId ?? '');
  const [pm, setPm] = useState<PaymentMethod | ''>(item?.paymentMethod ?? '');
  const [cat, setCat] = useState(item?.categoryId ?? DEFAULT_CAT[item?.kind ?? defaultKind] ?? '');
  const [merchant, setMerchant] = useState(item?.merchant ?? '');
  const [inv, setInv] = useState(item?.investmentId ?? '');
  const [incType, setIncType] = useState(item?.incomeType ?? 'Salary');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);

  const accounts = db.accounts.filter((a) => !a.archived || a.id === item?.accountId).map((a) => ({ value: a.id, label: a.name }));
  const cats = db.categories.filter((c) => c.kind === 'expense' && !c.parentId).map((c) => ({ value: c.id, label: c.name }));
  const invs = db.investments.filter((i) => !i.archived || i.id === item?.investmentId).map((i) => ({ value: i.id, label: i.name }));
  const isIncome = kind === 'salary'; const isSip = kind === 'sip';

  const changeKind = (k: ExpectedKind) => {
    // Move the category along with the kind only while it is still the previous kind's default (or empty).
    if (!cat || cat === DEFAULT_CAT[kind]) setCat(DEFAULT_CAT[k] ?? '');
    setKind(k);
  };
  const save = async () => {
    const missing: { field: string; message: string }[] = [];
    if (!isIncome && !isSip && !cat) missing.push({ field: 'categoryId', message: 'Choose a category so it lands in the right place when confirmed' });
    if (isSip && !inv) missing.push({ field: 'investmentId', message: 'Choose which investment this SIP goes into' });
    if (missing.length) { setIssues(missing); return; }
    const draft: Omit<ExpectedItem, 'id' | 'createdAt' | 'updatedAt'> = {
      kind, name: name.trim(), amount: amount ?? 0, frequency: freq, startDate: start, ownerId: owner,
      accountId: acct || undefined, paymentMethod: !isIncome && pm ? pm : undefined,
      categoryId: !isIncome && !isSip && cat ? cat : undefined, merchant: !isIncome && !isSip && merchant.trim() ? merchant.trim() : undefined,
      investmentId: isSip && inv ? inv : undefined, incomeType: isIncome ? incType : undefined, notes: notes.trim() || undefined,
      skipped: item?.skipped ?? [], confirmed: item?.confirmed ?? {}, lastUsed: item?.lastUsed, status: item?.status ?? 'active', endDate: item?.endDate,
    };
    const r = await store.saveExpected(draft, item?.id);
    if (r.ok) { toast(item ? 'Saved' : 'Added'); onClose(); } else setIssues(r.issues);
  };
  return (
    <Sheet title={item ? `Edit ${item.name}` : 'Add recurring item'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>Save</Button></>}>
      <div class="px-form">
        <p class="px-sub" style={{ margin: 0 }}>This is an <b>expected</b> item — a reminder. Nothing is recorded as real money until you confirm each occurrence.</p>
        <FormErrors issues={issues} />
        {!lockKind && <SelectField label="What kind?" value={kind} onChange={changeKind} options={KIND_OPTIONS} />}
        <TextField label="Name" value={name} onInput={setName} error={fieldError(issues, 'name')} placeholder={kind === 'subscription' ? 'e.g. Netflix' : kind === 'sip' ? 'e.g. Monthly index fund SIP' : kind === 'salary' ? 'e.g. Salary' : 'e.g. Electricity'} autoFocus />
        <MoneyField label="Amount each time" value={amount} onChange={setAmount} error={fieldError(issues, 'amount')} />
        <div class="px-fieldrow">
          <SelectField label="How often?" value={freq} onChange={setFreq} options={FREQ_OPTIONS} />
          <DateField label="Next / first date" value={start} onChange={setStart} error={fieldError(issues, 'startDate')} />
        </div>
        <SelectField label="Whose is it?" value={owner} onChange={setOwner} options={ownerOptions(db)} />
        <SelectField label={isIncome ? 'Paid into account' : 'Paid from account'} value={acct || undefined} onChange={setAcct} options={accounts} placeholder="Choose account (optional)" />
        {!isIncome && <SelectField label="Payment method" value={pm || undefined} onChange={(v) => setPm(v)} options={Object.entries(PAYMENT_LABELS).map(([value, label]) => ({ value: value as PaymentMethod, label }))} placeholder="Optional" />}
        {!isIncome && !isSip && <SelectField label="Category" value={cat || undefined} onChange={setCat} options={cats} placeholder="Choose category" error={fieldError(issues, 'categoryId')} />}
        {!isIncome && !isSip && <TextField label="Merchant" value={merchant} onInput={setMerchant} placeholder="Optional" />}
        {isSip && <SelectField label="Investment" value={inv || undefined} onChange={setInv} options={invs} placeholder={invs.length ? 'Choose an investment' : 'No investments yet — add one in Wealth'} hint="The SIP money goes into this holding when you confirm." error={fieldError(issues, 'investmentId')} />}
        {isIncome && <SelectField label="Income type" value={incType} onChange={setIncType} options={db.settings.incomeTypes.map((t) => ({ value: t, label: t }))} />}
        <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
      </div>
    </Sheet>
  );
}
