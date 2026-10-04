import { useState } from 'preact/hooks';
import type { Issue } from '../../domain/ledger';
import { fundingOverview } from '../../domain/goals';
import { AllocationLines, initialLines, linesToDrafts, linesTotal, type AllocLine } from './AllocationLines';
import type { GoalKind, OwnerId } from '../../domain/types';
import { Button, DateField, MoneyField, SelectField, Segmented, TextField, fieldError } from '../kit';
import { formatMoney } from '../format';
import { defaultOwner, ownerOptions, toast, useDb, useStore } from '../state';
import { ErrorSummary, FormShell, Note, type FormProps } from './shared';

const NEW = '__new';
const GOAL_KINDS: { value: GoalKind; label: string }[] = [
  { value: 'emergency', label: 'Emergency fund' }, { value: 'trip', label: 'Trip' }, { value: 'land', label: 'Land' }, { value: 'purchase', label: 'Big purchase' },
  { value: 'vehicle', label: 'Vehicle' }, { value: 'home', label: 'Home' }, { value: 'wealth', label: 'Wealth building' }, { value: 'other', label: 'Other' },
];

export default function GoalForm({ onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const goals = db.goals.filter((g) => g.status !== 'achieved');
  const [goal, setGoal] = useState<string | undefined>(goals.length === 1 ? goals[0].id : goals.length ? undefined : NEW);
  const [release, setRelease] = useState<'add' | 'release'>('add');
  const [lines, setLines] = useState<AllocLine[]>(() => initialLines(db, 'add'));
  const changeMode = (m: 'add' | 'release') => { setRelease(m); setLines(initialLines(db, m, goal && goal !== NEW ? goal : undefined)); };
  const [date, setDate] = useState(store.today());
  const [owner, setOwner] = useState<OwnerId>(goals.length === 1 ? goals[0].ownerId : defaultOwner(db, scope));
  const [nName, setNName] = useState(''); const [nKind, setNKind] = useState<GoalKind>('trip'); const [nTarget, setNTarget] = useState<number | undefined>();
  const [nDate, setNDate] = useState(''); const [nLoc, setNLoc] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]); const [busy, setBusy] = useState(false);

  const pick = (v: string) => { setGoal(v); const g = goals.find((x) => x.id === v); if (g) setOwner(g.ownerId); if (release === 'release') setLines(initialLines(db, 'release', v)); };
  const ov = fundingOverview(db, scope);
  const total = linesTotal(lines);

  const submit = async () => {
    if (!goal) { setIssues([{ field: 'goal', message: 'Choose a goal' }]); return; }
    setBusy(true);
    try {
      let goalId = goal;
      if (goal === NEW) {
        const g = await store.saveGoal({ name: nName, kind: nKind, ownerId: owner, targetAmount: nTarget ?? 0, targetDate: nDate || undefined, location: nLoc.trim() || undefined, status: 'active' });
        if (!g.ok) { setIssues(g.issues); toast(g.issues[0].message, 'error'); return; }
        goalId = g.value.id; setGoal(goalId);
      }
      const built = linesToDrafts(lines, { goalId, date, ownerId: owner, sign: release === 'release' ? -1 : 1 });
      if (!built.drafts) { setIssues([{ field: 'amount', message: built.error! }]); return; }
      const r = await store.addAllocations(built.drafts);
      if (r.ok) { toast(release === 'release' ? 'Released from goal' : `Set aside ${formatMoney(total)} for goal`); onClose(); }
      else { setIssues(r.issues); toast(r.issues[0].message, 'error'); }
    } finally { setBusy(false); }
  };

  return (
    <FormShell onSubmit={submit}>
      <Note tone="good">Setting money aside is a plan, not a transfer — nothing moves and your balances and net worth don’t change. You choose which money it’s coming from (bank, FD, RD, mutual fund, stocks — EPF/PPF are left out).</Note>
      <SelectField label="Goal" value={goal} onChange={pick} placeholder="Choose a goal" error={fieldError(issues, 'goal') ?? fieldError(issues, 'goalId')}
        options={[...goals.map((g) => ({ value: g.id, label: g.name })), { value: NEW, label: '＋ New goal…' }]} />
      {goal === NEW && (
        <div class="qa-sub">
          <TextField label="Goal name" value={nName} onInput={setNName} placeholder="e.g. Kerala trip" error={fieldError(issues, 'name')} autoFocus />
          <div class="form-row">
            <SelectField label="Kind" value={nKind} onChange={(v) => setNKind(v as GoalKind)} options={GOAL_KINDS} />
            <MoneyField label="Target amount" value={nTarget} onChange={setNTarget} error={fieldError(issues, 'targetAmount')} />
          </div>
          <div class="form-row">
            <DateField label="Target date (optional)" value={nDate} onChange={setNDate} />
            <TextField label="Location (optional)" value={nLoc} onInput={setNLoc} />
          </div>
        </div>
      )}
      <Segmented label="Set aside or release" value={release} onChange={changeMode} options={[{ value: 'add', label: 'Set aside' }, { value: 'release', label: 'Release back' }]} />
      <AllocationLines db={db} mode={release} goalId={goal && goal !== NEW ? goal : undefined} lines={lines} setLines={setLines} />
      {fieldError(issues, 'amount') && <p class="err" role="alert">{fieldError(issues, 'amount')}</p>}
      {fieldError(issues, 'source') && <p class="err" role="alert">{fieldError(issues, 'source')}</p>}
      <div class="qa-stats" aria-live="polite">
        <span>Free to set aside (all sources)</span><b class={ov.totalFree < 0 ? 'neg-warn' : ''}>{formatMoney(ov.totalFree)}</b>
        <span>Already set aside for goals</span><b>{formatMoney(ov.totalAllocated)}</b>
      </div>
      <div class="field"><span class="qa-label">Whose contribution</span><Segmented label="Owner" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
      <DateField label="Date" value={date} onChange={setDate} />
      <ErrorSummary issues={issues} known={['goal', 'goalId', 'amount', 'name', 'targetAmount', 'source']} />
      <div class="qa-bar"><span class="qa-spacer" /><Button type="submit" variant="primary" disabled={busy}>{release === 'add' ? `Set aside${total ? ' ' + formatMoney(total) : ''}` : 'Release'}</Button></div>
    </FormShell>
  );
}
