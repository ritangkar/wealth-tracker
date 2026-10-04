import { useState } from 'preact/hooks';
import { Badge, Card, EmptyState, Progress, Row, SelectField, Stat } from '../../kit';
import { BarChart, Breakdown } from '../../kit/charts';
import { useDb, useScope, useStore, personName } from '../../state';
import { PAYMENT_LABELS, accountName, formatMoney, monthLabel } from '../../format';
import { addMonthsKey, monthOf, monthRange, type MonthKey } from '../../../domain/dates';
import { compareMonth, groupSpending, monthTxns, normMerchant, scopedTxns, spendingByCategory, topCategoryId, type Group } from '../../../domain/cashflow';
import { spendingOf } from '../../../domain/ledger';
import type { Database, Transaction } from '../../../domain/types';
import { MonthNav } from '../plan/MonthNav';
import '../plan/plan.css';

type By = 'category' | 'subcategory' | 'merchant' | 'person' | 'account' | 'method';
const BY: { value: By; label: string }[] = [
  { value: 'category', label: 'Category' }, { value: 'subcategory', label: 'Subcategory' }, { value: 'merchant', label: 'Merchant' },
  { value: 'person', label: 'Person' }, { value: 'account', label: 'Account' }, { value: 'method', label: 'Payment method' },
];

function groupsFor(db: Database, txns: Transaction[], by: By): Group[] {
  switch (by) {
    case 'category': return spendingByCategory(db, txns);
    case 'subcategory': return spendingByCategory(db, txns, true);
    case 'merchant': return groupSpending(txns, (t) => { const m = normMerchant(t.merchant); return { key: m.toLowerCase() || '_', label: m || 'No merchant noted' }; });
    case 'person': return groupSpending(txns, (t) => ({ key: t.ownerId, label: t.ownerId === 'hh' ? 'Joint / household' : personName(db, t.ownerId) }));
    case 'account': return groupSpending(txns, (t) => ({ key: t.fromAccountId ?? '_', label: t.fromAccountId ? accountName(db, t.fromAccountId) : 'No account' }));
    case 'method': return groupSpending(txns, (t) => ({ key: t.paymentMethod ?? '_', label: t.paymentMethod ? PAYMENT_LABELS[t.paymentMethod] : 'Not noted' }));
  }
}
const sumSpend = (txns: Transaction[], f: (t: Transaction) => boolean) => txns.filter(f).reduce((s, t) => s + spendingOf(t), 0);
const countSpend = (txns: Transaction[], f: (t: Transaction) => boolean) => txns.filter((t) => f(t) && spendingOf(t) > 0).length;
const pctText = (p: number | null) => (p === null ? 'no earlier data' : `${p > 0 ? '+' : ''}${Math.round(p)}%`);
const short = (m: MonthKey) => monthLabel(m).split(' ')[0];

