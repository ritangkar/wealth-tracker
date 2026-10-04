import { Card, EmptyState } from '../../kit';
import { BarChart, LineChart } from '../../kit/charts';
import { useDb, useScope, useStore } from '../../state';
import { formatMoney, monthLabel } from '../../format';
import { addMonthsKey, monthEnd, monthOf, monthRange, type MonthKey } from '../../../domain/dates';
import { monthlySeries, scopedTxns } from '../../../domain/cashflow';
import { snapshotSeries } from '../../../domain/networth';
import { holdingValue, valuationsFor } from '../../../domain/holdings';
import { wasteTrend } from '../../../domain/waste';
import { inScope } from '../../../domain/scope';
import '../plan/plan.css';

const short = (m: MonthKey) => monthLabel(m).split(' ')[0];
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 100) * 100 : 0);

/** Tiny percentage bar chart (kit charts format values as money, so rates get their own). */
function RateChart({ data, summary }: { data: { label: string; value: number }[]; summary: string }) {
  const W = 320, H = 130, PB = 20, PT = 14; const max = Math.max(10, ...data.map((d) => d.value)); const min = Math.min(0, ...data.map((d) => d.value));
  const bw = (W - 16) / data.length; const range = max - min; const y = (v: number) => PT + (H - PT - PB) * (1 - (v - min) / range);
  return (
    <figure class="chart px-rate"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
      <line x1="8" x2={W - 8} y1={y(0)} y2={y(0)} class="axis" />
      {data.map((d, i) => { const top = Math.min(y(d.value), y(0)); const h = Math.abs(y(d.value) - y(0));
        return <g key={d.label}><rect class="bar" x={8 + i * bw + bw * 0.15} width={bw * 0.7} y={top} height={Math.max(1, h)} rx="3"><title>{`${d.label}: ${Math.round(d.value)}%`}</title></rect><text class="tick" x={8 + i * bw + bw / 2} y={H - 6} text-anchor="middle">{d.label}</text></g>; })}
      <text class="tick" x="8" y="10">{Math.round(max)}%</text>
    </svg></figure>
  );
}

