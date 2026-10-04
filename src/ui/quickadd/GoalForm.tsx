import { useState } from 'preact/hooks';
import type { Issue } from '../../domain/ledger';
import { unallocatedLiquid } from '../../domain/goals';
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
  const [amount, setAmount] = useState<number | undefined>();
  const [release, setRelease] = useState<'add' | 'release'>('add');
  const [date, setDate] = useState(store.today());
  const [owner, setOwner] = useState<OwnerId>(goals.length === 1 ? goals[0].ownerId : defaultOwner(db, scope));
  const [nName, setNName] = useState(''); const [nKind, setNKind] = useState<GoalKind>('trip'); const [nTarget, setNTarget] = useState<number | undefined>();
  const [nDate, setNDate] = useState(''); const [nLoc, setNLoc] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]); const [busy, setBusy] = useState(false);

  const pick = (v: string) => { setGoal(v); const g = goals.find((x) => x.id === v); if (g) setOwner(g.ownerId); };
  const u = unallocatedLiquid(db, scope);
  const signed = (amount ?? 0) * (release === 'release' ? -1 : 1);
  const after = u.unallocated - signed;

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
      const r = await store.addAllocation({ goalId, date, amount: signed, ownerId: owner });
      if (r.ok) { toast(release === 'release' ? 'Released from goal' : 'Set aside for goal'); onClose(); }
      else { setIssues(r.issues); toast(r.issues[0].message, 'error'); }
    } finally { setBusy(false); }
  };

  return (
    <FormShell onSubmit={submit}>
      <Note tone="good">Setting money aside is a plan, not a transfer — your balances don’t change.</Note>
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
      <Segmented label="Set aside or release" value={release} onChange={setRelease} options={[{ value: 'add', label: 'Set aside' }, { value: 'release', label: 'Release back' }]} />
      <MoneyField label={release === 'add' ? 'Amount to set aside' : 'Amount to release'} big autoFocus={goal !== NEW} value={amount} onChange={setAmount} error={fieldError(issues, 'amount')} />
      <div class="qa-stats" aria-live="polite">
        <span>Unallocated cash now</span><b class={u.unallocated < 0 ? 'neg-warn' : ''}>{formatMoney(u.unallocated)}</b>
        {amount ? <><span>After this</span><b class={after < 0 ? 'neg-warn' : ''}>{formatMoney(after)}</b></> : null}
      </div>
      {after < 0 && signed > 0 && <Note tone="warn">This takes your set-aside money above the cash you currently hold in bank, cash and wallets ({formatMoney(u.liquid)}). That’s allowed — it’s only a plan — but it may be worth checking.</Note>}
      <div class="field"><span class="qa-label">Whose contribution</span><Segmented label="Owner" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
      <DateField label="Date" value={date} onChange={setDate} />
      <ErrorSummary issues={issues} known={['goal', 'goalId', 'amount', 'name', 'targetAmount']} />
      <div class="qa-bar"><span class="qa-spacer" /><Button type="submit" variant="primary" disabled={busy}>{release === 'add' ? 'Set aside' : 'Release'}</Button></div>
    </FormShell>
  );
}
