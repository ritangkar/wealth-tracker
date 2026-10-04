import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Check, DateField, Disclosure, EmptyState, FormErrors, IntField, MoneyField, SelectField, Sheet, TextArea, TextField, fieldError, useConfirm } from '../../kit';
import { ACCOUNT_KIND_LABELS, formatDate, formatMoney } from '../../format';
import { defaultOwner, ownerOptions, toast, useDb, useScope, useStore } from '../../state';
import { accountBalances } from '../../../domain/ledger';
import { inScope } from '../../../domain/scope';
import type { Account, AccountKind, CardDetails, OwnerId } from '../../../domain/types';
import { Note, OwnerBadge } from './shared';

const KIND_OPTIONS = (Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[]).map((k) => ({ value: k, label: ACCOUNT_KIND_LABELS[k] }));

export default function AccountsTab() {
  const db = useDb(); const [scope] = useScope();
  const [form, setForm] = useState<null | { id?: string }>(null);
  const [fix, setFix] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const bal = accountBalances(db);
  const all = db.accounts.filter((a) => inScope(a.ownerId, scope));
  const list = all.filter((a) => showArchived || !a.archived).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const archived = all.filter((a) => a.archived).length;

  return (
    <div class="wl-list">
      <div class="wl-tabhint">
        <Note>Accounts are places money sits: bank, cash, wallet, credit card.</Note>
        <Button variant="primary" onClick={() => setForm({})}>Add account</Button>
      </div>
      <Disclosure summary="Payment method vs account">
        <p><b>UPI is a payment method, not an account.</b> When you pay by UPI, the money leaves a bank account — so record the bank account as the account and UPI as the payment method.</p>
        <p>Cash, a wallet, and each credit card are separate accounts because each holds (or owes) its own balance.</p>
      </Disclosure>

      {list.length === 0 ? (
        <Card><EmptyState title="No accounts yet" body="Add your bank account, cash and credit cards. You can change balances later with a correction." action={<Button variant="primary" onClick={() => setForm({})}>Add account</Button>} /></Card>
      ) : list.map((a) => {
        const b = bal.get(a.id) ?? 0;
        const isCard = a.kind === 'credit_card';
        return (
          <Card key={a.id}>
            <div class="wl-item">
              <div class="wl-item-head">
                <div>
                  <h3>{a.name}</h3>
                  <div class="wl-badges"><Badge>{ACCOUNT_KIND_LABELS[a.kind]}</Badge><OwnerBadge db={db} owner={a.ownerId} />{a.card?.last4 && <Badge tone="muted">•••• {a.card.last4}</Badge>}{a.archived && <Badge tone="warn">Archived</Badge>}</div>
                </div>
                <div>
                  <div class="wl-amt">{isCard ? (b < 0 ? formatMoney(-b) : formatMoney(b))
                    : b < 0 ? <span class="wl-neg">{formatMoney(b)}</span> : formatMoney(b)}</div>
                  <div class="row-sub" style={{ textAlign: 'right' }}>{isCard ? (b < 0 ? 'owed' : b > 0 ? 'in credit' : 'nothing owed') : b < 0 ? 'overdrawn' : 'balance'}</div>
                </div>
              </div>
              <div class="wl-actions">
                <Button size="sm" onClick={() => setFix(a.id)}>Fix balance</Button>
                <Button size="sm" onClick={() => setForm({ id: a.id })}>Edit</Button>
              </div>
            </div>
          </Card>
        );
      })}
      {archived > 0 && <Check label={`Show archived (${archived})`} checked={showArchived} onChange={setShowArchived} />}
      {form && <AccountForm id={form.id} onClose={() => setForm(null)} />}
      {fix && <FixBalance id={fix} onClose={() => setFix(null)} />}
    </div>
  );
}

function AccountForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope(); const [ask, dialog] = useConfirm();
  const existing = id ? db.accounts.find((a) => a.id === id) : undefined;
  const hasTxns = !!existing && db.transactions.some((t) => t.fromAccountId === id || t.toAccountId === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'bank');
  const [owner, setOwner] = useState<OwnerId>(existing?.ownerId ?? defaultOwner(db, scope));
  const [opening, setOpening] = useState<number | undefined>(existing ? (existing.kind === 'credit_card' ? -existing.openingBalance : existing.openingBalance) : undefined);
  const [openingDate, setOpeningDate] = useState(existing?.openingDate ?? store.today());
  const [limit, setLimit] = useState<number | undefined>(existing?.card?.creditLimit);
  const [stmt, setStmt] = useState<number | undefined>(existing?.card?.statementDay);
  const [due, setDue] = useState<number | undefined>(existing?.card?.dueDay);
  const [last4, setLast4] = useState(existing?.card?.last4 ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const isCard = kind === 'credit_card';

  const save = async () => {
    const extra: { field: string; message: string }[] = [];
    if (last4 && !/^\d{4}$/.test(last4)) extra.push({ field: 'last4', message: 'Enter exactly 4 digits, or leave blank' });
    for (const [f, v] of [['statementDay', stmt], ['dueDay', due]] as const) if (v !== undefined && (v < 1 || v > 31)) extra.push({ field: f, message: 'Day must be 1–31' });
    if (extra.length) { setIssues(extra); return; }
    let card: CardDetails | undefined;
    if (isCard) {
      card = { ...(existing?.card ?? {}), creditLimit: limit ?? 0 };
      if (stmt !== undefined) card.statementDay = stmt; else delete card.statementDay;
      if (due !== undefined) card.dueDay = due; else delete card.dueDay;
      if (last4) card.last4 = last4; else delete card.last4;
    }
    const draft = { name: name.trim(), kind, ownerId: owner, openingBalance: isCard ? -(opening ?? 0) : opening ?? 0, openingDate, notes: notes.trim() || undefined, archived: existing?.archived, card };
    const r = existing ? await store.updateAccount(existing.id, draft) : await store.addAccount(draft);
    if (!r.ok) { setIssues(r.issues); return; }
    toast(existing ? 'Account saved' : 'Account added'); onClose();
  };
  const toggleArchive = async () => {
    const r = await store.updateAccount(existing!.id, { archived: !existing!.archived });
    if (!r.ok) { setIssues(r.issues); return; }
    toast(existing!.archived ? 'Account restored' : 'Account archived'); onClose();
  };
  const del = async () => {
    if (!(await ask({ title: `Delete ${existing!.name}?`, body: 'This cannot be undone. Accounts that have transactions, EMIs or recurring items cannot be deleted — archive them instead.', confirmLabel: 'Delete', danger: true }))) return;
    const r = await store.deleteAccount(existing!.id);
    if (!r.ok) { setIssues(r.issues); return; }
    toast('Account deleted'); onClose();
  };

  return (
    <Sheet title={existing ? `Edit ${existing.name}` : 'Add account'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <TextField label="Name" value={name} onInput={setName} error={fieldError(issues, 'name')} placeholder={isCard ? 'e.g. Everyday card' : 'e.g. Savings account'} autoFocus />
        <SelectField label="Kind" value={kind} onChange={setKind} options={KIND_OPTIONS} error={fieldError(issues, 'kind')} hint={hasTxns ? 'Kind can’t change once an account has transactions.' : 'UPI is not an account — pick the bank account that UPI draws from.'} />
        <SelectField label="Owner" value={owner} onChange={(v) => setOwner(v as OwnerId)} options={ownerOptions(db)} />
        <div class="wl-two">
          <MoneyField label={isCard ? 'Amount owed as of the date' : 'Opening balance'} value={opening} onChange={setOpening} allowNegative={!isCard} error={fieldError(issues, 'openingBalance')} hint={isCard ? 'Enter what you owe as a positive amount.' : 'Balance as of the date on the right'} />
          <DateField label={isCard ? 'As of' : 'Balance as of'} value={openingDate} onChange={setOpeningDate} />
        </div>
        {isCard && (
          <>
            <MoneyField label="Credit limit" value={limit} onChange={setLimit} error={fieldError(issues, 'creditLimit')} />
            <div class="wl-two">
              <IntField label="Statement day (optional)" value={stmt} onChange={setStmt} min={1} max={31} error={fieldError(issues, 'statementDay')} />
              <IntField label="Due day (optional)" value={due} onChange={setDue} min={1} max={31} error={fieldError(issues, 'dueDay')} />
            </div>
            <TextField label="Last 4 digits (optional)" value={last4} onInput={(v) => setLast4(v.replace(/\D/g, '').slice(0, 4))} maxLength={4} error={fieldError(issues, 'last4')} hint="Helps you tell cards apart." />
            <p class="wl-privacy">Privacy: only the last 4 digits can be stored. Never enter the full card number, CVV, PIN or passwords — this app doesn’t need them.</p>
          </>
        )}
        <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
        {existing && (
          <div class="wl-actions">
            <Button onClick={toggleArchive}>{existing.archived ? 'Restore account' : 'Archive account'}</Button>
            <Button variant="danger" onClick={del}>Delete</Button>
          </div>
        )}
        {existing && <Note>Archiving hides an account from pickers but keeps its history and balance in net worth. Set the balance to zero with “Fix balance” if it is closed.</Note>}
      </div>
      {dialog}
    </Sheet>
  );
}

function FixBalance({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDb(); const store = useStore();
  const acc = db.accounts.find((a) => a.id === id) as Account;
  const isCard = acc.kind === 'credit_card';
  const current = accountBalances(db).get(id) ?? 0;
  const shown = isCard ? -current : current; // for cards: amount owed (positive)
  const [actual, setActual] = useState<number | undefined>();
  const [date, setDate] = useState(store.today());
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const targetBalance = actual === undefined ? undefined : isCard ? -actual : actual;
  const diff = targetBalance === undefined ? 0 : targetBalance - current;

  const save = async () => {
    if (actual === undefined) { setIssues([{ field: 'actual', message: 'Enter the balance you see' }]); return; }
    if (diff === 0) { toast('Already matches — nothing to correct'); onClose(); return; }
    const r = await store.addTransaction({ type: 'adjustment', date, amount: diff, ownerId: acc.ownerId, toAccountId: acc.id, notes: 'Balance correction (match bank)' });
    if (!r.ok) { setIssues(r.issues); return; }
    toast('Balance corrected'); onClose();
  };
  return (
    <Sheet title={`Fix balance — ${acc.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record correction</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <p>The app currently shows <b>{formatMoney(shown)}</b>{isCard ? ' owed' : ''}. Enter what your {isCard ? 'card statement or app' : 'bank app or wallet'} actually shows.</p>
        <MoneyField label={isCard ? 'Amount owed right now' : 'Actual balance'} value={actual} onChange={setActual} allowNegative={!isCard} error={fieldError(issues, 'actual') ?? fieldError(issues, 'amount')} autoFocus />
        <DateField label="As of" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
        {actual !== undefined && <Banner tone={diff === 0 ? 'good' : 'info'}>{diff === 0 ? 'This already matches.' : `We’ll add a correction of ${diff > 0 ? '+' : '−'}${formatMoney(Math.abs(diff))} on ${formatDate(date)}.`}</Banner>}
        <Note>A correction is not income or an expense — it just brings the balance in line with reality (for example for a missed entry) and never counts toward spending or savings. If you can, look in Activity for the missing entry instead.</Note>
        {isCard && <Note>For card limits and EMI details, use “Update from bank” on the Debt page.</Note>}
      </div>
    </Sheet>
  );
}
