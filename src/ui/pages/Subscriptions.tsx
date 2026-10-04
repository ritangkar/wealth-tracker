import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, EmptyState, Page, Stat, useConfirm } from '../kit';
import { BarChart } from '../kit/charts';
import { useAction, useDb, useScope, useStore, personName } from '../state';
import { formatDate, formatMoney, monthLabel } from '../format';
import { addDays, addMonthsKey, diffDays, monthOf, monthRange, type ISODate } from '../../domain/dates';
import { monthTxns, scopedTxns, spendingByCategory } from '../../domain/cashflow';
import { occurrenceDates } from '../../domain/expected';
import { inScope } from '../../domain/scope';
import type { ExpectedItem, Frequency } from '../../domain/types';
import { ExpectedFormSheet, FREQ_LABEL } from './plan/ExpectedForm';
import './plan/plan.css';

/** Monthly equivalent of a recurring amount (weekly ×52/12, quarterly ÷3, yearly ÷12). */
const monthlyEquivalent = (amount: number, f: Frequency) => Math.round(f === 'weekly' ? (amount * 52) / 12 : f === 'monthly' ? amount : f === 'quarterly' ? amount / 3 : amount / 12);
const nextCharge = (i: ExpectedItem, today: ISODate) => occurrenceDates(i, today, addDays(today, 400))[0];

