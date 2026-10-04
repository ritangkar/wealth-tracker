import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, DateField, EmptyState, FormErrors, MoneyField, Progress, Segmented, SelectField, Sheet, Stat, TextArea, TextField, fieldError, useConfirm } from '../../kit';
import { toast, useAction, useDb, useScope, useStore, ownerOptions, personName, defaultOwner } from '../../state';
import { formatDate, formatMoney } from '../../format';
import { goalProgress, goalsInScope, unallocatedLiquid } from '../../../domain/goals';
import type { Goal, GoalKind, OwnerId } from '../../../domain/types';
import './plan.css';

export const GOAL_KINDS: { value: GoalKind; label: string }[] = [
  { value: 'emergency', label: 'Emergency Fund' }, { value: 'trip', label: 'Trip' }, { value: 'land', label: 'Land' }, { value: 'purchase', label: 'Major purchase' },
  { value: 'vehicle', label: 'Vehicle' }, { value: 'home', label: 'Home' }, { value: 'wealth', label: 'Long-term wealth' }, { value: 'other', label: 'Other' },
];
const kindLabel = (k: GoalKind) => GOAL_KINDS.find((x) => x.value === k)?.label ?? k;
const STATUS_LABEL = { active: 'Active', achieved: 'Achieved', paused: 'Paused' } as const;

export default function Goals() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today();
  const goals = goalsInScope(db, scope);
  const money = unallocatedLiquid(db, scope);
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [alloc, setAlloc] = useState<{ goal: Goal; release: boolean } | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const [ask, dialog] = useConfirm(); const { run } = useAction();
  const progress = goals.map((g) => goalProgress(db, g, today));
  const order = { active: 0, paused: 1, achieved: 2 } as const;
  progress.sort((a, b) => order[a.goal.status] - order[b.goal.status] || a.goal.name.localeCompare(b.goal.name));

  const del = async (g: Goal) => {
    const n = db.goalAllocations.filter((a) => a.goalId === g.id).length;
    if (await ask({ title: `Delete “${g.name}”?`, danger: true, confirmLabel: 'Delete goal', body: <p>This removes the goal{n ? ` and its ${n} allocation${n > 1 ? 's' : ''}` : ''}. Your bank balances and net worth are not affected.</p> })) {
      const r = await run(() => store.deleteGoal(g.id), 'Goal deleted'); void r;
    }
  };

  return (<>
    <div class="px-explain" role="note">
      <strong>Goal money is a plan, not extra money.</strong>
      Allocating {formatMoney(6000000)} to a goal is like labelling an envelope — it doesn’t change your bank balances or net worth. It just reminds you what that cash is for.
    </div>

    <Card title="Cash and envelopes" action={<Button variant="primary" size="sm" onClick={() => setEdit('new')}>+ New goal</Button>}>
      <div class="px-stats">
        <Stat label="Liquid cash" value={formatMoney(money.liquid)} sub="bank, cash, wallets" />
        <Stat label="Set aside for goals" value={formatMoney(money.allocated)} />
        <Stat label="Not yet set aside" value={formatMoney(money.unallocated)} tone={money.unallocated < 0 ? 'warn' : 'good'} />
      </div>
      {money.unallocated < 0 && <Banner tone="warn">Your goals hold {formatMoney(-money.unallocated)} more than your current liquid cash. That is fine as a plan, but you may want to top up savings or release some allocation.</Banner>}
    </Card>

    {!goals.length && <Card><EmptyState title="No goals yet" body="Pick anything that matters — an emergency fund, a trip, a down payment. You choose the target and the timeline." action={<Button variant="primary" onClick={() => setEdit('new')}>Add a goal</Button>} /></Card>}

    {progress.map((p) => {
      const g = p.goal; const behind = p.requiredMonthly !== null && p.monthsLeft !== null && !p.achieved;
      return (
        <Card key={g.id}>
          <div class="px-head-row">
            <div><h3>{g.name}</h3>
              <div class="px-badges">
                <Badge tone="info">{kindLabel(g.kind)}</Badge>
                <Badge>{g.ownerId === 'hh' ? 'Household goal' : `${personName(db, g.ownerId)}’s goal`}</Badge>
                {g.status !== 'active' && <Badge tone={g.status === 'achieved' ? 'good' : 'muted'}>{STATUS_LABEL[g.status]}</Badge>}
                {p.achieved && g.status === 'active' && <Badge tone="good">Fully set aside</Badge>}
              </div>
            </div>
            <div class="px-item-amt">{Math.round(p.pct)}%</div>
          </div>
          {(g.location || g.description) && <div class="px-sub">{g.kind === 'trip' && g.location ? `📍 ${g.location}` : g.location ? `📍 ${g.location}` : ''}{g.location && g.description ? ' · ' : ''}{g.description}</div>}
          <Progress pct={p.pct} label={`${g.name} progress`} tone={p.achieved ? 'good' : undefined} />
          <div class="px-two">
            <Stat label="Set aside" value={formatMoney(p.allocated)} sub={`of ${formatMoney(p.target)}`} />
            <Stat label="Still to go" value={formatMoney(p.remaining)} sub={g.targetDate ? `by ${formatDate(g.targetDate)}` : 'no date set'} />
          </div>
          {behind && p.remaining > 0 && <div class="px-sub">{p.monthsLeft === 0 ? 'The target month is here — ' : `${p.monthsLeft} month${p.monthsLeft === 1 ? '' : 's'} left — `}about {formatMoney(p.requiredMonthly ?? 0)} a month would get you there. A guide, not a deadline to stress about.</div>}
          <div class="px-actions">
            <Button size="sm" variant="primary" onClick={() => setAlloc({ goal: g, release: false })}>Allocate</Button>
            <Button size="sm" disabled={p.allocated <= 0} onClick={() => setAlloc({ goal: g, release: true })}>Release</Button>
            <Button size="sm" variant="ghost" onClick={() => setHist(g.id)}>History</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(g)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => del(g)}>Delete</Button>
          </div>
        </Card>
      );
    })}
    {edit && <GoalSheet goal={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    {alloc && <AllocSheet goal={alloc.goal} release={alloc.release} onClose={() => setAlloc(null)} />}
    {hist && <HistorySheet goalId={hist} onClose={() => setHist(null)} />}
    {dialog}
  </>);
}

