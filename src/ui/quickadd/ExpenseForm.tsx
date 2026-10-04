import { useId, useMemo, useRef, useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import type { Id, OwnerId, PaymentMethod, Transaction } from '../../domain/types';
import { Check, Chips, DateField, Disclosure, MoneyField, SelectField, Segmented, TextArea, TextField } from '../kit';
import { defaultOwner, ownerOptions, useDb, useStore } from '../state';
import { ErrText, ErrorSummary, FormShell, PAYMENT_OPTIONS, SaveBar, accountOptions, isCard, splitTags, useTxnSave, type FormProps } from './shared';

export default function ExpenseForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const defs = db.settings.defaults;
  const listId = useId();
  const root = useRef<HTMLFormElement>(null);

  const accounts = accountOptions(db, () => true, old?.fromAccountId);
  const validDefault = defs.accountId && accounts.some((a) => a.value === defs.accountId) ? defs.accountId : accounts[0]?.value;

  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const [cat, setCat] = useState<Id | undefined>(old?.categoryId);
  const [sub, setSub] = useState<Id | undefined>(old?.subcategoryId);
  const [catTouched, setCatTouched] = useState(!!old);
  const [owner, setOwner] = useState<OwnerId>(old?.ownerId ?? defaultOwner(db, scope));
  const [account, setAccount] = useState<Id | undefined>(old?.fromAccountId ?? validDefault);
  const [method, setMethod] = useState<PaymentMethod | undefined>(old?.paymentMethod ?? (isCard(db, validDefault) ? 'credit_card' : defs.paymentMethod ?? 'upi'));
  const [date, setDate] = useState(old?.date ?? store.today());
  const [merchant, setMerchant] = useState(old?.merchant ?? '');
  const [notes, setNotes] = useState(old?.notes ?? '');
  const [tags, setTags] = useState((old?.tags ?? []).join(', '));
  const [oneOff, setOneOff] = useState(!!old?.oneOff);
  const [recurring, setRecurring] = useState(!!old?.recurring);
  const { issues, busy, save, remove, dialog } = useTxnSave(editId, onClose);

  // Categories ordered by recent use so the usual suspects are under the thumb.
  const topCats = useMemo(() => {
    const since = store.today().slice(0, 4) + '-01-01';
    const use = new Map<Id, number>();
    for (const t of db.transactions) if (t.type === 'expense' && t.categoryId && t.date >= since) {
      const top = db.categories.find((c) => c.id === t.categoryId)?.parentId ?? t.categoryId; use.set(top, (use.get(top) ?? 0) + 1);
    }
    return db.categories.filter((c) => c.kind === 'expense' && !c.parentId).map((c, i) => ({ c, i, n: use.get(c.id) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.c);
  }, [db.categories, db.transactions]);
  const subs = cat ? db.categories.filter((c) => c.parentId === cat) : [];

  // Known merchants and the category each was last filed under.
  const { merchants, lastBy } = useMemo(() => {
    const lastBy = new Map<string, { categoryId?: Id; subcategoryId?: Id }>();
    const freq = new Map<string, { name: string; n: number }>();
    const sorted = db.transactions.filter((t) => t.type === 'expense' && t.merchant).sort((a, b) => b.date.localeCompare(a.date));
    for (const t of sorted) {
      const k = t.merchant!.trim().toLowerCase(); if (!k) continue;
      if (!lastBy.has(k)) lastBy.set(k, { categoryId: t.categoryId, subcategoryId: t.subcategoryId });
      const f = freq.get(k); if (f) f.n++; else freq.set(k, { name: t.merchant!.trim(), n: 1 });
    }
    return { lastBy, merchants: [...freq.values()].sort((a, b) => b.n - a.n).slice(0, 300).map((f) => f.name) };
  }, [db.transactions]);

  const onMerchant = (v: string) => {
    setMerchant(v);
    if (!catTouched) { const m = lastBy.get(v.trim().toLowerCase()); if (m?.categoryId) { setCat(m.categoryId); setSub(m.subcategoryId); } }
  };
  const onAccount = (id: Id) => {
    setAccount(id);
    if (isCard(db, id)) setMethod('credit_card');
    else if (method === 'credit_card') setMethod(defs.paymentMethod && defs.paymentMethod !== 'credit_card' ? defs.paymentMethod : 'upi');
  };

  const submit = async (another: boolean) => {
    const draft: Draft<Transaction> = {
      type: 'expense', date, amount: amount ?? 0, ownerId: owner, fromAccountId: account, paymentMethod: method,
      categoryId: cat, subcategoryId: sub, merchant: merchant.trim() || undefined, notes: notes.trim() || undefined,
      tags: splitTags(tags), oneOff: oneOff || undefined, recurring: recurring || undefined,
    };
    const t = await save(draft, 'Expense saved');
    if (!t) return;
    if (!editId && (defs.accountId !== account || defs.paymentMethod !== method || defs.ownerId !== owner)) {
      void store.updateSettings({ defaults: { ...defs, accountId: account, paymentMethod: method, ownerId: owner } });
    }
    if (another) {
      setAmount(undefined); setMerchant(''); setNotes(''); setTags(''); setOneOff(false); setRecurring(false);
      setTimeout(() => root.current?.querySelector<HTMLInputElement>('.money-in input')?.focus(), 0);
    } else onClose();
  };

  return (
    <FormShell formRef={root} onSubmit={() => submit(false)}>
      <MoneyField label="Amount" big autoFocus value={amount} onChange={setAmount} error={issues.find((i) => i.field === 'amount')?.message} />
      <div class="field">
        <span class="qa-label">Category</span>
        <Chips label="Category" value={cat} options={topCats.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(v) => { setCat(v); setSub(undefined); setCatTouched(true); }} />
        <ErrText issues={issues} field="categoryId" />
      </div>
      {subs.length > 0 && (
        <div class="field">
          <span class="qa-label">Sub-category <span class="hint">(optional)</span></span>
          <Chips label="Sub-category" allowNone value={sub} options={subs.map((c) => ({ value: c.id, label: c.name }))} onChange={setSub} />
          <ErrText issues={issues} field="subcategoryId" />
        </div>
      )}
      <div class="field">
        <span class="qa-label">Who spent</span>
        <Segmented label="Who spent" value={owner} options={ownerOptions(db)} onChange={setOwner} />
      </div>
      <SelectField label="Paid from" value={account} options={accounts} onChange={onAccount} error={issues.find((i) => i.field === 'fromAccountId')?.message} />
      <div class="field">
        <span class="qa-label">Payment method <span class="hint">(how you paid — not an account)</span></span>
        <Chips label="Payment method" value={method} options={PAYMENT_OPTIONS} onChange={setMethod} allowNone />
      </div>
      <DateField label="Date" value={date} onChange={setDate} error={issues.find((i) => i.field === 'date')?.message} />
      <TextField label="Merchant or note" value={merchant} onInput={onMerchant} list={listId} placeholder="e.g. Swiggy, local market" />
      <datalist id={listId}>{merchants.map((m) => <option key={m} value={m} />)}</datalist>
      <Disclosure summary="More (notes, tags, one-off, recurring)">
        <TextArea label="Notes" value={notes} onInput={setNotes} />
        <TextField label="Tags" value={tags} onInput={setTags} hint="Comma separated, e.g. puja, gift" />
        <Check label="One-off / unusual" checked={oneOff} onChange={setOneOff} hint="— left out of your usual-spending baseline" />
        <Check label="Recurring" checked={recurring} onChange={setRecurring} />
      </Disclosure>
      <ErrorSummary issues={issues} known={['amount', 'categoryId', 'subcategoryId', 'fromAccountId', 'date']} />
      <SaveBar busy={busy} onAnother={editId ? undefined : () => submit(true)} onDelete={remove} />
      {dialog}
    </FormShell>
  );
}
