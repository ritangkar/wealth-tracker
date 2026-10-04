import { Banner, Button, Card, Disclosure, Page, Row, Stat } from '../kit';
import { Breakdown, LineChart } from '../kit/charts';
import { formatCompact, formatDate, formatMoney } from '../format';
import { useAction, useDb, useScope, useStore, personName } from '../state';
import { useRoute } from '../router';
import { computeNetWorth, snapshotSeries } from '../../domain/networth';
import type { Database, OwnerId } from '../../domain/types';
import { Note, Tabs, shortDate } from './wealth/shared';
import AccountsTab from './wealth/Accounts';
import HoldingsTab from './wealth/Holdings';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'investments', label: 'Investments' },
  { id: 'assets', label: 'Assets' },
];

export default function Wealth() {
  const route = useRoute();
  const [scope] = useScope();
  const db = useDb();
  const raw = route.query.get('tab') ?? 'overview';
  const tab = TABS.some((t) => t.id === raw) ? raw : 'overview';
  return (
    <Page title="Wealth" subtitle={scope === 'household' ? 'Everything the household owns and owes' : `${personName(db, scope)}’s share`}>
      <Tabs tabs={TABS} value={tab} base="/wealth" label="Wealth sections" />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} class="wl-panel">
        {tab === 'overview' && <Overview />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'investments' && <HoldingsTab kind="investment" />}
        {tab === 'assets' && <HoldingsTab kind="asset" />}
      </div>
    </Page>
  );
}

/** Joint = household − p1 − p2 (same additive rule the snapshots use), so ownership stays distinct. */
function byOwner(db: Database) {
  const hh = computeNetWorth(db, 'household'); const p1 = computeNetWorth(db, 'p1'); const p2 = computeNetWorth(db, 'p2');
  const part = (n: ReturnType<typeof computeNetWorth>) => ({ assets: n.assets.total, liabilities: n.liabilities.total, net: n.net });
  const joint = { assets: hh.assets.total - p1.assets.total - p2.assets.total, liabilities: hh.liabilities.total - p1.liabilities.total - p2.liabilities.total, net: 0 };
  joint.net = joint.assets - joint.liabilities;
  return { p1: part(p1), p2: part(p2), hh: joint, household: part(hh) };
}