function GoalSheet({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope(); const { busy, run } = useAction();
  const [name, setName] = useState(goal?.name ?? '');
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'other');
  const [owner, setOwner] = useState<OwnerId>(goal?.ownerId ?? (scope === 'household' ? 'hh' : defaultOwner(db, scope)));
  const [target, setTarget] = useState<number | undefined>(goal?.targetAmount);
  const [date, setDate] = useState(goal?.targetDate ?? '');
  const [loc, setLoc] = useState(goal?.location ?? '');
  const [desc, setDesc] = useState(goal?.description ?? '');
  const [status, setStatus] = useState<Goal['status']>(goal?.status ?? 'active');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const save = async () => {
    const errs: { field: string; message: string }[] = [];
    if (!name.trim()) errs.push({ field: 'name', message: 'Give the goal a name' });
    if (!target || target <= 0) errs.push({ field: 'targetAmount', message: 'Enter a target amount' });
    if (errs.length) { setIssues(errs); return; }
    const r = await store.saveGoal({ name: name.trim(), kind, ownerId: owner, targetAmount: target!, targetDate: date || undefined, location: kind === 'trip' && loc.trim() ? loc.trim() : undefined, description: desc.trim() || undefined, status }, goal?.id);
    if (r.ok) { toast(goal ? 'Goal updated' : 'Goal added'); onClose(); } else setIssues(r.issues);
  };
  return (
    <Sheet title={goal ? 'Edit goal' : 'New goal'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>Save goal</Button></>}>
      <div class="px-form">
        <FormErrors issues={issues} />
        <TextField label="Goal name" value={name} onInput={setName} error={fieldError(issues, 'name')} placeholder="e.g. Emergency fund" autoFocus />
        <SelectField label="Type of goal" value={kind} onChange={setKind} options={GOAL_KINDS} />
        {kind === 'trip' && <TextField label="Where to? (country or place)" value={loc} onInput={setLoc} placeholder="Optional" />}
        <SelectField label="Whose goal is it?" value={owner} onChange={setOwner} options={ownerOptions(db)} />
        <MoneyField label="Target amount" value={target} onChange={setTarget} error={fieldError(issues, 'targetAmount')} />
        <DateField label="Target date (optional)" value={date} onChange={setDate} error={fieldError(issues, 'targetDate')} />
        <TextArea label="Notes (optional)" value={desc} onInput={setDesc} />
        <div class="field"><label id="gs-l">Status</label><Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'achieved', label: 'Achieved' }]} /></div>
      </div>
    </Sheet>
  );
}

