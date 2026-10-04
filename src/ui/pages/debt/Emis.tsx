import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Chips, DateField, Disclosure, EmptyState, FormErrors, IntField, MoneyField, Progress, SelectField, Segmented, Sheet, Stat, TextArea, TextField, fieldError, useConfirm } from '../../kit';
import { accountName, formatDate, formatMoney } from '../../format';
import { defaultOwner, ownerOptions, toast, useAction, useDb, useScope, useStore } from '../../state';
import { emiState } from '../../../domain/emi';
import { inScope } from '../../../domain/scope';
import type { BlockPolicy, Emi, OwnerId } from '../../../domain/types';
import { Note, OwnerBadge } from '../wealth/shared';
import { navigate } from '../../router';
import './debt.css';

const POLICY_OPTIONS: { value: BlockPolicy; label: string }[] = [
  { value: 'as_paid', label: 'Credit frees up as I pay' }, { value: 'on_completion', label: 'Held until the EMI ends' },
];

export default function EmisTab() {
  const db = useDb(); const [scope] = useScope();
  const [form, setForm] = useState<null | { id?: string }>(null);
  const [pay, setPay] = useState<string | null>(null);
  const cards = db.accounts.filter((a) => a.kind === 'credit_card' && !a.archived);
  const emis = db.emis.filter((e) => inScope(e.ownerId, scope)).map((e) => ({ e, s: emiState(e) }));
  const active = emis.filter((x) => x.s.active);
  const done = emis.filter((x) => !x.s.active);

  return (
    <div class="wl-list">
      <div class="wl-tabhint">
        <Note>Credit-card EMIs: track what’s left and how much credit is held back.</Note>
        <Button variant="primary" onClick={() => setForm({})} disabled={!cards.length}>Add EMI</Button>
      </div>
      <Disclosure summary="Reduced available credit is not an expense">
        <p>When an EMI holds part of your credit limit, your <b>available credit</b> drops — but that isn’t spending. The purchase counts as an expense once (when you record it), and paying the card bill is a transfer from your bank to the card.</p>
        <p>Marking an instalment paid here only updates the EMI’s progress. It never creates an expense or touches your bank balance.</p>
      </Disclosure>

      {!cards.length && <Card><EmptyState title="Add a credit card first" body="EMIs live on a credit card. Add the card as an account, then come back." action={<Button variant="primary" onClick={() => navigate('/wealth?tab=accounts')}>Go to accounts</Button>} /></Card>}
      {!!cards.length && emis.length === 0 && <Card><EmptyState title="No EMIs tracked" body="Add a new EMI, or an existing one that is already running — you can enter how many instalments are done." action={<Button variant="primary" onClick={() => setForm({})}>Add EMI</Button>} /></Card>}

      {active.map(({ e, s }) => <EmiCard key={e.id} e={e} s={s} onEdit={() => setForm({ id: e.id })} onPay={() => setPay(e.id)} />)}
      {done.length > 0 && <h2 class="db-sub">Finished</h2>}
      {done.map(({ e, s }) => <EmiCard key={e.id} e={e} s={s} onEdit={() => setForm({ id: e.id })} onPay={() => setPay(e.id)} />)}
      {form && <EmiForm id={form.id} onClose={() => setForm(null)} />}
      {pay && <PaySheet id={pay} onClose={() => setPay(null)} />}
    </div>
  );
}