export default function Trends() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today(); const month = monthOf(today);
  const txns = scopedTxns(db, scope);
  const earliest = txns.map((t) => monthOf(t.date)).sort()[0] ?? month;
  const start = earliest > addMonthsKey(month, -11) ? earliest : addMonthsKey(month, -11);
  const s12 = monthlySeries(txns, start, month);
  const done = s12.slice(0, -1);
  const hasTxns = txns.length > 0;

  if (!hasTxns) return <Card><EmptyState title="Trends need a little history" body="Once you’ve recorded a few weeks of income and spending, 12-month charts appear here." /></Card>;

  const first6 = done.slice(0, Math.floor(done.length / 2)); const last6 = done.slice(Math.floor(done.length / 2));
  const savingsAvgEarly = avg(first6.map((s) => s.savings)), savingsAvgLate = avg(last6.map((s) => s.savings));
  const rates = s12.filter((s) => s.income > 0);

  const nw = snapshotSeries(db, scope);
  const invs = db.investments.filter((i) => inScope(i.ownerId, scope));
  const valDates = new Set(invs.flatMap((i) => valuationsFor(db, 'investment', i.id).map((v) => v.date)));
  const firstVal = [...valDates].sort()[0];
  const invSeries = valDates.size >= 2 ? monthRange(start, month).filter((m) => monthEnd(m) >= firstVal || m === month).map((m) => ({ label: short(m), value: invs.reduce((t, i) => t + holdingValue(db, 'investment', i.id, m === month ? today : monthEnd(m)).value, 0) })) : [];
  const waste = wasteTrend(db, scope, month, s12.length);

  const y = +month.slice(0, 4);
  const thisYear = monthlySeries(txns, `${y}-01`, month);
  const lastYear = monthlySeries(txns, `${y - 1}-01`, addMonthsKey(month, -12));
  const ytd = (xs: typeof thisYear, f: (s: (typeof thisYear)[number]) => number) => xs.reduce((a, s) => a + f(s), 0);
  const hasLastYear = lastYear.some((s) => s.txnCount > 0);

  return (<>
    <Card>
      <h3 class="px-q">Are we spending less than we earn?</h3>
      <BarChart data={s12.map((s) => ({ label: short(s.month), value: s.income, value2: s.spending }))} legend={['Income', 'Spending']} summary={`Income and spending over 12 months. ${s12.map((s) => `${monthLabel(s.month)} income ${formatMoney(s.income)} spending ${formatMoney(s.spending)}`).join('; ')}.`} />
      <p class="px-summary">Over finished months, income averaged {formatMoney(avg(done.map((s) => s.income)))} and spending {formatMoney(avg(done.map((s) => s.spending)))}.</p>
    </Card>

    <Card>
      <h3 class="px-q">Are we saving more than before?</h3>
      <LineChart data={s12.map((s) => ({ label: short(s.month), value: s.savings }))} summary={`Monthly savings over 12 months. ${s12.map((s) => `${monthLabel(s.month)}: ${formatMoney(s.savings)}`).join('; ')}.`} />
      <p class="px-summary">{done.length >= 4 ? `Earlier months averaged ${formatMoney(savingsAvgEarly)} saved; recent months ${formatMoney(savingsAvgLate)}. ` : ''}A dip usually has a story — a festival, a trip, a one-off. Savings = income − spending.</p>
    </Card>

    <Card>
      <h3 class="px-q">What share of income do we keep?</h3>
      {rates.length ? <RateChart data={rates.map((s) => ({ label: short(s.month), value: s.savingsRate }))} summary={`Savings rate by month. ${rates.map((s) => `${monthLabel(s.month)} ${Math.round(s.savingsRate)}%`).join('; ')}.`} /> : <p class="muted">No income recorded in these months.</p>}
      <p class="px-summary">{rates.length ? `Average savings rate across months with income: ${Math.round(rates.reduce((a, s) => a + s.savingsRate, 0) / rates.length)}%.` : ''}</p>
    </Card>

    <Card>
      <h3 class="px-q">Is our net worth growing?</h3>
      {nw.length >= 2 ? (<>
        <LineChart data={nw.map((p) => ({ label: monthLabel(monthOf(p.date)).split(' ')[0], value: p.net }))} summary={`Net worth from snapshots: ${nw.map((p) => `${p.date} ${formatMoney(p.net)}`).join('; ')}.`} zeroLine={false} />
        <p class="px-summary">From {formatMoney(nw[0].net)} to {formatMoney(nw[nw.length - 1].net)} across {nw.length} snapshots ({nw[nw.length - 1].net - nw[0].net >= 0 ? 'up' : 'down'} {formatMoney(Math.abs(nw[nw.length - 1].net - nw[0].net))}).</p>
      </>) : <p class="muted" style={{ margin: 0 }}>Net worth needs at least two snapshots. Snapshots are saved from the Wealth page — we never invent history between them.</p>}
    </Card>

    <Card>
      <h3 class="px-q">Are our investments growing?</h3>
      {invSeries.length >= 2 ? (<>
        <LineChart data={invSeries} summary={`Investment value by month-end, from your valuations and contributions: ${invSeries.map((p) => `${p.label} ${formatMoney(p.value)}`).join('; ')}.`} zeroLine={false} />
        <p class="px-summary">Built from the values you entered plus contributions recorded since. Between valuations it is an estimate.</p>
      </>) : <p class="muted" style={{ margin: 0 }}>Not enough history yet. Update the value of your investments on at least two different dates and a trend will appear — we won’t guess in between.</p>}
    </Card>

    <Card>
      <h3 class="px-q">Are we paying down debt?</h3>
      {s12.some((s) => s.debtPaydown > 0) ? (<>
        <BarChart data={s12.map((s) => ({ label: short(s.month), value: s.debtPaydown }))} color="var(--c-accent)" summary={`Loan principal paid each month: ${s12.map((s) => `${monthLabel(s.month)} ${formatMoney(s.debtPaydown)}`).join('; ')}.`} />
        <p class="px-summary">{formatMoney(ytd(s12, (s) => s.debtPaydown))} of loan principal paid over these 12 months. Interest is counted as spending; principal is not.</p>
      </>) : <p class="muted" style={{ margin: 0 }}>No loan payments recorded in the last 12 months. Open Cards, EMIs &amp; loans to see balances.</p>}
    </Card>

    <Card>
      <h3 class="px-q">Is less going to waste?</h3>
      {waste.some((w) => w.total > 0) ? (<>
        <BarChart data={waste.map((w) => ({ label: short(w.month), value: w.total }))} color="var(--c-accent)" summary={`Waste logged per month: ${waste.map((w) => `${monthLabel(w.month)} ${formatMoney(w.total)}`).join('; ')}.`} />
        <p class="px-summary">{formatMoney(waste.reduce((a, w) => a + w.total, 0))} logged over 12 months. Waste is not an additional expense — it is part of what was already spent.</p>
      </>) : <p class="muted" style={{ margin: 0 }}>No waste logged yet.</p>}
    </Card>

    <Card>
      <h3 class="px-q">How does this year compare with last year?</h3>
      {hasLastYear ? (<>
        <BarChart data={thisYear.map((s, i) => ({ label: short(s.month), value: s.spending, value2: lastYear[i]?.spending ?? 0 }))} legend={[String(y), String(y - 1)]} color="var(--c-primary)" color2="var(--c-border)" summary={`Spending this year versus last year for the same months: ${thisYear.map((s, i) => `${short(s.month)} ${formatMoney(s.spending)} vs ${formatMoney(lastYear[i]?.spending ?? 0)}`).join('; ')}.`} />
        <table class="px-cmp">
          <thead><tr><th scope="col"> </th><th scope="col">{y}</th><th scope="col">{y - 1}</th></tr></thead>
          <tbody>
            <tr><td>Income</td><td>{formatMoney(ytd(thisYear, (s) => s.income))}</td><td>{formatMoney(ytd(lastYear, (s) => s.income))}</td></tr>
            <tr><td>Spending</td><td>{formatMoney(ytd(thisYear, (s) => s.spending))}</td><td>{formatMoney(ytd(lastYear, (s) => s.spending))}</td></tr>
            <tr><td>Saved</td><td>{formatMoney(ytd(thisYear, (s) => s.savings))}</td><td>{formatMoney(ytd(lastYear, (s) => s.savings))}</td></tr>
          </tbody>
        </table>
        <p class="px-summary">Same months of each year (January to {monthLabel(month, true).split(' ')[0]}). This month is still in progress.</p>
      </>) : <p class="muted" style={{ margin: 0 }}>No records from the same months last year yet — this comparison appears once you have a year of history.</p>}
    </Card>
  </>);
}
