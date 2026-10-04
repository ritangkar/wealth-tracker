import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, DateField, EmptyState, FormErrors, MoneyField, Progress, Segmented, SelectField, Sheet, Stat, TextArea, TextField, fieldError, useConfirm } from '../../kit';
import { toast, useAction, useDb, useScope, useStore, ownerOptions, personName, defaultOwner } from '../../state';
import { formatDate, formatMoney } from '../../format';
import { fundingOverview, goalProgress, goalSourceBreakdown, goalsInScope } from '../../../domain/goals';
import { AllocationLines, initialLines, linesToDrafts, linesTotal, type AllocLine } from '../../quickadd/AllocationLines';
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
  const ov = fundingOverview(db, scope);
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

    <Card title="Money set aside for goals" action={<Button variant="primary" size="sm" onClick={() => setEdit('new')}>+ New goal</Button>}>
      <div class="px-stats">
        <Stat label="Available to set aside" value={formatMoney(ov.totalAvailable)} sub="cash, FDs, RDs, funds, stocks, gold — not EPF/PPF" />
        <Stat label="Set aside for goals" value={formatMoney(ov.totalAllocated)} />
        <Stat label="Still free" value={formatMoney(ov.totalFree)} tone={ov.totalFree < 0 ? 'warn' : 'good'} />
      </div>
      {ov.totalFree < 0 && <Banner tone="warn">Your goals hold {formatMoney(-ov.totalFree)} more than the money currently available. That is fine as a plan (valuations move), but you may want to top up or release some allocation.</Banner>}
      {ov.sources.some((s) => s.allocated !== 0 || s.value > 0) && (
        <details class="disclosure"><summary>Where your money is set aside</summary>
          <div class="disclosure-body">
            {ov.sources.filter((s) => s.value > 0 || s.allocated !== 0).sort((a, b) => b.allocated - a.allocated || b.value - a.value).map((s) => (
              <div class="src-row" key={`${s.kind}:${s.id}`}>
                <div class="row-title">{s.name} <span class="muted">· {s.label}</span></div>
                <div class="row-amt">{formatMoney(s.value)}</div>
                <div class="row-sub">Set aside {formatMoney(s.allocated)} · <span class={s.free < 0 ? 'neg-warn' : ''}>free {formatMoney(s.free)}</span></div>
              </div>
            ))}
            {ov.unassigned !== 0 && <div class="src-row"><div class="row-title">Not tied to a source <span class="muted">· older entries</span></div><div class="row-amt">{formatMoney(ov.unassigned)}</div><div class="row-sub">counted against cash</div></div>}
          </div>
        </details>
      )}
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
          {(() => { const bd = goalSourceBreakdown(db, g.id); return bd.length ? (
            <div class="px-sub" aria-label={`Where ${g.name} is set aside from`}>
              <b>Set aside from:</b> {bd.map((r) => `${r.name} ${formatMoney(r.amount)}`).join(' · ')}
            </div>) : null; })()}
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
  const db = useDb(); const store = useStore(); const [scope] = useScope(); const { busy } = useAction();
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
  const db = useDb(); const store = useStore(); const { busy } = useAction();
  const today = store.today();
  const [mode, setMode] = useState<'add' | 'release'>(release ? 'release' : 'add');
  const [lines, setLines] = useState<AllocLine[]>(() => initialLines(db, release ? 'release' : 'add', goal.id));
  const [date, setDate] = useState(today); const [notes, setNotes] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const p = goalProgress(db, goal, today);
  const total = linesTotal(lines);
  const changeMode = (m: 'add' | 'release') => { setMode(m); setLines(initialLines(db, m, goal.id)); setIssues([]); };
  const save = async () => {
    const built = linesToDrafts(lines, { goalId: goal.id, date, ownerId: goal.ownerId, notes: notes.trim() || undefined, sign: mode === 'add' ? 1 : -1 });
    if (!built.drafts) { setIssues([{ field: 'amount', message: built.error! }]); return; }
    const r = await store.addAllocations(built.drafts);
    if (r.ok) { toast(mode === 'add' ? `Set aside ${formatMoney(total)}` : `Released ${formatMoney(total)}`); onClose(); } else setIssues(r.issues);
  };
  return (
    <Sheet title={`${goal.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{mode === 'add' ? `Set aside${total ? ' ' + formatMoney(total) : ''}` : 'Release'}</Button></>}>
      <div class="px-form">
        <Segmented label="Allocate or release" value={mode} onChange={changeMode} options={[{ value: 'add', label: 'Allocate' }, { value: 'release', label: 'Release' }]} />
        <div class="px-explain">Choose which money this comes from — you can combine several, e.g. ₹30,000 from an FD and ₹20,000 from a mutual fund. Nothing is moved or sold; your balances and net worth stay exactly the same. Currently set aside for this goal: {formatMoney(p.allocated)}.</div>
        <FormErrors issues={issues} />
        <AllocationLines db={db} mode={mode} goalId={goal.id} lines={lines} setLines={setLines} />
        {fieldError(issues, 'amount') && <p class="err" role="alert">{fieldError(issues, 'amount')}</p>}
        {fieldError(issues, 'source') && <p class="err" role="alert">{fieldError(issues, 'source')}</p>}
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
              <span><b class={a.amount > 0 ? 'pos' : ''}>{a.amount > 0 ? '+' : '−'}{formatMoney(Math.abs(a.amount))}</b><div class="px-sub">{formatDate(a.date)} · {srcName(db, a)}{a.notes ? ` · ${a.notes}` : ''}</div></span>
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

function srcName(db: ReturnType<typeof useDb>, a: { sourceKind?: 'account' | 'investment' | 'asset'; sourceId?: string }) {
  if (!a.sourceKind) return 'not tied to a source';
  return (a.sourceKind === 'account' ? db.accounts : a.sourceKind === 'investment' ? db.investments : db.assets).find((x) => x.id === a.sourceId)?.name ?? 'removed item';
}
