import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Disclosure, MoneyField, Segmented, Sheet, Stat, TextField, FormErrors } from '../../kit';
import { BarChart } from '../../kit/charts';
import { useAction, useDb, useScope, useStore, personName } from '../../state';
import { formatMoney, monthLabel } from '../../format';
import { addMonthsKey, monthOf } from '../../../domain/dates';
import { compareMonth, monthlySeries, projectMonthEnd, scopedTxns, summarizeMonth, type MonthSummary } from '../../../domain/cashflow';
import './plan.css';

const rm = (p: number) => formatMoney(Math.round(p / 100) * 100);
const pctText = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${Math.round(p)}%`);

export default function Savings() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today(); const month = monthOf(today);
  const txns = scopedTxns(db, scope);
  const cur = summarizeMonth(txns, month);
  const proj = projectMonthEnd(db, scope, month, today);
  const [view, setView] = useState<'flow' | 'savings'>('flow');
  const [editTargets, setEditTargets] = useState(false);
  const note = db.settings.monthNotes[month] ?? '';
  const [draft, setDraft] = useState(note);
  const { run, busy } = useAction();

  const series = monthlySeries(txns, addMonthsKey(month, -5), month);
  const lab = (s: MonthSummary) => monthLabel(s.month).split(' ')[0];
  const kept = cur.income - cur.spending - cur.invested - cur.debtPaydown;
  const hasData = txns.length > 0;
  const who = scope === 'household' ? 'household' : personName(db, scope);

  const cmps = [
    { label: 'Income', c: compareMonth(txns, month, (s) => s.income) },
    { label: 'Spending', c: compareMonth(txns, month, (s) => s.spending) },
    { label: 'Savings', c: compareMonth(txns, month, (s) => s.savings) },
  ];
  const saveNote = () => run(() => store.updateSettings({ monthNotes: { ...db.settings.monthNotes, [month]: draft.trim() } }), 'Note saved');

  return (<>
    <Card title={`${monthLabel(month, true)} so far`} action={<Badge tone="muted">{who}</Badge>}>
      {!hasData && <Banner>Nothing recorded yet for {who}. Add an income or expense and this page fills in on its own.</Banner>}
      <div class="px-stats px-stats-4">
        <Stat label="Income" value={formatMoney(cur.income)} />
        <Stat label="Spending" value={formatMoney(cur.spending)} hint="Only real spending: transfers, investments and loan principal are not counted." />
        <Stat label="Saved so far" value={formatMoney(cur.savings)} tone={cur.savings >= 0 ? 'good' : 'warn'} sub="income − spending" />
        <Stat label="Savings rate" value={cur.income > 0 ? `${Math.round(cur.savingsRate)}%` : '—'} sub="of income" />
      </div>
    </Card>

    <Card title="Where this month is heading" tone="soft" action={<Badge tone="info">Estimate</Badge>}>
      <div class="px-stats">
        <Stat label="Projected month-end savings" value={rm(proj.projectedSavings)} tone={proj.onTrack ? 'good' : undefined} />
        <Stat label={`Target${scope === 'household' ? '' : ' (personal)'}`} value={formatMoney(proj.target)} sub={proj.minimum !== null ? `Comfortable minimum ${formatMoney(proj.minimum)}` : undefined} />
      </div>
      {proj.onTrack
        ? <Banner tone="good">On track. If the rest of the month looks like the picture so far, you would finish about {rm(-proj.gap)} above target.</Banner>
        : <Banner>About {rm(proj.gap)} below target at the current pace. A lower-saving month is not a failure — festivals, travel and one-off costs are part of real life, and this can still move before month-end.</Banner>}
      <Disclosure summary="How this estimate works">
        <ul class="px-list">
          {proj.assumptions.map((a) => <li key={a}>{a}</li>)}
          {proj.expectedIncomeRemaining > 0 && <li>Expected income still to arrive: {formatMoney(proj.expectedIncomeRemaining)}.</li>}
          {proj.expectedFixedRemaining > 0 && <li>Expected bills and subscriptions still to come: {formatMoney(proj.expectedFixedRemaining)}.</li>}
          {proj.variableRemaining > 0 && <li>Day-to-day spending for the rest of the month: about {rm(proj.variableRemaining)} ({rm(proj.variableDailyPace)} a day).</li>}
        </ul>
      </Disclosure>
    </Card>

    <Card title="What's special about this month?">
      <p class="px-sub" style={{ margin: 0 }}>A short note helps future-you read the numbers kindly — for example “Durga Puja”, “family trip” or “one-off repair”.</p>
      <div class="px-note-edit">
        <TextField label="Month note" value={draft} onInput={setDraft} placeholder="e.g. Durga Puja shopping" maxLength={120} />
        <Button variant="primary" disabled={busy || draft.trim() === note} onClick={saveNote}>Save</Button>
      </div>
    </Card>

    <Card title="Where the money went">
      <div class="px-flow">
        <div class="px-flow-row"><span>Spent</span><b>{formatMoney(cur.spending)}</b><span class="px-sub">Everyday and one-off spending this month.</span></div>
        <div class="px-flow-row"><span>Invested</span><b>{formatMoney(cur.invested)}</b><span class="px-sub">Moved into SIPs, funds, gold etc. This is not spending — it is still yours.</span></div>
        <div class="px-flow-row"><span>Debt principal paid</span><b>{formatMoney(cur.debtPaydown)}</b><span class="px-sub">The part of loan payments that reduces what you owe (interest counts as spending).</span></div>
        <div class="px-flow-row"><span>Kept as cash</span><b>{formatMoney(kept)}</b><span class="px-sub">What is left of this month’s income after the three above.</span></div>
      </div>
    </Card>

    <Card title="How does this compare?">
      <table class="px-cmp">
        <thead><tr><th scope="col"> </th><th scope="col">This month</th><th scope="col">Last month</th><th scope="col">3-mo avg</th></tr></thead>
        <tbody>{cmps.map(({ label, c }) => (
          <tr key={label}><td>{label}</td><td>{formatMoney(c.current)}</td><td>{formatMoney(c.previous)}<div class="px-sub">{pctText(c.vsPrevPct)}</div></td><td>{formatMoney(c.average)}<div class="px-sub">{pctText(c.vsAvgPct)}</div></td></tr>
        ))}</tbody>
      </table>
      <p class="px-summary">This month is still in progress, so it is naturally lower than finished months until the end.</p>
    </Card>

    <Card title="Last six months" action={<Segmented label="Chart view" value={view} onChange={setView} options={[{ value: 'flow', label: 'Income vs spend' }, { value: 'savings', label: 'Savings' }]} />}>
      {view === 'flow'
        ? <BarChart data={series.map((s) => ({ label: lab(s), value: s.income, value2: s.spending }))} legend={['Income', 'Spending']} summary={`Income and spending for the last six months. ${series.map((s) => `${monthLabel(s.month)}: income ${formatMoney(s.income)}, spending ${formatMoney(s.spending)}`).join('; ')}.`} />
        : <BarChart data={series.map((s) => ({ label: lab(s), value: Math.max(0, s.savings) }))} target={proj.target > 0 ? proj.target : undefined} summary={`Savings for the last six months against a ${formatMoney(proj.target)} target. ${series.map((s) => `${monthLabel(s.month)}: ${formatMoney(s.savings)}`).join('; ')}.`} />}
      <p class="px-summary">
        {(() => { const done = series.slice(0, -1); const avg = done.length ? Math.round(done.reduce((a, s) => a + s.savings, 0) / done.length) : 0; return `Finished months averaged ${rm(avg)} saved. Months below zero are drawn as empty bars.`; })()}
      </p>
    </Card>

    <Card title="Monthly savings targets" action={<Button size="sm" onClick={() => setEditTargets(true)}>Edit</Button>}>
      <dl class="kv">
        <dt>Household target</dt><dd>{formatMoney(db.settings.householdSavingsTarget)}</dd>
        <dt>Household comfortable minimum</dt><dd>{formatMoney(db.settings.householdSavingsMinimum)}</dd>
        {db.settings.people.map((p) => (<><dt key={p.id + 'l'}>{p.name} (personal)</dt><dd key={p.id}>{formatMoney(p.savingsTarget)}</dd></>))}
      </dl>
      <p class="px-sub" style={{ margin: 0 }}>The household total is what matters most. Personal targets are just a way to think about each person’s share.</p>
    </Card>
    {editTargets && <TargetsSheet onClose={() => setEditTargets(false)} />}
  </>);
}

function TargetsSheet({ onClose }: { onClose: () => void }) {
  const db = useDb(); const store = useStore(); const { run, busy } = useAction();
  const s = db.settings;
  const [target, setTarget] = useState<number | undefined>(s.householdSavingsTarget);
  const [min, setMin] = useState<number | undefined>(s.householdSavingsMinimum);
  const [ppl, setPpl] = useState<Record<string, number | undefined>>(Object.fromEntries(s.people.map((p) => [p.id, p.savingsTarget])));
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const save = async () => {
    if (target === undefined || min === undefined) { setIssues([{ field: '_', message: 'Please enter both household amounts.' }]); return; }
    if (min > target) { setIssues([{ field: '_', message: 'The comfortable minimum should not be higher than the target.' }]); return; }
    const ok = await run(() => store.updateSettings({ householdSavingsTarget: target, householdSavingsMinimum: min, people: s.people.map((p) => ({ ...p, savingsTarget: ppl[p.id] ?? p.savingsTarget })) }), 'Targets saved');
    if (ok) onClose();
  };
  return (
    <Sheet title="Monthly savings targets" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>Save</Button></>}>
      <div class="px-form">
        <FormErrors issues={issues} />
        <MoneyField label="Household target (ideal)" value={target} onChange={setTarget} />
        <MoneyField label="Household comfortable minimum" value={min} onChange={setMin} hint="The lowest amount you’d still be happy with." />
        {s.people.map((p) => <MoneyField key={p.id} label={`${p.name} — personal target`} value={ppl[p.id]} onChange={(v) => setPpl({ ...ppl, [p.id]: v })} />)}
      </div>
    </Sheet>
  );
}