export default function Subscriptions() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today(); const month = monthOf(today);
  const [editing, setEditing] = useState<ExpectedItem | 'new' | null>(null);
  const [ask, dialog] = useConfirm(); const { run } = useAction();
  const reviewDays = db.settings.subscriptionReviewDays;

  const all = db.expectedItems.filter((i) => i.kind === 'subscription' && inScope(i.ownerId, scope));
  const active = all.filter((i) => i.status === 'active');
  const stopped = all.filter((i) => i.status !== 'active');
  const monthly = active.reduce((s, i) => s + monthlyEquivalent(i.amount, i.frequency), 0);
  const needsCheck = (i: ExpectedItem) => i.status === 'active' && diffDays(today, i.lastUsed ?? i.startDate) > reviewDays;

  const txns = scopedTxns(db, scope);
  const trend = monthRange(addMonthsKey(month, -5), month).map((m) => ({ m, v: spendingByCategory(db, monthTxns(txns, m)).find((g) => g.key === 'cat_subscriptions')?.amount ?? 0 }));
  const anyTrend = trend.some((t) => t.v > 0);

  const sorted = [...active].sort((a, b) => monthlyEquivalent(b.amount, b.frequency) - monthlyEquivalent(a.amount, a.frequency));
  const stop = async (i: ExpectedItem) => { if (await ask({ title: `Stop ${i.name}?`, confirmLabel: 'Mark as stopped', body: <p>This only stops the reminder in this app. Remember to cancel it with the provider too, if you haven’t. You can resume it any time.</p> })) await run(() => store.stopExpected(i.id), 'Stopped'); };
  const del = async (i: ExpectedItem) => { if (await ask({ title: `Delete ${i.name}?`, danger: true, confirmLabel: 'Delete', body: <p>Removes this reminder. Past transactions are kept.</p> })) await run(() => store.deleteExpected(i.id), 'Deleted'); };

  const row = (i: ExpectedItem) => {
    const nx = i.status === 'active' ? nextCharge(i, today) : undefined; const check = needsCheck(i);
    return (
      <div class="px-item" key={i.id}>
        <div class="px-head-row">
          <div>
            <div class="row-title">{i.name}</div>
            <div class="px-badges"><Badge>{FREQ_LABEL[i.frequency]}</Badge>{check && <Badge tone="warn">Worth a check</Badge>}{i.status !== 'active' && <Badge tone="muted">Stopped</Badge>}</div>
            <div class="px-sub">{personName(db, i.ownerId)}{nx ? ` · next charge ${formatDate(nx)}` : ''}</div>
            <div class="px-sub">{i.lastUsed ? `Last marked as used ${formatDate(i.lastUsed)}` : 'Not marked as used yet'}</div>
          </div>
          <div style={{ textAlign: 'right' }}><div class="px-item-amt">{formatMoney(i.amount)}</div>{i.frequency !== 'monthly' && <div class="px-sub">≈ {formatMoney(monthlyEquivalent(i.amount, i.frequency))}/mo</div>}</div>
        </div>
        <div class="px-actions">
          {i.status === 'active' && <Button size="sm" variant={check ? 'primary' : 'secondary'} onClick={() => run(() => store.saveExpected({ ...stripStamps(i), lastUsed: today }, i.id), `Noted — still using ${i.name}`)}>Still using</Button>}
          <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>Edit</Button>
          {i.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => stop(i)}>Stop</Button> : <Button size="sm" variant="ghost" onClick={() => run(() => store.stopExpected(i.id, true), 'Resumed')}>Resume</Button>}
          <Button size="sm" variant="ghost" onClick={() => del(i)}>Delete</Button>
        </div>
      </div>
    );
  };

  return (
    <Page title="Subscriptions" subtitle="Recurring services you pay for" actions={<Button variant="primary" onClick={() => setEditing('new')}>+ Add</Button>}>
      <div class="px-panel" style={{ marginTop: 0 }}>
        <Card title="What they add up to">
          <div class="px-stats px-stats-4">
            <Stat label="Per month" value={formatMoney(monthly)} sub="all frequencies, converted" />
            <Stat label="Per year" value={formatMoney(monthly * 12)} sub="monthly × 12" />
            <Stat label="Active" value={String(active.length)} />
            <Stat label="Worth a check" value={String(active.filter(needsCheck).length)} sub={`not marked used in ${reviewDays}+ days`} />
          </div>
          <p class="px-sub" style={{ margin: 0 }}>A subscription is never “wasteful” just because it exists. The “worth a check” label only appears when you haven’t tapped “Still using” for {reviewDays} days — change that in Insights → Tune.</p>
        </Card>

        {!all.length && (
          <Card><EmptyState title="No subscriptions yet" body="Add the services you pay for — for example YouTube Premium, Amazon Prime, Netflix, Sony LIV, JioHotstar or FanCode. We’ll total them up and gently remind you to review." action={<Button variant="primary" onClick={() => setEditing('new')}>Add a subscription</Button>} /></Card>
        )}

        {active.some(needsCheck) && <Banner tone="info">Some subscriptions haven’t been marked as used for a while. Tap “Still using” on the ones you enjoy and the label goes away.</Banner>}
        {sorted.length > 0 && <Card title="Active">{sorted.map(row)}</Card>}
        {stopped.length > 0 && <Card title="Stopped">{stopped.map(row)}</Card>}

        <Card title="What did subscriptions actually cost?">
          {anyTrend ? (<>
            <BarChart data={trend.map((t) => ({ label: monthLabel(t.m).split(' ')[0], value: t.v }))} summary={`Subscription-category spending, last six months. ${trend.map((t) => `${monthLabel(t.m)}: ${formatMoney(t.v)}`).join('; ')}.`} />
            <p class="px-summary">Real transactions in the Subscriptions category, last six months. This can differ from the list above if some charges weren’t recorded.</p>
          </>) : <p class="muted" style={{ margin: 0 }}>No spending in the Subscriptions category yet. Confirm charges from Plan → Upcoming, or log expenses under Subscriptions, to see this fill in.</p>}
        </Card>
      </div>
      {editing && <ExpectedFormSheet item={editing === 'new' ? undefined : editing} defaultKind="subscription" lockKind onClose={() => setEditing(null)} />}
      {dialog}
    </Page>
  );
}
function stripStamps(i: ExpectedItem) { const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = i; void _i; void _c; void _u; return rest; }
