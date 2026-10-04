import { useState } from 'preact/hooks';
import { Badge, Button, Card, DateField, EmptyState, FormErrors, MoneyField, SelectField, Sheet, Stat, TextField, fieldError, useConfirm } from '../../kit';
import { toast, useAction, useDb, useScope, useStore, personName } from '../../state';
import { accountName, formatDate, formatMoney } from '../../format';
import { addDays, diffDays, type ISODate } from '../../../domain/dates';
import { draftFromOccurrence, expectedOccurrences, upcomingCommitments, type Occurrence } from '../../../domain/expected';
import { inScope } from '../../../domain/scope';
import type { ExpectedItem } from '../../../domain/types';
import { ExpectedFormSheet, FREQ_LABEL, KIND_LABEL } from './ExpectedForm';
import './plan.css';

const ICON: Record<ExpectedItem['kind'], string> = { subscription: '↻', sip: '📈', salary: '💼', bill: '🧾', other: '•' };
const when = (d: ISODate, today: ISODate) => { const n = diffDays(d, today); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n < 0 ? `${-n} days ago` : `In ${n} days`; };

export default function Upcoming() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today();
  const [confirming, setConfirming] = useState<Occurrence | null>(null);
  const [editing, setEditing] = useState<ExpectedItem | 'new' | null>(null);
  const [ask, dialog] = useConfirm(); const { run } = useAction();

  const occ = expectedOccurrences(db, scope, addDays(today, -60), addDays(today, 45), today).filter((o) => o.state === 'pending');
  const overdue = occ.filter((o) => o.overdue);
  const soon = occ.filter((o) => !o.overdue && o.date <= addDays(today, 7));
  const later = occ.filter((o) => !o.overdue && o.date > addDays(today, 7));
  const commits = upcomingCommitments(db, scope, today, addDays(today, 45), today).filter((c) => c.kind !== 'expected');
  const out30 = upcomingCommitments(db, scope, today, addDays(today, 30), today).reduce((s, c) => s + c.amount, 0);
  const items = db.expectedItems.filter((i) => inScope(i.ownerId, scope)).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.name.localeCompare(b.name));

  const occRow = (o: Occurrence) => (
    <div class="px-item" key={`${o.item.id}-${o.date}`}>
      <div class="px-head-row">
        <div>
          <div class="row-title">{ICON[o.item.kind]} {o.item.name}</div>
          <div class="px-badges"><Badge tone={o.item.kind === 'salary' ? 'good' : 'info'}>Expected {KIND_LABEL[o.item.kind].toLowerCase()}</Badge>{o.overdue && <Badge tone="warn">Waiting for you</Badge>}</div>
          <div class="px-sub">{formatDate(o.date)} · {when(o.date, today)} · {personName(db, o.item.ownerId)}{o.item.accountId ? ` · ${accountName(db, o.item.accountId)}` : ''}</div>
        </div>
        <div class={`px-item-amt ${o.item.kind === 'salary' ? 'pos' : ''}`}>{o.item.kind === 'salary' ? '+' : ''}{formatMoney(o.item.amount)}</div>
      </div>
      <div class="px-actions">
        <Button size="sm" variant="primary" onClick={() => setConfirming(o)}>{o.item.kind === 'salary' ? 'It arrived' : 'Confirm'}</Button>
        <Button size="sm" variant="ghost" onClick={() => run(() => store.skipOccurrence(o.item.id, o.date), 'Skipped this time')}>Skip</Button>
      </div>
    </div>
  );

  const stop = async (i: ExpectedItem) => { if (i.status === 'stopped') { await run(() => store.stopExpected(i.id, true), 'Resumed'); return; }
    if (await ask({ title: `Stop ${i.name}?`, confirmLabel: 'Stop', body: <p>No more reminders will appear from today. Past records stay as they are, and you can resume later.</p> })) await run(() => store.stopExpected(i.id), 'Stopped'); };
  const del = async (i: ExpectedItem) => { if (await ask({ title: `Delete ${i.name}?`, danger: true, confirmLabel: 'Delete', body: <p>Removes this reminder. Transactions you already confirmed are kept.</p> })) await run(() => store.deleteExpected(i.id), 'Deleted'); };

  return (<>
    <div class="px-explain" role="note">
      <strong>These are expected, not recorded.</strong>
      Nothing here changes your balances or spending until you tap Confirm. Skipped items simply disappear for that date.
    </div>
    <Card title="Next 30 days" action={<Button variant="primary" size="sm" onClick={() => setEditing('new')}>+ Add</Button>}>
      <div class="px-stats">
        <Stat label="Expected outflow" value={formatMoney(out30)} sub="bills, subscriptions, SIPs, EMIs & loans" />
        <Stat label="Waiting for you" value={String(overdue.length)} sub={overdue.length ? 'past their date, not yet confirmed' : 'all caught up'} tone={overdue.length ? 'warn' : 'good'} />
      </div>
    </Card>

    {!occ.length && !commits.length && <Card><EmptyState title="Nothing coming up" body="Add your salary, SIPs, bills and subscriptions as recurring items and they will show up here as gentle reminders." action={<Button variant="primary" onClick={() => setEditing('new')}>Add a recurring item</Button>} /></Card>}

    {overdue.length > 0 && <Card title="Waiting for you"><p class="px-sub" style={{ margin: 0 }}>These dates have passed. Confirm if it happened, skip if it didn’t.</p>{overdue.map(occRow)}</Card>}
    {soon.length > 0 && <Card title="This week">{soon.map(occRow)}</Card>}
    {later.length > 0 && <Card title="Later (next 45 days)">{later.map(occRow)}</Card>}

    {commits.length > 0 && (
      <Card title="EMIs & loan payments" action={<a href="#/debt" class="px-sub">Open Cards, EMIs & loans →</a>}>
        <p class="px-sub" style={{ margin: 0 }}>Read-only. Manage these under Cards, EMIs & loans — they are never recorded as expenses.</p>
        {commits.map((c) => (
          <a class="row row-click" href="#/debt" key={`${c.kind}-${c.refId}-${c.date}`}>
            <div class="row-lead" aria-hidden="true">{c.kind === 'emi' ? '💳' : '🏦'}</div>
            <div class="row-main"><div class="row-title">{c.name}</div><div class="row-sub">{c.kind === 'emi' ? 'Card EMI instalment' : 'Loan EMI'} · {formatDate(c.date)}{c.overdue ? ' · date passed' : ''}</div></div>
            <div class="row-right"><div class="row-amt">{formatMoney(c.amount)}</div></div>
          </a>
        ))}
      </Card>
    )}

    <Card title="All recurring items">
      {!items.length ? <p class="muted">No recurring items yet.</p> : items.map((i) => (
        <div class="px-item" key={i.id}>
          <div class="px-head-row">
            <div>
              <div class="row-title">{ICON[i.kind]} {i.name}</div>
              <div class="px-badges"><Badge tone="info">{KIND_LABEL[i.kind]}</Badge><Badge>{FREQ_LABEL[i.frequency]}</Badge>{i.status === 'stopped' && <Badge tone="muted">Stopped</Badge>}</div>
              <div class="px-sub">{personName(db, i.ownerId)}{i.accountId ? ` · ${accountName(db, i.accountId)}` : ''}</div>
            </div>
            <div class="px-item-amt">{formatMoney(i.amount)}</div>
          </div>
          <div class="px-actions">
            <Button size="sm" onClick={() => setEditing(i)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => stop(i)}>{i.status === 'stopped' ? 'Resume' : 'Stop'}</Button>
            <Button size="sm" variant="ghost" onClick={() => del(i)}>Delete</Button>
          </div>
        </div>
      ))}
    </Card>
    {confirming && <ConfirmSheet occ={confirming} onClose={() => setConfirming(null)} />}
    {editing && <ExpectedFormSheet item={editing === 'new' ? undefined : editing} defaultKind="bill" onClose={() => setEditing(null)} />}
    {dialog}
  </>);
}

