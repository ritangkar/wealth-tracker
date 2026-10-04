import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Check, Chips, DateField, Disclosure, EmptyState, FormErrors, MoneyField, Progress, Row, Sheet, Stat, TextField, fieldError, useConfirm } from '../../kit';
import { formatDate, formatMoney } from '../../format';
import { toast, useAction, useDb, useScope, useStore } from '../../state';
import { cardMetrics, rewardsEstimate, latestReport } from '../../../domain/cards';
import { monthOf } from '../../../domain/dates';
import { inScope } from '../../../domain/scope';
import type { Account, CardReport, RewardConfig } from '../../../domain/types';
import { EmiInLedgerCheck } from '../../quickadd/EmiInstalment';
import { Note, OwnerBadge } from '../wealth/shared';
import { navigate } from '../../router';
import './debt.css';

const SOURCES: { value: CardReport['source']; label: string }[] = [
  { value: 'statement', label: 'Statement' }, { value: 'app', label: 'Bank app' }, { value: 'sms', label: 'SMS' }, { value: 'manual', label: 'Other' },
];
const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]));

export default function CardsTab() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today();
  const [report, setReport] = useState<string | null>(null);
  const [rewards, setRewards] = useState<string | null>(null);
  const cards = db.accounts.filter((a) => a.kind === 'credit_card' && !a.archived && inScope(a.ownerId, scope));

  return (
    <div class="wl-list">
      <Disclosure summary="How this is calculated">
        <p><b>Bank values win.</b> When you enter what your bank reports (limit, available, outstanding), those numbers are shown and labelled “bank-reported”. Anything you spend or pay afterwards is applied on top until your next update.</p>
        <p><b>Otherwise it’s an estimate</b>: outstanding comes from your tracked entries, and used credit = non-EMI outstanding + blocked EMI amount. Estimates are always labelled.</p>
        <p><b>EMI blocking varies by issuer.</b> Some free up credit as you pay each instalment; others hold the full amount until the EMI ends. You choose which applies to each EMI, or enter the exact blocked amount your bank shows.</p>
        <p><b>Reduced available credit is not an expense.</b> An EMI or a purchase reduces what you can still borrow, but spending is only counted when you record the purchase itself.</p>
      </Disclosure>

      {cards.length === 0 && (
        <Card><EmptyState title="No credit cards here" body="Add a credit card as an account (with its limit) and it will show up with available credit, utilization and EMI details." action={<Button variant="primary" onClick={() => navigate('/wealth?tab=accounts')}>Go to accounts</Button>} /></Card>
      )}

      {cards.map((acc) => <CardView key={acc.id} acc={acc} today={today} onReport={() => setReport(acc.id)} onRewards={() => setRewards(acc.id)} />)}
      {report && <ReportSheet accId={report} onClose={() => setReport(null)} />}
      {rewards && <RewardSheet accId={rewards} onClose={() => setRewards(null)} />}
    </div>
  );
}