function EmiCard({ e, s, onEdit, onPay }: { e: Emi; s: ReturnType<typeof emiState>; onEdit: () => void; onPay: () => void }) {
  const db = useDb(); const store = useStore(); const { run } = useAction(); const [ask, dialog] = useConfirm();
  const stopped = e.status === 'stopped';
  const pct = e.tenure > 0 ? (s.monthsCompleted / e.tenure) * 100 : 0;
  const estimatedEntry = e.monthsCompletedAtEntry > 0;
  return (
    <Card>
      <div class="wl-item">
        <div class="wl-item-head">
          <div>
            <h3>{e.name}</h3>
            <div class="wl-badges">
              <Badge>{accountName(db, e.cardAccountId)}</Badge><OwnerBadge db={db} owner={e.ownerId} />
              {s.completed && <Badge tone="good">Complete</Badge>}{stopped && <Badge tone="warn">Stopped</Badge>}
              {s.active && <Badge tone="muted">{e.blockPolicy === 'as_paid' ? 'Credit frees as paid' : 'Held until end'}</Badge>}
            </div>
          </div>
          <div><div class="wl-amt">{formatMoney(e.emiAmount)}</div><div class="row-sub" style={{ textAlign: 'right' }}>per month</div></div>
        </div>

        {s.completed && <Banner tone="good">EMI complete 🎉 The monthly commitment and any blocked credit for this EMI are now removed.</Banner>}
        {stopped && <Note>Stopped EMIs no longer count as a commitment or hold credit. You can resume it if that was a mistake.</Note>}

        <div class="db-util">
          <div class="db-util-head"><span>{s.monthsCompleted} of {e.tenure} instalments</span><b>{s.monthsRemaining} left</b></div>
          <Progress pct={pct} tone={s.completed ? 'good' : undefined} label={`${e.name} progress`} />
        </div>

        {s.active && (
          <div class="wl-metrics">
            <Stat label="Outstanding" value={formatMoney(s.outstanding)} sub={estimatedEntry && e.payments.length === 0 ? 'as entered / estimate' : undefined} />
            <Stat label="Next instalment" value={s.nextDueDate ? formatDate(s.nextDueDate) : '—'} />
            <Stat label={e.blockedOverride !== undefined ? 'Blocked (manual)' : 'Blocked credit'} value={formatMoney(s.blocked)} sub={e.blockedOverride !== undefined ? 'your figure' : 'estimate'} hint="How much credit is held back varies by issuer." />
            {s.totalInterestCost > 0 && <Stat label="Interest / fees" value={formatMoney(s.totalInterestCost)} sub="estimate over the life" />}
          </div>
        )}
        {!s.active && s.totalInterestCost > 0 && <Note>Total cost above the original amount: about {formatMoney(s.totalInterestCost)} (estimate).</Note>}

        <div class="wl-actions">
          {s.active && <Button variant="primary" size="sm" onClick={onPay}>Mark instalment paid</Button>}
          {e.payments.length > 0 && <Button size="sm" onClick={async () => {
            if (await ask({ title: 'Undo last instalment?', body: 'The most recent confirmed instalment will be removed. Nothing else changes.', confirmLabel: 'Undo' })) await run(() => store.undoEmiInstalment(e.id), 'Last instalment undone');
          }}>Undo last</Button>}
          <Button size="sm" onClick={onEdit}>Edit</Button>
          {s.active && <Button size="sm" onClick={async () => {
            if (await ask({ title: `Stop ${e.name}?`, body: 'It will stop counting as a commitment and stop holding credit (for example after foreclosure). History is kept.', confirmLabel: 'Stop EMI' })) await run(() => store.updateEmi(e.id, { status: 'stopped' }), 'EMI stopped');
          }}>Stop</Button>}
          {stopped && <Button size="sm" onClick={() => run(() => store.updateEmi(e.id, { status: 'active' }), 'EMI resumed')}>Resume</Button>}
          <Button size="sm" variant="danger" onClick={async () => {
            if (await ask({ title: `Delete ${e.name}?`, body: 'This removes the EMI and its instalment history. Your transactions are not touched.', confirmLabel: 'Delete', danger: true })) await run(() => store.deleteEmi(e.id), 'EMI deleted');
          }}>Delete</Button>
        </div>
      </div>
      {dialog}
    </Card>
  );
}

function PaySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDb(); const store = useStore();
  const e = db.emis.find((x) => x.id === id)!;
  const s = emiState(e);
  const [date, setDate] = useState(store.today());
  const [amount, setAmount] = useState<number | undefined>(e.emiAmount);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  if (!s.nextDueDate) return null;
  const save = async () => {
    const r = await store.confirmEmiInstalment(id, { dueDate: s.nextDueDate!, date, amount });
    if (!r.ok) { setIssues(r.issues); return; }
    if (emiState(r.value).completed) toast('EMI complete 🎉 Commitment and blocked credit removed');
    else toast('Instalment marked paid');
    onClose();
  };
  return (
    <Sheet title={`Mark instalment paid — ${e.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Mark paid</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <p>Instalment due <b>{formatDate(s.nextDueDate)}</b> ({s.monthsCompleted + 1} of {e.tenure}).</p>
        <DateField label="Paid / billed on" value={date} onChange={setDate} />
        <MoneyField label="Amount" value={amount} onChange={setAmount} hint="Change only if this month’s amount differed." />
        <Banner tone="info">This does <b>not</b> create an expense. The purchase was already recorded as an expense (if at all), and paying your card bill is a Transfer from your bank to the card.</Banner>
      </div>
    </Sheet>
  );
}

function EmiForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const existing = id ? db.emis.find((e) => e.id === id) : undefined;
  const cards = db.accounts.filter((a) => a.kind === 'credit_card' && (!a.archived || a.id === existing?.cardAccountId));
  const [mode, setMode] = useState<'new' | 'existing'>(existing && existing.monthsCompletedAtEntry > 0 ? 'existing' : 'new');
  const [name, setName] = useState(existing?.name ?? '');
  const [card, setCard] = useState(existing?.cardAccountId ?? (cards.find((c) => inScope(c.ownerId, scope))?.id ?? cards[0]?.id ?? ''));
  const [owner, setOwner] = useState<OwnerId>(existing?.ownerId ?? defaultOwner(db, scope));
  const [orig, setOrig] = useState<number | undefined>(existing?.originalAmount);
  const [emiAmt, setEmiAmt] = useState<number | undefined>(existing?.emiAmount);
  const [tenure, setTenure] = useState<number | undefined>(existing?.tenure);
  const [start, setStart] = useState(existing?.startDate ?? store.today());
  const [day, setDay] = useState<number | undefined>(existing?.paymentDay);
  const [done, setDone] = useState<number | undefined>(existing ? existing.monthsCompletedAtEntry : undefined);
  const [outstanding, setOutstanding] = useState<number | undefined>(existing && existing.monthsCompletedAtEntry > 0 ? existing.outstandingAtEntry : undefined);
  const [policy, setPolicy] = useState<BlockPolicy>(existing?.blockPolicy ?? 'as_paid');
  const [override, setOverride] = useState<number | undefined>(existing?.blockedOverride);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);

  const save = async () => {
    if (!card) { setIssues([{ field: 'cardAccountId', message: 'Choose the card' }]); return; }
    if (tenure === undefined || orig === undefined || emiAmt === undefined) {
      setIssues([...(orig === undefined ? [{ field: 'originalAmount', message: 'Enter the original amount' }] : []), ...(emiAmt === undefined ? [{ field: 'emiAmount', message: 'Enter the monthly EMI' }] : []), ...(tenure === undefined ? [{ field: 'tenure', message: 'Enter the tenure in months' }] : [])]);
      return;
    }
    const monthsDone = mode === 'existing' ? done ?? 0 : 0;
    if (existing) {
      const r = await store.updateEmi(existing.id, {
        name: name.trim(), cardAccountId: card, ownerId: owner, originalAmount: orig, emiAmount: emiAmt, tenure, startDate: start, paymentDay: day,
        blockPolicy: policy, blockedOverride: override, notes: notes.trim() || undefined,
        monthsCompletedAtEntry: monthsDone, outstandingAtEntry: mode === 'existing' && outstanding !== undefined ? outstanding : monthsDone === 0 ? orig : existing.outstandingAtEntry,
      });
      if (!r.ok) { setIssues(r.issues); return; }
      toast('EMI saved'); onClose(); return;
    }
    const r = await store.addEmi({ name: name.trim(), cardAccountId: card, ownerId: owner, originalAmount: orig, emiAmount: emiAmt, tenure, startDate: start, paymentDay: day, blockPolicy: policy, notes: notes.trim() || undefined, monthsCompleted: monthsDone, outstanding: mode === 'existing' ? outstanding : undefined });
    if (!r.ok) { setIssues(r.issues); return; }
    if (override !== undefined) await store.updateEmi(r.value.emi.id, { blockedOverride: override });
    toast(r.value.outstandingEstimated ? 'EMI added — outstanding is an estimate; update it when you know the exact figure' : 'EMI added');
    onClose();
  };

  return (
    <Sheet title={existing ? `Edit ${existing.name}` : 'Add EMI'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <Segmented label="EMI type" value={mode} onChange={setMode} options={[{ value: 'new', label: 'New EMI' }, { value: 'existing', label: 'Existing (already running)' }]} />
        <TextField label="What is it for?" value={name} onInput={setName} error={fieldError(issues, 'name')} placeholder="e.g. Phone EMI" autoFocus />
        <SelectField label="Card" value={card} onChange={setCard} options={cards.map((c) => ({ value: c.id, label: c.name }))} error={fieldError(issues, 'cardAccountId')} />
        <SelectField label="Owner" value={owner} onChange={(v) => setOwner(v as OwnerId)} options={ownerOptions(db)} />
        <div class="wl-two">
          <MoneyField label="Original amount" value={orig} onChange={setOrig} error={fieldError(issues, 'originalAmount')} />
          <MoneyField label="EMI per month" value={emiAmt} onChange={setEmiAmt} error={fieldError(issues, 'emiAmount')} />
          <IntField label="Tenure (months)" value={tenure} onChange={setTenure} min={1} max={360} error={fieldError(issues, 'tenure')} />
          <IntField label="Payment day (optional)" value={day} onChange={setDay} min={1} max={31} />
        </div>
        <DateField label={mode === 'existing' ? 'First instalment date (past is fine)' : 'Start date'} value={start} onChange={setStart} error={fieldError(issues, 'startDate')} />
        {mode === 'existing' && (
          <div class="wl-two">
            <IntField label="Instalments already paid" value={done} onChange={setDone} min={0} max={360} error={fieldError(issues, 'monthsCompleted')} />
            <MoneyField label="Outstanding now (if known)" value={outstanding} onChange={setOutstanding} error={fieldError(issues, 'outstanding')} />
          </div>
        )}
        {mode === 'existing' && outstanding === undefined && (done ?? 0) > 0 && <Banner tone="info">If you leave the outstanding blank, it will be estimated pro-rata from the original amount and tenure, and labelled as an <b>estimate</b>.</Banner>}

        <div>
          <div class="hint">When does this EMI hold your credit?</div>
          <Chips label="Credit blocking behaviour" value={policy} options={POLICY_OPTIONS} onChange={(v) => v && setPolicy(v)} />
          <p class="hint">Issuers differ: some free up credit with each payment, others keep the whole amount held until the EMI ends. Pick what your bank does — or enter its exact figure below.</p>
        </div>
        <MoneyField label="Blocked amount override (optional)" value={override} onChange={setOverride} hint="If your bank shows the exact blocked amount, enter it. It replaces the estimate." />
        <TextArea label="Note (optional)" value={notes} onInput={setNotes} />
      </div>
    </Sheet>
  );
}