function Overview() {
  const db = useDb(); const store = useStore(); const [scope] = useScope(); const { run, busy } = useAction();
  const nw = computeNetWorth(db, scope);
  const a = nw.assets; const l = nw.liabilities;
  const assetSlices = [
    { label: 'Bank balances', value: a.bank }, { label: 'Cash', value: a.cash }, { label: 'Brokerage cash', value: a.brokerageCash },
    { label: 'Investments', value: a.investments }, { label: 'Gold', value: a.gold }, { label: 'Property', value: a.property }, { label: 'Other assets', value: a.other },
  ].filter((s) => s.value > 0).sort((x, y) => y.value - x.value);
  const liabSlices = [{ label: 'Credit cards', value: l.cards }, { label: 'Loans', value: l.loans }, { label: 'Overdrafts', value: l.overdrafts }].filter((s) => s.value > 0).sort((x, y) => y.value - x.value);
  const series = snapshotSeries(db, scope);
  const o = byOwner(db);
  const people: { key: OwnerId | 'household'; label: string; v: { assets: number; liabilities: number; net: number } }[] = [
    { key: 'p1', label: personName(db, 'p1'), v: o.p1 }, { key: 'p2', label: personName(db, 'p2'), v: o.p2 },
    { key: 'hh', label: 'Joint', v: o.hh }, { key: 'household', label: 'Household total', v: o.household },
  ];
  const maxAbs = Math.max(1, ...people.slice(0, 3).map((p) => Math.abs(p.v.net)));
  const snapToday = db.snapshots.some((s) => s.date === store.today());
  const nothing = a.total === 0 && l.total === 0;

  const record = async () => {
    await run(() => store.captureSnapshot(), 'Snapshot saved');
  };

  return (
    <div class="wl-list">
      <Card tone="accent">
        <div class="wl-hero">
          <div class="muted">Net worth{scope !== 'household' ? ` · ${personName(db, scope)}` : ''}</div>
          <div class="hero" aria-label={`Net worth ${formatMoney(nw.net)}`}>{formatMoney(nw.net)}</div>
          <div class="wl-hero-sub">
            <Stat label="Assets" value={formatMoney(a.total)} />
            <Stat label="Liabilities" value={formatMoney(l.total)} />
            <Stat label="Liquid (bank + cash)" value={formatMoney(nw.liquid)} />
          </div>
        </div>
        <Note>Net worth = assets − liabilities. Goal envelopes are a plan for your money, not extra assets, so they never change this number.</Note>
      </Card>

      {nothing && <Banner tone="info" action={<Button size="sm" onClick={() => (location.hash = '/wealth?tab=accounts')}>Add an account</Button>}>Nothing to total yet. Add accounts, investments or assets to see your net worth.</Banner>}

      <div class="cols cols-2">
        <Card title="What you own">
          {assetSlices.length ? <Breakdown items={assetSlices} total={a.total} max={7} /> : <Note>No assets yet.</Note>}
        </Card>
        <Card title="What you owe">
          {liabSlices.length ? <Breakdown items={liabSlices} total={l.total} /> : <Note>No liabilities — nothing owed right now.</Note>}
          {l.overdrafts > 0 && <Note>Overdrafts are bank accounts below zero. Credit-card outstanding comes from your tracked card balance.</Note>}
        </Card>
      </div>

      <Card title="Who owns what">
        {people.map((p, idx) => {
          const cur = p.key === scope || (p.key === 'household' && scope === 'household');
          return (
            <div key={p.key} class={`wl-person${cur ? ' wl-person-cur' : ''}`}>
              <div class="wl-person-head"><strong>{p.label}</strong><b class={p.v.net < 0 ? 'wl-neg' : ''}>{formatMoney(p.v.net)}</b></div>
              <div class="row-sub">Assets {formatCompact(p.v.assets)} · Liabilities {formatCompact(p.v.liabilities)}</div>
              {idx < 3 && <div class="wl-bar" role="img" aria-label={`${p.label} net worth ${formatMoney(p.v.net)}`}><span style={{ width: `${Math.max(0, p.v.net) / maxAbs * 100}%` }} /></div>}
            </div>
          );
        })}
        <Note>Ownership is kept separate. “Joint” is whatever is held in joint/household accounts and holdings.</Note>
      </Card>

      <Card title="Net worth over time" action={<Button size="sm" disabled={busy} onClick={record}>Record snapshot now</Button>}>
        {series.length >= 2
          ? <LineChart data={series.map((s) => ({ label: shortDate(s.date), value: s.net }))} summary={`Net worth moved from ${formatMoney(series[0].net)} on ${formatDate(series[0].date)} to ${formatMoney(series[series.length - 1].net)} on ${formatDate(series[series.length - 1].date)}, across ${series.length} snapshots.`} />
          : <p class="muted">History builds as you use the app. {series.length === 1 ? 'You have one snapshot so far — one more and a chart appears.' : 'Record a snapshot now, and again later, to start your line.'}</p>}
        <Note>Snapshots are only taken when the app records them or you press the button — they are never made up for dates in between.{snapToday ? ' Today’s snapshot is saved.' : ''}</Note>
      </Card>

      <Disclosure summary="How this is calculated">
        <p>Assets: bank, cash and brokerage balances from your accounts, plus the latest value you entered for each investment, gold, property and other asset.</p>
        <p>Liabilities: credit-card outstanding, active loans, and any account below zero. Money you moved into an investment or asset stays part of your net worth — it isn’t spending.</p>
        <Row title="Investments & assets" sub="Valued manually by you; no market data is fetched" />
      </Disclosure>
    </div>
  );
}