function CardView({ acc, today, onReport, onRewards }: { acc: Account; today: string; onReport: () => void; onRewards: () => void }) {
  const db = useDb(); const store = useStore(); const { run } = useAction(); const [ask, dialog] = useConfirm();
  const m = cardMetrics(db, acc, today);
  const rep = latestReport(db, acc.id);
  const reps = db.cardReports.filter((r) => r.accountId === acc.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const rw = rewardsEstimate(db, acc, monthOf(today));
  const high = m.utilizationPct > 50;
  const bankAvail = m.availableSource === 'bank';
  return (
    <Card>
      <div class="wl-item">
        <div class="wl-item-head">
          <div>
            <h3>{acc.name}</h3>
            <div class="wl-badges"><OwnerBadge db={db} owner={acc.ownerId} />{acc.card?.last4 && <Badge tone="muted">•••• {acc.card.last4}</Badge>}</div>
          </div>
          <div>
            <div class="wl-amt">{formatMoney(m.outstanding)}</div>
            <div class="row-sub" style={{ textAlign: 'right' }}>outstanding <Badge tone={m.outstandingSource === 'bank' ? 'good' : 'muted'}>{m.outstandingSource === 'bank' ? 'bank-reported' : 'estimate'}</Badge></div>
          </div>
        </div>

        {m.creditLimit > 0 ? (
          <div class="db-util">
            <div class="db-util-head"><span>Credit used</span><b>{Math.round(m.utilizationPct)}%</b></div>
            <Progress pct={m.utilizationPct} tone={high ? 'warn' : undefined} label={`${acc.name} credit used`} />
            <div class="row-sub">
              {formatMoney(m.used)} of {formatMoney(m.creditLimit)} used · {formatMoney(m.available)} available{' '}
              <Badge tone={bankAvail ? 'good' : 'muted'}>{bankAvail ? 'bank-reported' : 'estimate'}</Badge>
            </div>
            {high && <p class="hint">You’re using more than half of this card’s limit. Nothing is wrong — paying part of it down before the statement date is one way to lower it.</p>}
            {m.overLimit && <p class="hint">Tracked usage is above the limit — your bank’s figure may differ. Use “Update from bank” to sync.</p>}
          </div>
        ) : <Note>Add the credit limit (Wealth → Accounts → Edit) to see available credit and utilization.</Note>}

        {bankAvail && m.reportDate && (
          <p class="hint">Available credit is from your bank on {formatDate(m.reportDate)}{m.laterActivityCount > 0 ? `; ${m.laterActivityCount} later transaction${m.laterActivityCount === 1 ? '' : 's'} applied on top.` : '.'}</p>
        )}

        <div class="wl-metrics">
          <Stat label="Credit limit" value={formatMoney(m.creditLimit)} />
          <Stat label="Available" value={formatMoney(m.available)} />
          <Stat label="Used credit" value={formatMoney(m.used)} />
          <Stat label="Non-EMI outstanding" value={formatMoney(m.nonEmiOutstanding)} />
          <Stat label={`Active EMI outstanding${m.activeEmiCount ? ` (${m.activeEmiCount})` : ''}`} value={formatMoney(m.emiOutstanding)} />
          <Stat label="EMI-linked / blocked" value={formatMoney(m.emiBlocked)} sub={rep?.emiBlocked !== undefined ? 'bank-reported' : 'estimate'} hint="Credit held back for EMIs. Policy varies by issuer." />
          <Stat label="Next statement" value={m.nextStatementDate ? formatDate(m.nextStatementDate) : '—'} sub={m.nextStatementDate ? undefined : 'Add statement day'} />
          <Stat label="Next due" value={m.nextDueDate ? formatDate(m.nextDueDate) : '—'} sub={m.nextDueDate ? undefined : 'Add due day'} />
        </div>
        {m.ledgerCredit > 0 && <Note>This card is in credit by {formatMoney(m.ledgerCredit)} (overpaid) — that counts as an asset.</Note>}

        <div class="db-rewards">
          <div><b>Rewards this month</b> <Badge tone="muted">estimate</Badge></div>
          {rw ? <p>≈ {rw.points.toLocaleString('en-IN')} points{rw.value > 0 ? ` (about ${formatMoney(rw.value)})` : ''} on {formatMoney(rw.eligibleSpend)} eligible spend. Based on your own rule{acc.card?.rewards?.asOf ? `, set ${formatDate(acc.card.rewards.asOf)}` : ''}.</p>
            : <p class="muted">No reward rule set. Add your card’s rule yourself to see an estimate — we don’t assume any bank’s rates.</p>}
        </div>

        <div class="wl-actions">
          <Button variant="primary" size="sm" onClick={onReport}>Update from bank</Button>
          <Button size="sm" onClick={onRewards}>{acc.card?.rewards ? 'Edit reward rule' : 'Set reward rule'}</Button>
        </div>

        {reps.length > 0 && (
          <Disclosure summary={`Bank report history (${reps.length})`}>
            {reps.map((r) => (
              <Row key={r.id} title={`${formatDate(r.date)} · ${SOURCE_LABEL[r.source]}`}
                sub={[r.creditLimit !== undefined && `Limit ${formatMoney(r.creditLimit)}`, r.availableLimit !== undefined && `Available ${formatMoney(r.availableLimit)}`, r.outstanding !== undefined && `Outstanding ${formatMoney(r.outstanding)}`, r.nonEmiOutstanding !== undefined && `Non-EMI ${formatMoney(r.nonEmiOutstanding)}`, r.emiOutstanding !== undefined && `EMI ${formatMoney(r.emiOutstanding)}`, r.emiBlocked !== undefined && `Blocked ${formatMoney(r.emiBlocked)}`].filter(Boolean).join(' · ')}
                right={<Button size="sm" variant="ghost" aria-label={`Delete report from ${formatDate(r.date)}`} onClick={async () => { if (await ask({ title: 'Delete this report?', body: 'Estimates will be used again for anything this report covered. A correction entry made with it (if any) stays in Activity.', confirmLabel: 'Delete', danger: true })) await run(() => store.deleteCardReport(r.id), 'Report deleted'); }}>Delete</Button>} />
            ))}
          </Disclosure>
        )}
      </div>
      {dialog}
    </Card>
  );
}

function ReportSheet({ accId, onClose }: { accId: string; onClose: () => void }) {
  const db = useDb(); const store = useStore();
  const acc = db.accounts.find((a) => a.id === accId)!;
  const [date, setDate] = useState(store.today());
  const [source, setSource] = useState<CardReport['source']>('app');
  const [limit, setLimit] = useState<number | undefined>();
  const [avail, setAvail] = useState<number | undefined>();
  const [out, setOut] = useState<number | undefined>();
  const [nonEmi, setNonEmi] = useState<number | undefined>();
  const [emiOut, setEmiOut] = useState<number | undefined>();
  const [blocked, setBlocked] = useState<number | undefined>();
  const [notes, setNotes] = useState('');
  const [reconcile, setReconcile] = useState(false);
  const [emiInLedger, setEmiInLedger] = useState(acc.card?.emiInLedger !== false);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);

  const save = async () => {
    if (acc.card && (acc.card.emiInLedger !== false) !== emiInLedger) {
      const u = await store.updateAccount(acc.id, { card: { ...acc.card, emiInLedger } });
      if (!u.ok) { setIssues(u.issues); return; }
    }
    const r = await store.addCardReport({ accountId: accId, date, source, creditLimit: limit, availableLimit: avail, outstanding: out, nonEmiOutstanding: nonEmi, emiOutstanding: emiOut, emiBlocked: blocked, notes: notes.trim() || undefined }, { reconcile: reconcile && out !== undefined });
    if (!r.ok) { setIssues(r.issues); return; }
    toast('Saved from your bank’s numbers'); onClose();
  };
  return (
    <Sheet title={`Update from bank — ${acc.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div class="form">
        <p class="muted">Copy what your card app or statement shows. Fill in whatever you have — at least one value. Bank values take priority over estimates.</p>
        <FormErrors issues={issues} />
        <DateField label="As of" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
        <div><div class="hint">Where from</div><Chips label="Source" value={source} options={SOURCES} onChange={(v) => v && setSource(v)} /></div>
        <div class="wl-two">
          <MoneyField label="Credit limit" value={limit} onChange={setLimit} error={fieldError(issues, 'creditLimit')} />
          <MoneyField label="Available limit" value={avail} onChange={setAvail} error={fieldError(issues, 'availableLimit')} />
          <MoneyField label="Total outstanding" value={out} onChange={setOut} error={fieldError(issues, 'outstanding')} hint="Does your bank’s figure include or exclude EMI principal? Set the checkbox below to match." />
          <MoneyField label="Non-EMI outstanding" value={nonEmi} onChange={setNonEmi} error={fieldError(issues, 'nonEmiOutstanding')} />
          <MoneyField label="EMI outstanding" value={emiOut} onChange={setEmiOut} error={fieldError(issues, 'emiOutstanding')} />
          <MoneyField label="EMI blocked amount" value={blocked} onChange={setBlocked} error={fieldError(issues, 'emiBlocked')} />
        </div>
        <EmiInLedgerCheck checked={emiInLedger} onChange={setEmiInLedger} />
        <TextField label="Note (optional)" value={notes} onInput={setNotes} />
        <Check label="Also make my tracked outstanding match (adds a correction entry)" checked={reconcile && out !== undefined} onChange={setReconcile} hint={out === undefined ? '(enter total outstanding first)' : undefined} />
        <Note>The correction entry is a balance fix, not an expense or income.</Note>
      </div>
    </Sheet>
  );
}

function RewardSheet({ accId, onClose }: { accId: string; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const { run } = useAction();
  const acc = db.accounts.find((a) => a.id === accId)!;
  const r0 = acc.card?.rewards;
  const [points, setPoints] = useState<string>(r0 ? String(r0.pointsPerBlock) : '');
  const [block, setBlock] = useState<number | undefined>(r0?.blockAmount);
  const [pv, setPv] = useState<number | undefined>(r0?.pointValue);
  const [excluded, setExcluded] = useState<string[]>(r0?.excludedCategoryIds ?? []);
  const [note, setNote] = useState(r0?.note ?? '');
  const [source, setSource] = useState(r0?.source ?? '');
  const [err, setErr] = useState('');
  const cats = db.categories.filter((c) => c.kind === 'expense' && !c.parentId);

  const save = async () => {
    const p = Number(points);
    if (!points || !Number.isFinite(p) || p < 0) { setErr('Enter how many points you earn per block'); return; }
    if (!block || block <= 0) { setErr('Enter the spend block, e.g. ₹100'); return; }
    const rewards: RewardConfig = { pointsPerBlock: p, blockAmount: block, pointValue: pv ?? 0, excludedCategoryIds: excluded, asOf: store.today() };
    if (note.trim()) rewards.note = note.trim();
    if (source.trim()) rewards.source = source.trim();
    const ok = await run(() => store.updateAccount(acc.id, { card: { ...acc.card!, rewards } }), 'Reward rule saved');
    if (ok) onClose();
  };
  const clear = async () => {
    const card = { ...acc.card! }; delete card.rewards;
    const ok = await run(() => store.updateAccount(acc.id, { card }), 'Reward rule removed');
    if (ok) onClose();
  };
  return (
    <Sheet title={`Reward rule — ${acc.name}`} onClose={onClose} footer={<>{r0 && <Button variant="ghost" onClick={clear}>Remove rule</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div class="form">
        <Banner tone="info">Card reward rules change often, so we don’t hard-code any bank’s. Enter your card’s current rule yourself; the result is always shown as an <b>estimate</b>.</Banner>
        {err && <div class="banner banner-error" role="alert">{err}</div>}
        <div class="wl-two">
          <TextField label="Points earned per block" value={points} onInput={(v) => setPoints(v.replace(/[^\d.]/g, ''))} placeholder="e.g. 5" />
          <MoneyField label="Spend block" value={block} onChange={setBlock} hint="e.g. ₹100 earns the points above" />
        </div>
        <MoneyField label="Value of one point (optional)" value={pv} onChange={setPv} hint="e.g. ₹0.25 — leave blank to show points only" />
        {cats.length > 0 && (
          <Disclosure summary={`Categories that earn nothing (${excluded.length})`}>
            {cats.map((c) => <Check key={c.id} label={c.name} checked={excluded.includes(c.id)} onChange={(on) => setExcluded(on ? [...excluded, c.id] : excluded.filter((x) => x !== c.id))} />)}
          </Disclosure>
        )}
        <TextField label="Where this rule comes from (optional)" value={source} onInput={setSource} placeholder="e.g. card benefits page, Oct 2026" />
        <TextField label="Note (optional)" value={note} onInput={setNote} />
      </div>
    </Sheet>
  );
}
