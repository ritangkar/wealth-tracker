import { useState } from 'preact/hooks';
import { monthlySeries, monthTxns, projectMonthEnd, scopedTxns, spendingByCategory, summarizeMonth, compareMonth } from '../../domain/cashflow';
import { goalProgress, goalsInScope } from '../../domain/goals';
import { generateInsights } from '../../domain/insights';
import { debtOverview } from '../../domain/liabilities';
import { computeNetWorth, snapshotSeries } from '../../domain/networth';
import { upcomingCommitments, type Commitment } from '../../domain/expected';
import { addDays, addMonthsKey, monthOf } from '../../domain/dates';
import { inScope } from '../../domain/scope';
import { wasteMonth, WASTE_LABELS } from '../../domain/waste';
import { Badge, Banner, Button, Card, Disclosure, EmptyState, Page, Progress, Row, Stat, TextField } from '../kit';
import { BarChart, Breakdown, LineChart } from '../kit/charts';
import { formatCompact, formatDate, formatMoney, monthLabel } from '../format';
import { navigate } from '../router';
import { openQuickAdd, personName, toast, useAction, useDb, useScope, useStore } from '../state';
import './home-activity.css';

const shortDate = (d: string) => formatDate(d).replace(/ \d{4}$/, '');

export default function Home() {
  const store = useStore(); const db = useDb(); const [scope] = useScope();
  const today = store.today(); const month = monthOf(today);

  if (db.accounts.length === 0) {
    return (
      <Page title="Home">
        <Card>
          <EmptyState title="Welcome to Wealth OS" body="Add your accounts first — bank, cash, cards and anything you invest in. Everything stays on this device. It takes about a minute, and then Home will show where you stand."
            action={<a class="btn btn-primary" href="#/welcome">Get started</a>} />
        </Card>
      </Page>
    );
  }

  const txns = scopedTxns(db, scope);
  const nw = computeNetWorth(db, scope);
  const series = snapshotSeries(db, scope);
  const sum = summarizeMonth(txns, month);
  const proj = projectMonthEnd(db, scope, month, today);
  const spendCmp = compareMonth(txns, month, (s) => s.spending);
  const cats = spendingByCategory(db, monthTxns(txns, month));
  const insights = generateInsights(db, scope, today).slice(0, 3);
  const upcoming = upcomingCommitments(db, scope, today, addDays(today, 14), today);
  const goals = goalsInScope(db, scope).filter((g) => g.status === 'active').map((g) => goalProgress(db, g, today)).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const debt = debtOverview({ transactions: db.transactions, liabilities: db.liabilities.filter((l) => inScope(l.ownerId, scope)) }, today);
  const waste = wasteMonth(db, scope, month);
  const six = monthlySeries(txns, addMonthsKey(month, -5), month);
  const hasMonthData = sum.txnCount > 0;

  return (
    <Page title="Home" subtitle={`${personName(db, scope)} · ${monthLabel(month, true)}`}>
      {!hasMonthData && <Banner tone="info" action={<Button size="sm" variant="primary" onClick={() => openQuickAdd('expense')}>Add expense</Button>}>Nothing recorded yet this month. Add an expense or income and this page fills in.</Banner>}

      <div class="cols cols-2">
        <Card class="home-hero" tone="accent">
          <div class="home-hero-top">
            <div><div class="muted">Net worth</div><div class="hero" aria-label={`Net worth ${formatMoney(nw.net)}`}>{formatMoney(nw.net)}</div></div>
            <a href="#/wealth">Details ›</a>
          </div>
          <div class="home-sub">
            <span>Assets <b>{formatCompact(nw.assets.total)}</b></span>
            <span>Liabilities <b>{formatCompact(nw.liabilities.total)}</b></span>
            <span>Cash &amp; bank <b>{formatCompact(nw.liquid)}</b></span>
          </div>
          {series.length >= 2 && <LineChart data={series.map((s) => ({ label: shortDate(s.date), value: s.net }))} zeroLine={false}
            summary={`Net worth trend: ${formatMoney(series[0].net)} on ${shortDate(series[0].date)} to ${formatMoney(series[series.length - 1].net)} on ${shortDate(series[series.length - 1].date)}.`} />}
        </Card>

        <MonthCard month={month} sum={sum} proj={proj} spendCmp={spendCmp} />
      </div>

      <div class="cols cols-2">
        <Card title="Where the money is going" action={<a href={`#/activity?month=${month}&type=expense`}>See all</a>}>
          {cats.length ? (
            <Breakdown items={cats.map((c) => ({ label: c.label, value: c.amount }))}
              onSelect={(label) => { const c = cats.find((x) => x.label === label); navigate(c ? `/activity?month=${month}&cat=${c.key}` : `/activity?month=${month}&type=expense`); }} />
          ) : <p class="muted">No spending recorded this month yet.</p>}
        </Card>

        <Card title="Coming up · next 14 days" action={<a href="#/plan?tab=upcoming">Review all</a>}>
          {upcoming.length ? upcoming.slice(0, 5).map((c) => <DueRow key={`${c.kind}${c.refId}${c.date}`} c={c} today={today} />)
            : <p class="muted">Nothing due in the next two weeks. Add subscriptions, bills and EMIs under Plan so they show up here.</p>}
          {upcoming.length > 5 && <a href="#/plan?tab=upcoming">+ {upcoming.length - 5} more</a>}
        </Card>
      </div>

      {insights.length > 0 && (
        <Card title="Worth a look" action={<a href="#/insights">All insights</a>}>
          {insights.map((i) => (
            <div key={i.id} class={`insight insight-${i.tone === 'positive' ? 'positive' : i.tone === 'note' || i.tone === 'attention' ? 'note' : 'info'}`}>
              <div class="insight-title">{i.title} {i.estimate && <Badge tone="info">estimate</Badge>}</div>
              <div class="muted">{i.body}</div>
              {i.link && <a href={i.link}>Details ›</a>}
            </div>
          ))}
        </Card>
      )}

      <h2 class="home-more-title">More about your money</h2>
      <div class="cols cols-2">
        <Card title="Income vs spending · 6 months">
          <BarChart data={six.map((m) => ({ label: monthLabel(m.month), value: m.income, value2: m.spending }))} legend={['Income', 'Spending']}
            summary={`Income and spending for the last six months. ${six.map((m) => `${monthLabel(m.month)}: income ${formatMoney(m.income)}, spending ${formatMoney(m.spending)}`).join('; ')}.`} />
        </Card>

        <Card title="Goals" action={<a href="#/plan?tab=goals">All goals</a>}>
          {goals.length ? goals.map((g) => (
            <div key={g.goal.id}>
              <Row title={g.goal.name} sub={`${formatMoney(g.allocated)} of ${formatMoney(g.target)}`} right={`${Math.round(g.pct)}%`} href="#/plan?tab=goals" />
              <Progress pct={g.pct} label={`${g.goal.name} progress`} tone={g.achieved ? 'good' : undefined} />
            </div>
          )) : (
            <div><p class="muted">No goals yet. Setting money aside for a trip, a home or an emergency fund makes progress visible.</p>
              <Button size="sm" onClick={() => openQuickAdd('goal')}>Set a goal</Button></div>
          )}
        </Card>

        <Card title="Debt" action={<a href="#/debt">Cards, EMIs &amp; loans</a>}>
          {debt.totalDebt + nw.liabilities.cards > 0 ? (
            <>
              <div class="grid">
                <Stat label="Loans outstanding" value={formatCompact(debt.totalDebt)} />
                <Stat label="Card outstanding" value={formatCompact(nw.liabilities.cards)} />
                <Stat label="Loan EMIs / month" value={formatCompact(debt.monthlyCommitment)} />
                <Stat label="Debt-free (estimate)" value={debt.projectedDebtFree ? monthLabel(debt.projectedDebtFree.slice(0, 7)) : '—'} sub={debt.debtFreeUnknown ? 'Needs an EMI on each loan' : undefined} />
              </div>
            </>
          ) : <p class="muted">No loans or card balances to show. Lovely.</p>}
        </Card>

        <Card title="Waste this month" action={<a href="#/waste">Waste log</a>}>
          {waste.count ? (
            <>
              <Stat label={`${waste.count} item${waste.count > 1 ? 's' : ''} logged`} value={formatMoney(waste.total)}
                sub={waste.byCategory[0] ? `Mostly ${WASTE_LABELS[waste.byCategory[0].category].toLowerCase()}${waste.topItems[0] ? ` · ${waste.topItems[0].item} most often` : ''}` : undefined} />
              <p class="hint">Not counted as spending — it’s just awareness of money that didn’t get used.</p>
            </>
          ) : (
            <div><p class="muted">Nothing logged this month. Noting spoiled or unused things (no guilt!) shows where small savings hide.</p>
              <Button size="sm" onClick={() => openQuickAdd('waste')}>Log waste</Button></div>
          )}
        </Card>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- this month
function MonthCard({ month, sum, proj, spendCmp }: { month: string; sum: ReturnType<typeof summarizeMonth>; proj: ReturnType<typeof projectMonthEnd>; spendCmp: ReturnType<typeof compareMonth> }) {
  const store = useStore(); const db = useDb(); const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const note = db.settings.monthNotes[month];
  const known = proj.actualIncome > 0 || proj.expectedIncomeRemaining > 0;

  const saveNote = async () => {
    const next = { ...db.settings.monthNotes }; const t = text.trim();
    if (t) next[month] = t; else delete next[month];
    const r = await run(() => store.updateSettings({ monthNotes: next }), t ? 'Note saved' : 'Note removed');
    if (r) setEditing(false);
  };

  const pctOfTarget = proj.target > 0 ? (Math.max(0, sum.savings) / proj.target) * 100 : 0;
  const belowMin = proj.minimum !== null && proj.projectedSavings < proj.minimum;

  return (
    <Card title="Are we saving enough?" action={<a href="#/plan">Plan</a>}>
      <div class="home-month-stats">
        <Stat label="Income" value={formatCompact(sum.income)} tone="good" />
        <Stat label="Spending" value={formatCompact(sum.spending)} />
        <Stat label="Saved so far" value={formatCompact(sum.savings)} tone={sum.savings < 0 ? 'warn' : undefined} />
      </div>
      <div class="home-proj" role="group" aria-label="Month-end projection">
        {known || sum.spending > 0 ? (
          <>
            <div class="home-proj-line"><span class="muted">Projected month-end savings <Badge tone="info">estimate</Badge></span><b>{formatMoney(proj.projectedSavings)}</b></div>
            <Progress pct={pctOfTarget} label="Savings so far against target" tone={proj.onTrack ? 'good' : undefined} />
            <div class="hint">
              {proj.onTrack
                ? `On track — about ${formatMoney(-proj.gap)} above your ${formatMoney(proj.target)} target.`
                : `About ${formatMoney(proj.gap)} short of your ${formatMoney(proj.target)} target${belowMin ? ', and below your minimum of ' + formatMoney(proj.minimum ?? 0) : ''}. It’s a projection, not a verdict — plenty of the month can still change.`}
            </div>
          </>
        ) : <div class="muted">Once you add this month’s income and spending, we’ll estimate where you’ll land against your {formatMoney(proj.target)} savings target.</div>}
      </div>

      {spendCmp.previous > 0 && (
        <div class="home-cmp">
          Spending so far {formatMoney(sum.spending)} · last month in full {formatMoney(spendCmp.previous)}
          {spendCmp.average > 0 && <> · 3-month average {formatMoney(spendCmp.average)}</>}
        </div>
      )}

      {editing ? (
        <div class="home-note-edit">
          <TextField label={`Note for ${monthLabel(month, true)}`} value={text} onInput={setText} placeholder="e.g. Durga Puja, wedding season" maxLength={80} autoFocus />
          <Button variant="primary" size="sm" disabled={busy} onClick={saveNote}>Save</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : (
        <div class="home-note">
          {note ? <><Badge tone="warn">Month note</Badge><span>{note}</span><Button variant="ghost" size="sm" onClick={() => { setText(note); setEditing(true); }}>Edit</Button></>
            : <Button variant="ghost" size="sm" onClick={() => { setText(''); setEditing(true); }}>+ Add a note for this month (e.g. Durga Puja)</Button>}
        </div>
      )}

      <Disclosure summary="How we estimate this">
        <ul class="assume-list">{proj.assumptions.map((a) => <li key={a} class="hint">{a}</li>)}</ul>
        <div class="hint">
          So far: {formatMoney(proj.actualIncome)} income, {formatMoney(proj.actualSpending)} spending.
          {proj.expectedIncomeRemaining > 0 && <> Expected income still to come: {formatMoney(proj.expectedIncomeRemaining)}.</>}
          {proj.expectedFixedRemaining > 0 && <> Expected bills &amp; subscriptions: {formatMoney(proj.expectedFixedRemaining)}.</>}
          {proj.variableRemaining > 0 && <> Day-to-day spending for the rest of the month: about {formatMoney(proj.variableRemaining)}.</>}
        </div>
      </Disclosure>
    </Card>
  );
}

// ---------------------------------------------------------------- upcoming
function DueRow({ c, today }: { c: Commitment; today: string }) {
  const store = useStore(); const { run, busy } = useAction();
  const kindLabel = c.kind === 'emi' ? 'Card EMI' : c.kind === 'loan' ? 'Loan EMI' : 'Due';
  const act = async () => {
    if (c.kind === 'expected') await run(() => store.confirmOccurrence(c.refId, c.date), `${c.name} confirmed`);
    else if (c.kind === 'emi') await run(() => store.confirmEmiInstalment(c.refId, { dueDate: c.date, date: today }), 'Instalment marked paid');
    else { openQuickAdd('loan'); toast('Pick the loan and record the payment'); }
  };
  const label = c.kind === 'expected' ? 'Confirm' : c.kind === 'emi' ? 'Mark paid' : 'Pay';
  return (
    <div class="home-due">
      <Row title={c.name} sub={<>{kindLabel} · {shortDate(c.date)} {c.overdue && <Badge tone="warn">overdue</Badge>}</>} right={formatMoney(c.amount)} />
      <Button size="sm" disabled={busy} onClick={act} aria-label={`${label} ${c.name}`}>{label}</Button>
    </div>
  );
}