function ConfirmSheet({ occ, onClose }: { occ: Occurrence; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const { busy } = useAction();
  const draft = draftFromOccurrence(occ.item, occ.date);
  const income = draft.type === 'income';
  const [amount, setAmount] = useState<number | undefined>(draft.amount);
  const [date, setDate] = useState(occ.overdue ? occ.date : occ.date);
  const [acct, setAcct] = useState((income ? draft.toAccountId : draft.fromAccountId) ?? '');
  const [notes, setNotes] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const accounts = db.accounts.filter((a) => !a.archived || a.id === acct).map((a) => ({ value: a.id, label: a.name }));
  const verb = income ? 'received' : draft.type === 'investment_contribution' ? 'invested' : 'paid';
  const save = async () => {
    if (!amount || amount <= 0) { setIssues([{ field: 'amount', message: 'Enter an amount' }]); return; }
    const r = await store.confirmOccurrence(occ.item.id, occ.date, { amount, date, notes: notes.trim() || undefined, ...(income ? { toAccountId: acct || undefined } : { fromAccountId: acct || undefined }) });
    if (r.ok) { toast('Recorded'); onClose(); } else setIssues(r.issues.map((i) => ({ ...i, field: i.field === 'fromAccountId' || i.field === 'toAccountId' ? 'account' : i.field })));
  };
  return (
    <Sheet title={`Confirm ${occ.item.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button variant="primary" disabled={busy} onClick={save}>Yes, {verb}</Button></>}>
      <div class="px-form">
        <div class="px-explain">Nothing is recorded until you confirm. This will create a real {income ? 'income' : draft.type === 'investment_contribution' ? 'investment' : 'expense'} entry — change anything that was different this time.</div>
        <FormErrors issues={issues} />
        <MoneyField label="Actual amount" value={amount} onChange={setAmount} error={fieldError(issues, 'amount')} autoFocus big />
        <DateField label={income ? 'Date received' : 'Date paid'} value={date} onChange={setDate} error={fieldError(issues, 'date')} />
        <SelectField label={income ? 'Received in' : 'Paid from'} value={acct || undefined} onChange={setAcct} options={accounts} placeholder="Choose account" error={fieldError(issues, 'account')} />
        <TextField label="Note (optional)" value={notes} onInput={setNotes} />
      </div>
    </Sheet>
  );
}
