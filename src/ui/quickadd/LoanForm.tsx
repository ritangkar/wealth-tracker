import { useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import { emiState } from '../../domain/emi';
import { inScope } from '../../domain/scope';
import { liabilityOutstanding } from '../../domain/liabilities';
import type { Id, Transaction } from '../../domain/types';
import { Button, Card, Check, DateField, MoneyField, Row, SelectField, TextArea } from '../kit';
import { formatDate, formatMoney } from '../format';
import { toast, useDb, useStore } from '../state';
import { ErrorSummary, FormShell, Note, SaveBar, accountOptions, nonCard, useTxnSave, type FormProps } from './shared';

export default function LoanForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.transactions.find((t) => t.id === editId) : undefined;
  const defs = db.settings.defaults;
  const loans = db.liabilities.filter((l) => l.status === 'active' || l.id === old?.liabilityId);
  const accounts = accountOptions(db, nonCard, old?.fromAccountId);
  const validDefault = defs.accountId && accounts.some((a) => a.value === defs.accountId) ? defs.accountId : accounts[0]?.value;

  const [loan, setLoan] = useState<Id | undefined>(old?.liabilityId ?? (loans.length === 1 ? loans[0].id : undefined));
  const [amount, setAmount] = useState<number | undefined>(old?.amount);
  const hadInterest = !!old && old.principalPortion !== undefined && old.principalPortion < old.amount;
  const [hasInterest, setHasInterest] = useState(hadInterest);
  const [principal, setPrincipal] = useState<number | undefined>(hadInterest ? old?.principalPortion : undefined);
  const [account, setAccount] = useState<Id | undefined>(old?.fromAccountId ?? validDefault);
  const [date, setDate] = useState(old?.date ?? store.today());
  const [notes, setNotes] = useState(old?.notes ?? '');
  const { issues, setIssues, busy, save, remove, dialog } = useTxnSave(editId, onClose);
  const [emiBusy, setEmiBusy] = useState<Id | null>(null);

  const l = loans.find((x) => x.id === loan);
  const pr = hasInterest ? principal ?? amount ?? 0 : amount ?? 0;
  const interest = Math.max(0, (amount ?? 0) - pr);

  const pickLoan = (id: Id) => { setLoan(id); const x = loans.find((y) => y.id === id); if (x && amount === undefined && x.emi > 0) setAmount(x.emi); };

  const submit = async () => {
    if (!l) { setIssues([{ field: 'liabilityId', message: 'Choose a loan' }]); return; }
    const draft: Draft<Transaction> = {
      type: 'liability_payment', date, amount: amount ?? 0, ownerId: l.ownerId, fromAccountId: account, liabilityId: l.id,
      principalPortion: hasInterest ? pr : undefined, paymentMethod: 'bank_transfer', notes: notes.trim() || undefined,
    };
    if (await save(draft, 'Loan payment saved')) onClose();
  };

  const emis = db.emis.filter((e) => inScope(e.ownerId, scope)).map((e) => ({ e, s: emiState(e) })).filter((x) => x.s.active && x.s.nextDueDate);
  const markPaid = async (id: Id, due: string) => {
    setEmiBusy(id);
    try {
      const r = await store.confirmEmiInstalment(id, { dueDate: due, date: store.today() });
      if (r.ok) toast('Instalment marked paid'); else toast(r.issues.map((i) => i.message).join(' · '), 'error');
    } finally { setEmiBusy(null); }
  };

  return (
    <>
      <FormShell onSubmit={submit}>
        {!loans.length ? <Note>No active loans yet. Add one under “Cards, EMIs &amp; loans” and it will appear here.</Note> : (
          <>
            <SelectField label="Loan" value={loan} options={loans.map((x) => ({ value: x.id, label: `${x.name} · ${formatMoney(liabilityOutstanding(db, x))} left` }))} onChange={pickLoan} placeholder="Choose a loan" error={issues.find((i) => i.field === 'liabilityId')?.message} />
            <MoneyField label="Amount paid" big autoFocus value={amount} onChange={setAmount} error={issues.find((i) => i.field === 'amount')?.message} />
            <Check label="This payment includes interest" checked={hasInterest} onChange={(v) => { setHasInterest(v); if (v && principal === undefined) setPrincipal(amount); }} />
            {hasInterest ? (
              <div class="qa-sub">
                <MoneyField label="Principal portion" value={principal} onChange={setPrincipal} hint="Check your loan statement for the split." error={issues.find((i) => i.field === 'principalPortion')?.message} />
                <Note>Interest part: <b>{formatMoney(interest)}</b>. Interest counts as spending; the principal reduces your debt and doesn’t.</Note>
              </div>
            ) : <Note tone="good">The full amount reduces what you owe. Loan principal isn’t spending — only interest is.</Note>}
            <SelectField label="Paid from" value={account} options={accounts} onChange={setAccount} error={issues.find((i) => i.field === 'fromAccountId')?.message} />
            <DateField label="Date" value={date} onChange={setDate} error={issues.find((i) => i.field === 'date')?.message} />
            <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
            <ErrorSummary issues={issues} known={['amount', 'liabilityId', 'principalPortion', 'fromAccountId', 'date']} />
            <SaveBar busy={busy} onDelete={remove} />
          </>
        )}
        {dialog}
      </FormShell>
      {!editId && emis.length > 0 && (
        <Card title="Card EMI instalment" tone="soft">
          <p class="muted">Marking an instalment paid updates the EMI’s progress and blocked credit. It does <b>not</b> create an expense — the card bill payment is recorded separately as a Transfer.</p>
          {emis.map(({ e, s }) => (
            <Row key={e.id} title={e.name} sub={`${formatMoney(e.emiAmount)} · due ${formatDate(s.nextDueDate!)} · ${s.monthsRemaining} left`}
              right={<Button size="sm" disabled={emiBusy === e.id} onClick={() => markPaid(e.id, s.nextDueDate!)}>Mark instalment paid</Button>} />
          ))}
        </Card>
      )}
    </>
  );
}