export default function Spending() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const thisMonth = monthOf(store.today());
  const [month, setMonth] = useState<MonthKey>(thisMonth);
  const [by, setBy] = useState<By>('category');
  const s = db.settings;
  const all = scopedTxns(db, scope);
  const cur = monthTxns(all, month);
  const prevKey = addMonthsKey(month, -1);
  const prevGroups = new Map(groupsFor(db, monthTxns(all, prevKey), by).map((g) => [g.key, g.amount]));
  const groups = groupsFor(db, cur, by);
  const total = groups.reduce((a, g) => a + g.amount, 0);
  const cmp = compareMonth(all, month, (x) => x.spending);
  const months6 = monthRange(addMonthsKey(month, -5), month);

  // specific lenses
  const delivery = (t: Transaction) => t.subcategoryId === 'sub_delivery';
  const deliveryCount = countSpend(cur, delivery); const deliveryTotal = sumSpend(cur, delivery);
  const deliveryTrend = months6.map((m) => ({ label: short(m), value: sumSpend(monthTxns(all, m), delivery) }));
  const transport = sumSpend(cur, (t) => topCategoryId(t, db.categories) === 'cat_transport');
  const shop = (t: Transaction) => topCategoryId(t, db.categories) === 'cat_shopping';
  const amazon = (t: Transaction) => /amazon/i.test(t.merchant ?? '');
  const online = sumSpend(cur, (t) => t.subcategoryId === 'sub_online_grocery'); const local = sumSpend(cur, (t) => t.subcategoryId === 'sub_local_market');
  const onlineN = countSpend(cur, (t) => t.subcategoryId === 'sub_online_grocery'); const localN = countSpend(cur, (t) => t.subcategoryId === 'sub_local_market');

  // unusual spikes against prior 3-month average, using your Tune settings
  const priorMonths = [1, 2, 3].map((k) => addMonthsKey(month, -k)).filter((k) => all.some((t) => monthOf(t.date) === k));
  const spikes = priorMonths.length ? spendingByCategory(db, cur.filter((t) => !t.oneOff)).map((g) => {
    const avg = Math.round(priorMonths.reduce((a, k) => a + (spendingByCategory(db, monthTxns(all, k).filter((t) => !t.oneOff)).find((x) => x.key === g.key)?.amount ?? 0), 0) / priorMonths.length);
    return { ...g, avg };
  }).filter((g) => g.avg > 0 && g.amount >= g.avg * s.spikeFactor && g.amount - g.avg >= s.spikeMinimum) : [];

  const who = scope === 'household' ? groupsFor(db, cur, 'person') : [];

  return (<>
    <MonthNav month={month} onChange={setMonth} max={thisMonth} />
    <Card title="Compared with before">
      <div class="px-stats">
        <Stat label="This month" value={formatMoney(cmp.current)} />
        <Stat label="Last month" value={formatMoney(cmp.previous)} sub={pctText(cmp.vsPrevPct)} />
        <Stat label="3-month average" value={formatMoney(cmp.average)} sub={pctText(cmp.vsAvgPct)} />
      </div>
      <p class="px-summary">{month === thisMonth ? 'This month is still in progress, so it usually looks lower until the end.' : 'A finished month compared with the months before it.'} Spending counts real expenses only.</p>
    </Card>

    <Card title="Where did it go?">
      <SelectField label="Group by" value={by} onChange={setBy} options={BY} />
      {!groups.length ? <EmptyState title="No spending this month" body="Pick another month, or add an expense." /> : (<>
        <Breakdown items={groups.map((g) => ({ label: g.label, value: g.amount }))} total={total} />
        <div class="px-list-rows">
          {groups.map((g) => (
            <Row key={g.key} title={g.label} sub={`${g.count} ${g.count === 1 ? 'purchase' : 'purchases'} · ${Math.round((g.amount / total) * 100)}% · last month ${formatMoney(prevGroups.get(g.key) ?? 0)}`} right={formatMoney(g.amount)} />
          ))}
        </div>
      </>)}
    </Card>

    {who.length > 1 && <Card title="Who spent what?"><Breakdown items={who.map((g) => ({ label: g.label, value: g.amount }))} total={total} /><p class="px-summary">By the person recorded on each expense — useful context, not a scoreboard.</p></Card>}

    <Card title="How often do we order food in?">
      <div class="px-stats"><Stat label="Orders" value={String(deliveryCount)} /><Stat label="Total" value={formatMoney(deliveryTotal)} sub={deliveryCount ? `about ${formatMoney(Math.round(deliveryTotal / deliveryCount))} each` : undefined} /></div>
      {deliveryTrend.some((d) => d.value > 0) ? <BarChart data={deliveryTrend} summary={`Food delivery spending, six months: ${deliveryTrend.map((d) => `${d.label} ${formatMoney(d.value)}`).join(', ')}.`} /> : <p class="px-summary">No food-delivery spending recorded in these months (needs the “Food delivery” subcategory).</p>}
    </Card>

    <Card title="Is transport within our comfort level?">
      <div class="px-meter"><div class="row-title">{formatMoney(transport)} <span class="px-sub">of your {formatMoney(s.transportReviewThreshold)} review marker</span></div>
        <Progress pct={s.transportReviewThreshold > 0 ? (transport / s.transportReviewThreshold) * 100 : 0} tone={transport > s.transportReviewThreshold ? 'warn' : undefined} label="Transport against review marker" /></div>
      <p class="px-summary">The marker is a personal setting, not a rule. Travel or an unusual month can make it fine to go over.</p>
    </Card>

    <Card title="How much goes on shopping?">
      <div class="px-stats">
        <Stat label="Shopping" value={formatMoney(sumSpend(cur, shop))} sub={`${countSpend(cur, shop)} purchases`} />
        <Stat label="Amazon" value={formatMoney(sumSpend(cur, amazon))} sub={`${countSpend(cur, amazon)} orders (by merchant name)`} />
      </div>
    </Card>

    <Card title="Online grocery or local market?" action={<Badge>No price comparison</Badge>}>
      <div class="px-stats">
        <Stat label="Online grocery" value={formatMoney(online)} sub={`${onlineN} orders`} />
        <Stat label="Local market" value={formatMoney(local)} sub={`${localN} trips`} />
      </div>
      <p class="px-summary">We can’t tell which is cheaper without prices — this simply shows how your grocery money is split.</p>
    </Card>

    <Card title="Anything unusual this month?">
      {spikes.length ? spikes.map((g) => <Row key={g.key} title={g.label} sub={`Usually about ${formatMoney(g.avg)} — worth a glance, often just a festival or one-off`} right={formatMoney(g.amount)} />) : <p class="muted" style={{ margin: 0 }}>Nothing stands out against your recent months.</p>}
      <p class="px-summary">“Unusual” means at least {s.spikeFactor}× the {priorMonths.length || 3}-month average and {formatMoney(s.spikeMinimum)} more. Change this under Nudges → Tune insights.</p>
    </Card>
  </>);
}