function AllocSheet({ goal, release, onClose }: { goal: Goal; release: boolean; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const { busy, run } = useAction();
  const today = store.today();
  const [mode, setMode] = useState<'add' | 'release'>(release ? 'release' : 'add');
  const [amt, setAmt] = useState<number | undefined>();
  const [date, setDate] = useState(today); const [notes, setNotes] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const p = goalProgress(db, goal, today);
  const save = async () => {
    if (!amt || amt <= 0) { setIssues([{ field: 'amount', message: 'Enter an amount' }]); return; }
    const r = await store.addAllocation({ goalId: goal.id, date, amount: mode === 'add' ? amt : -amt, ownerId: goal.ownerId, notes: notes.trim() || undefined });
    if (r.ok) { toast(mode === 'add' ? 'Set aside' : 'Released'); onClose(); } else setIssues(r.issues);
  };
  return (
    <Sheet title={`${goal.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{mode === 'add' ? 'Set aside' : 'Release'}</Button></>}>
      <div class="px-form">
        <Segmented label="Allocate or release" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Allocate' }, { value: 'release', label: 'Release' }]} />
        <div class="px-explain">This only moves a label. Your bank balances and net worth stay exactly the same. Currently set aside: {formatMoney(p.allocated)}.</div>
        <FormErrors issues={issues} />
        <MoneyField label={mode === 'add' ? 'Amount to set aside' : 'Amount to release'} value={amt} onChange={setAmt} error={fieldError(issues, 'amount')} autoFocus big />
        <DateField label="Date" value={date} onChange={setDate} />
        <TextField label="Note (optional)" value={notes} onInput={setNotes} />
      </div>
    </Sheet>
  );
}

function HistorySheet({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const { run } = useAction(); const [ask, dialog] = useConfirm();
  const goal = db.goals.find((g) => g.id === goalId);
  const items = db.goalAllocations.filter((a) => a.goalId === goalId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return (
    <Sheet title={`${goal?.name ?? 'Goal'} — history`} onClose={onClose}>
      {!items.length ? <p class="muted">Nothing set aside yet.</p> : (
        <ul class="px-list px-hist">
          {items.map((a) => (
            <li key={a.id}>
              <span><b class={a.amount > 0 ? 'pos' : ''}>{a.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(a.amount))}</b><div class="px-sub">{formatDate(a.date)}{a.notes ? ` · ${a.notes}` : ''}</div></span>
              <Button size="sm" variant="ghost" aria-label={`Delete allocation of ${formatMoney(Math.abs(a.amount))} on ${formatDate(a.date)}`}
                onClick={async () => { if (await ask({ title: 'Delete this entry?', danger: true, confirmLabel: 'Delete', body: <p>Removes this allocation record. Bank balances are unaffected.</p> })) await run(() => store.deleteAllocation(a.id), 'Entry deleted'); }}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Sheet>
  );
}
