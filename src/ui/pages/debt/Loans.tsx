import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Chips, DateField, Disclosure, EmptyState, Field, FormErrors, IntField, MoneyField, Progress, SelectField, Sheet, Stat, TextArea, TextField, fieldError, useConfirm } from '../../kit';
import { accountName, formatDate, formatMoney } from '../../format';
import { defaultOwner, ownerOptions, toast, useAction, useDb, useScope, useStore } from '../../state';
import { summarizeLiability } from '../../../domain/liabilities';
import { interestPortion, principalPortion } from '../../../domain/ledger';
import { inScope } from '../../../domain/scope';
import type { Liability, LiabilityType, OwnerId } from '../../../domain/types';
import { Note, OwnerBadge } from '../wealth/shared';
import './debt.css';

export const LOAN_TYPE_LABELS: Record<LiabilityType, string> = { education: 'Education', appliance: 'Appliance / gadget', personal: 'Personal', home: 'Home', vehicle: 'Vehicle', other: 'Other' };
const TYPE_OPTIONS = (Object.keys(LOAN_TYPE_LABELS) as LiabilityType[]).map((k) => ({ value: k, label: LOAN_TYPE_LABELS[k] }));

export default function LoansTab() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today();
  const [form, setForm] = useState<null | { id?: string }>(null);
  const [pay, setPay] = useState<string | null>(null);
  const list = db.liabilities.filter((l) => inScope(l.ownerId, scope)).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1));
  return (
    <div class="wl-list">
      <div class="wl-tabhint">
        <Note>Loans you owe: education, appliance, personal, home or vehicle. Zero-interest loans are fine.</Note>
        <Button variant="primary" onClick={() => setForm({})}>Add loan</Button>
      </div>
      {list.length === 0 && <Card><EmptyState title="No loans tracked" body="If you owe money on a loan or no-cost financing, add it to see what’s left and when you’d be clear at the current payment." action={<Button variant="primary" onClick={() => setForm({})}>Add a loan</Button>} /></Card>}
      {list.map((l) => <LoanCard key={l.id} l={l} today={today} onEdit={() => setForm({ id: l.id })} onPay={() => setPay(l.id)} />)}
      {form && <LoanForm id={form.id} onClose={() => setForm(null)} />}
      {pay && <PaymentSheet id={pay} onClose={() => setPay(null)} />}
    </div>
  );
}

