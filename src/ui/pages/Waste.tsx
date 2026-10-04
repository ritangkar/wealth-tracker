import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Disclosure, EmptyState, Page, Row, Stat, useConfirm } from '../kit';
import { BarChart, Breakdown } from '../kit/charts';
import { openQuickAdd, useAction, useDb, useScope, useStore, personName } from '../state';
import { formatDate, formatMoney, monthLabel } from '../format';
import { monthOf } from '../../domain/dates';
import { WASTE_LABELS, recurringWaste, wasteInScope, wasteMonth, wasteTrend } from '../../domain/waste';
import { MonthNav } from './plan/MonthNav';
import './plan/plan.css';

export default function Waste() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today(); const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [ask, dialog] = useConfirm(); const { run } = useAction();
  const w = wasteMonth(db, scope, month);
  const trend = wasteTrend(db, scope, month, 6);
  const entries = wasteInScope(db, scope).filter((e) => monthOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const recurring = recurringWaste(db, scope).slice(0, 5);
  const anyEver = wasteInScope(db, scope).length > 0;
  const prev = trend.length >= 2 ? trend[trend.length - 2].total : 0;

  const del = async (id: string, item: string) => { if (await ask({ title: `Delete “${item}”?`, danger: true, confirmLabel: 'Delete', body: <p>Removes this waste entry. It doesn’t change your spending — that money was already spent.</p> })) await run(() => store.deleteWaste(id), 'Entry deleted'); };

  return (
    <Page title="Waste" subtitle="Things we bought but didn’t use — noticed, not judged" actions={<Button variant="primary" onClick={() => openQuickAdd('waste')}>+ Log waste</Button>}>
      <div class="px-panel" style={{ marginTop: 0 }}>
        <MonthNav month={month} onChange={setMonth} max={thisMonth} />
        <div class="px-explain" role="note"><strong>Waste isn’t an extra expense.</strong>The money was already spent when you bought it. Logging waste just helps you spot patterns, so future shopping can be a little lighter.</div>

        {!anyEver ? (
          <Card><EmptyState title="Nothing logged yet — and that’s fine" body="When some food spoils or something goes unused, a quick entry (item and rough cost) is enough. Over time you’ll see which things tend to slip through." action={<Button variant="primary" onClick={() => openQuickAdd('waste')}>Log your first one</Button>} /></Card>
        ) : (<>
          <Card title={`${monthLabel(month, true)}`}>
            <div class="px-stats">
              <Stat label="Estimated money wasted" value={formatMoney(w.total)} sub={w.count ? `${w.count} ${w.count === 1 ? 'entry' : 'entries'}` : 'nothing logged this month'} tone={w.total === 0 ? 'good' : undefined} />
              <Stat label="Share of spending" value={`${w.rateOfSpending.toFixed(1)}%`} sub="of this month’s total" />
              <Stat label="Food waste rate" value={`${w.foodWasteRate.toFixed(1)}%`} sub="of groceries + dining" />
              <Stat label="Last month" value={formatMoney(prev)} sub={w.total < prev ? 'a bit lower now' : undefined} />
            </div>
            {w.total > 0 && prev > 0 && w.total < prev && <Banner tone="good">Lower than last month — nice progress.</Banner>}
            <Disclosure summary="How are these rates worked out?">
              <ul class="px-list">
                <li><b>Estimated money wasted</b> is the sum of the costs you entered. It’s only as accurate as your estimates.</li>
                <li><b>Share of spending</b> = waste logged ÷ everything you spent this month.</li>
                <li><b>Food waste rate</b> = cooked food, groceries and spoiled items ÷ what you spent on Groceries and Food &amp; dining.</li>
                <li>Waste is not added to spending and doesn’t change your balances or net worth.</li>
              </ul>
            </Disclosure>
          </Card>

          {w.total > 0 && (
            <Card title="What kinds of things?"><Breakdown items={w.byCategory.map((c) => ({ label: WASTE_LABELS[c.category], value: c.amount }))} total={w.total} /></Card>
          )}

          <Card title="Is it getting better over time?">
            <BarChart data={trend.map((t) => ({ label: monthLabel(t.month).split(' ')[0], value: t.total }))} summary={`Waste logged over six months. ${trend.map((t) => `${monthLabel(t.month)}: ${formatMoney(t.total)}`).join('; ')}.`} />
            <p class="px-summary">Estimated waste per month, ending {monthLabel(month, true)}. Months with nothing logged show as empty.</p>
          </Card>

          {w.topItems.length > 0 && (
            <Card title="What purchases contribute most?">
              {w.topItems.map((t) => <Row key={t.item} title={t.item} sub={`${t.count} ${t.count === 1 ? 'time' : 'times'} this month`} right={formatMoney(t.amount)} />)}
            </Card>
          )}

          {recurring.length > 0 && (
            <Card title="Things that come up again">
              <p class="px-sub" style={{ margin: 0 }}>These showed up in more than one month. A smaller pack or a different plan might help — only if it suits you.</p>
              {recurring.map((r) => <Row key={r.item} title={r.item} sub={`${r.months} months · ${r.count} entries`} right={formatMoney(r.total)} />)}
            </Card>
          )}

          <Card title={`Entries in ${monthLabel(month, true)}`}>
            {!entries.length ? <p class="muted" style={{ margin: 0 }}>Nothing logged this month. {month === thisMonth ? 'A good thing to log: the odd wilted vegetable or an unopened gadget.' : ''}</p> : entries.map((e) => (
              <div class="px-item" key={e.id}>
                <div class="px-head-row">
                  <div>
                    <div class="row-title">{e.item}{e.quantity ? ` · ${e.quantity}` : ''}</div>
                    <div class="px-badges"><Badge>{WASTE_LABELS[e.category]}</Badge></div>
                    <div class="px-sub">{formatDate(e.date)} · {personName(db, e.ownerId)}{e.reason ? ` · ${e.reason}` : ''}</div>
                  </div>
                  <div class="px-item-amt">{formatMoney(e.cost)}</div>
                </div>
                <div class="px-actions">
                  <Button size="sm" onClick={() => openQuickAdd('waste', e.id)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => del(e.id, e.item)}>Delete</Button>
                </div>
              </div>
            ))}
          </Card>
        </>)}
      </div>
      {dialog}
    </Page>
  );
}