function LoanCard({ l, today, onEdit, onPay }: { l: Liability; today: string; onEdit: () => void; onPay: () => void }) {
  const db = useDb(); const store = useStore(); const { run } = useAction(); const [ask, dialog] = useConfirm();
  const [err, setErr] = useState('');
  const s = summarizeLiability(db, l, today);
  const txns = db.transactions.filter((t) => t.liabilityId === l.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const closed = l.status === 'closed';
  return (
    <Card>
      <div class="wl-item">
        <div class="wl-item-head">
          <div>
            <h3>{l.name}</h3>
            <div class="wl-badges"><Badge>{LOAN_TYPE_LABELS[l.type]}</Badge><OwnerBadge db={db} owner={l.ownerId} />{l.interestRate === 0 ? <Badge tone="good">Zero interest</Badge> : <Badge tone="muted">{l.interestRate}% p.a.</Badge>}{closed && <Badge tone="warn">Closed</Badge>}{s.completed && !closed && <Badge tone="good">Paid off</Badge>}</div>
          </div>
          <div><div class="wl-amt">{formatMoney(closed ? 0 : s.outstanding)}</div><div class="row-sub" style={{ textAlign: 'right' }}>outstanding</div></div>
        </div>
        {l.originalPrincipal > 0 && (
          <div class="db-util">
            <div class="db-util-head"><span>{Math.round(s.paidPct)}% paid of {formatMoney(l.originalPrincipal)}</span></div>
            <Progress pct={s.paidPct} tone="good" label={`${l.name} paid`} />
          </div>
        )}
        {s.completed && !closed ? <Banner tone="good">This loan is fully paid off. You can close it to tidy up your list.</Banner> : (
          <div class="wl-metrics">
            <Stat label="EMI" value={l.emi > 0 ? formatMoney(l.emi) : '—'} sub={l.emi > 0 ? (l.paymentDay ? `due on the ${l.paymentDay}` : 'monthly') : 'none set'} />
            <Stat label="Months left" value={s.monthsLeft === null ? '—' : String(s.monthsLeft)} sub={s.monthsLeft === null ? (l.emi > 0 ? 'EMI doesn’t cover interest' : 'depends on EMI') : 'at current EMI'} />
            <Stat label="Projected payoff" value={s.projectedEnd ? formatDate(s.projectedEnd) : '—'} sub={s.projectedEnd ? 'estimate' : undefined} />
            {l.endDate && <Stat label="Lender end date" value={formatDate(l.endDate)} />}
          </div>
        )}
        {err && <div class="banner banner-error" role="alert">{err}</div>}
        <div class="wl-actions">
          {!closed && <Button size="sm" variant="primary" onClick={onPay}>Record payment</Button>}
          <Button size="sm" onClick={onEdit}>Edit</Button>
          <Button size="sm" onClick={() => run(() => store.saveLiability({ ...(l as Liability), status: closed ? 'active' : 'closed' }, l.id), closed ? 'Loan reopened' : 'Loan closed')}>{closed ? 'Reopen' : 'Close'}</Button>
          <Button size="sm" variant="danger" onClick={async () => {
            if (!(await ask({ title: `Delete ${l.name}?`, body: 'This can’t be undone. If payments are recorded against it, close it instead — that keeps your history.', confirmLabel: 'Delete', danger: true }))) return;
            const r = await store.deleteLiability(l.id);
            if (!r.ok) setErr(r.issues.map((i) => i.message).join(' · ')); else toast('Loan deleted');
          }}>Delete</Button>
        </div>
        {txns.length > 0 && (
          <Disclosure summary={`Payment history (${txns.length})`}>
            {txns.map((t) => (
              <div class="row" key={t.id}>
                <div class="row-main">
                  <div class="row-title">{t.type === 'liability_payment' ? 'Payment' : 'Loan taken / added'} · {formatDate(t.date)}</div>
                  <div class="row-sub">{t.type === 'liability_payment' ? `from ${accountName(db, t.fromAccountId)} · principal ${formatMoney(principalPortion(t))}${interestPortion(t) > 0 ? ` · interest ${formatMoney(interestPortion(t))}` : ''}` : 'Adds to the outstanding'}</div>
                </div>
                <div class="row-right"><div class="row-amt">{formatMoney(t.amount)}</div></div>
                <Button size="sm" variant="ghost" aria-label={`Delete entry from ${formatDate(t.date)}`} onClick={async () => { if (await ask({ title: 'Delete this entry?', body: 'The account balance and loan outstanding are recalculated.', confirmLabel: 'Delete', danger: true })) await run(() => store.deleteTransaction(t.id), 'Entry deleted'); }}>✕</Button>
              </div>
            ))}
          </Disclosure>
        )}
        {l.notes && <Note>{l.notes}</Note>}
      </div>
      {dialog}
    </Card>
  );
}

function PaymentSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDb(); const store = useStore();
  const l = db.liabilities.find((x) => x.id === id)!;
  const accounts = db.accounts.filter((a) => a.kind !== 'credit_card' && !a.archived);
  const [date, setDate] = useState(store.today());
  const [amount, setAmount] = useState<number | undefined>(l.emi > 0 ? l.emi : undefined);
  const [account, setAccount] = useState(db.settings.defaults.accountId && accounts.some((a) => a.id === db.settings.defaults.accountId) ? db.settings.defaults.accountId! : accounts.find((a) => inScope(a.ownerId, l.ownerId === 'hh' ? 'household' : l.ownerId))?.id ?? accounts[0]?.id ?? '');
  const [split, setSplit] = useState<'all' | 'split'>(l.interestRate > 0 ? 'split' : 'all');
  const [principal, setPrincipal] = useState<number | undefined>();
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const save = async () => {
    if (amount === undefined || amount <= 0) { setIssues([{ field: 'amount', message: 'Enter the amount paid' }]); return; }
    if (split === 'split' && principal === undefined) { setIssues([{ field: 'principalPortion', message: 'Enter the principal part (the rest is counted as interest)' }]); return; }
    const r = await store.addTransaction({ type: 'liability_payment', date, amount, ownerId: l.ownerId, fromAccountId: account, liabilityId: id, principalPortion: split === 'split' ? principal : undefined, notes: `Payment: ${l.name}` });
    if (!r.ok) { setIssues(r.issues); return; }
    toast('Payment recorded'); onClose();
  };
  return (
    <Sheet title={`Record payment — ${l.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <MoneyField label="Amount paid" value={amount} onChange={setAmount} error={fieldError(issues, 'amount')} autoFocus />
        <DateField label="Date" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
        <SelectField label="Paid from" value={account} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={fieldError(issues, 'fromAccountId')} />
        <div>
          <div class="hint">How much of it reduces the loan?</div>
          <Chips label="Principal or interest" value={split} options={[{ value: 'all', label: 'All principal (no interest)' }, { value: 'split', label: 'Principal + interest' }]} onChange={(v) => v && setSplit(v)} />
        </div>
        {split === 'split' && <MoneyField label="Principal part" value={principal} onChange={setPrincipal} error={fieldError(issues, 'principalPortion')} hint={amount !== undefined && principal !== undefined && principal <= amount ? `Interest: ${formatMoney(amount - principal)}` : 'The rest of the payment counts as interest'} />}
        {date <= l.baselineDate && <Banner tone="warn">This date is on or before the loan’s starting-balance date ({formatDate(l.baselineDate)}), so it won’t change the outstanding shown.</Banner>}
        <Note>Only the interest part counts as spending. The principal part pays down debt — it isn’t an expense.</Note>
      </div>
    </Sheet>
  );
}

function LoanForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const l = id ? db.liabilities.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(l?.name ?? '');
  const [type, setType] = useState<LiabilityType>(l?.type ?? 'personal');
  const [owner, setOwner] = useState<OwnerId>(l?.ownerId ?? defaultOwner(db, scope));
  const [principal, setPrincipal] = useState<number | undefined>(l?.originalPrincipal);
  const [outstanding, setOutstanding] = useState<number | undefined>(l?.baselineOutstanding);
  const [baseDate, setBaseDate] = useState(l?.baselineDate ?? store.today());
  const [emi, setEmi] = useState<number | undefined>(l?.emi);
  const [rate, setRate] = useState(l ? String(l.interestRate) : '0');
  const [start, setStart] = useState(l?.startDate ?? store.today());
  const [end, setEnd] = useState(l?.endDate ?? '');
  const [day, setDay] = useState<number | undefined>(l?.paymentDay);
  const [notes, setNotes] = useState(l?.notes ?? '');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const hasTxns = !!l && db.transactions.some((t) => t.liabilityId === l.id);

  const save = async () => {
    const r8 = Number(rate);
    if (rate.trim() === '' || !Number.isFinite(r8)) { setIssues([{ field: 'interestRate', message: 'Enter the interest rate (0 if none)' }]); return; }
    if (principal === undefined) { setIssues([{ field: 'originalPrincipal', message: 'Enter the original loan amount' }]); return; }
    const draft = {
      name: name.trim(), type, ownerId: owner, originalPrincipal: principal, baselineOutstanding: outstanding ?? principal, baselineDate: baseDate, emi: emi ?? 0, interestRate: r8,
      startDate: start, endDate: end || undefined, paymentDay: day, status: l?.status ?? ('active' as const), notes: notes.trim() || undefined,
    };
    const r = await store.saveLiability(draft, id);
    if (!r.ok) { setIssues(r.issues); return; }
    toast(l ? 'Loan saved' : 'Loan added'); onClose();
  };
  return (
    <Sheet title={l ? `Edit ${l.name}` : 'Add loan'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <TextField label="Name" value={name} onInput={setName} error={fieldError(issues, 'name')} placeholder="e.g. Laptop loan" autoFocus />
        <SelectField label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
        <SelectField label="Owner" value={owner} onChange={(v) => setOwner(v as OwnerId)} options={ownerOptions(db)} />
        <div class="wl-two">
          <MoneyField label="Original amount" value={principal} onChange={setPrincipal} error={fieldError(issues, 'originalPrincipal')} />
          <MoneyField label="Outstanding now" value={outstanding} onChange={setOutstanding} hint="Blank = same as original" />
        </div>
        <DateField label="Outstanding as of" value={baseDate} onChange={setBaseDate} error={fieldError(issues, 'startDate')} />
        {hasTxns && <Note>Payments dated after this date reduce the outstanding. Changing it can change what’s shown.</Note>}
        <div class="wl-two">
          <MoneyField label="EMI per month" value={emi} onChange={setEmi} hint="0 or blank if none" />
          <Field label="Interest rate (% a year)" error={fieldError(issues, 'interestRate')} hint="0 for zero-interest">{(a) => <input {...a} type="number" inputMode="decimal" min={0} max={100} step="0.01" value={rate} onInput={(e) => setRate((e.target as HTMLInputElement).value)} />}</Field>
        </div>
        <div class="wl-two">
          <DateField label="Start date" value={start} onChange={setStart} />
          <DateField label="End date (optional)" value={end} onChange={setEnd} />
        </div>
        <IntField label="Payment day (optional)" value={day} onChange={setDay} min={1} max={31} />
        <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
      </div>
    </Sheet>
  );
}
