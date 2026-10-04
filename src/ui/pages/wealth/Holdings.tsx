/** Investments and assets share one implementation: both are manually-valued holdings (src/domain/holdings.ts). */
import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Check, DateField, Disclosure, EmptyState, FormErrors, Grid, MoneyField, Row, SelectField, Sheet, Stat, TextArea, TextField, fieldError, useConfirm } from '../../kit';
import { Breakdown, LineChart } from '../../kit/charts';
import { formatDate, formatMoney, TXN_LABELS, accountName } from '../../format';
import { defaultOwner, openQuickAdd, ownerOptions, toast, useAction, useDb, useScope, useStore } from '../../state';
import { holdingHistory, holdingValue, valuationsFor } from '../../../domain/holdings';
import { occurrenceDates } from '../../../domain/expected';
import { addDays } from '../../../domain/dates';
import { inScope } from '../../../domain/scope';
import type { Asset, AssetKind, Database, Investment, InvestmentType, OwnerId } from '../../../domain/types';
import { DualLine, Note, OwnerBadge, daysSince, shortDate } from './shared';

export type HoldingKind = 'investment' | 'asset';

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  mutual_fund: 'Mutual fund', stock: 'Stocks / shares', fd: 'Fixed deposit', rd: 'Recurring deposit', sip: 'SIP', ppf_epf: 'PPF / EPF', other: 'Other',
};
export const ASSET_KIND_LABELS: Record<AssetKind, string> = { gold: 'Gold & jewellery', property: 'Property', vehicle: 'Vehicle', other: 'Other asset' };

const STALE_DAYS = 30;

interface Item { id: string; name: string; typeKey: string; typeLabel: string; ownerId: OwnerId; institution?: string; archived?: boolean; notes?: string }
function itemsOf(db: Database, kind: HoldingKind): Item[] {
  return kind === 'investment'
    ? db.investments.map((i) => ({ id: i.id, name: i.name, typeKey: i.type, typeLabel: INVESTMENT_TYPE_LABELS[i.type] ?? i.type, ownerId: i.ownerId, institution: i.institution, archived: i.archived, notes: i.notes }))
    : db.assets.map((a) => ({ id: a.id, name: a.name, typeKey: a.kind, typeLabel: ASSET_KIND_LABELS[a.kind] ?? a.kind, ownerId: a.ownerId, archived: a.archived, notes: a.notes }));
}
const flowTxns = (db: Database, kind: HoldingKind, id: string) =>
  db.transactions.filter((t) => (kind === 'investment' ? t.investmentId === id && (t.type === 'investment_contribution' || t.type === 'investment_redemption') : t.assetId === id && t.type === 'asset_acquisition'))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

const nice = (n: number) => `${n >= 0 ? '+' : '−'}${formatMoney(Math.abs(n))}`;

export default function HoldingsTab({ kind }: { kind: HoldingKind }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const today = store.today();
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<null | { id?: string }>(null);
  const [showArchived, setShowArchived] = useState(false);
  const isInv = kind === 'investment';

  const all = itemsOf(db, kind).filter((i) => inScope(i.ownerId, scope));
  const items = all.filter((i) => showArchived || !i.archived);
  const archivedCount = all.filter((i) => i.archived).length;
  const rows = items.map((i) => ({ i, h: holdingValue(db, kind, i.id), acquired: isInv ? 0 : flowTxns(db, kind, i.id).reduce((s, t) => s + t.amount, 0) }));
  // Totals include archived items on purpose: net worth (domain) counts them too.
  const live = all.map((i) => ({ i, h: holdingValue(db, kind, i.id), acquired: isInv ? 0 : flowTxns(db, kind, i.id).reduce((s, t) => s + t.amount, 0) }));
  const total = live.reduce((s, r) => s + r.h.value, 0);
  const invested = live.reduce((s, r) => s + r.h.invested, 0);
  const gain = total - invested;
  const byType = new Map<string, number>();
  for (const r of live) byType.set(r.i.typeLabel, (byType.get(r.i.typeLabel) ?? 0) + r.h.value);
  const slices = [...byType].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const lastUpdated = live.map((r) => r.h.lastValuationDate).filter((x): x is string => !!x).sort().pop();

  return (
    <div class="wl-list">
      {live.length > 0 && (
        <Card>
          <Grid cols={isInv ? 3 : 2}>
            <Stat label={isInv ? 'Portfolio value' : 'Total value'} value={formatMoney(total)} sub={lastUpdated ? `Latest update ${formatDate(lastUpdated)}` : 'Not valued yet'} />
            {isInv && <Stat label="Invested" value={formatMoney(invested)} />}
            {isInv && <Stat label="Gain / loss" value={nice(gain)} sub={invested > 0 ? `${gain >= 0 ? '+' : '−'}${Math.abs((gain / invested) * 100).toFixed(1)}%` : undefined} tone={gain >= 0 ? 'good' : undefined} />}
            {!isInv && <Stat label="Bought at cost (recorded)" value={formatMoney(live.reduce((s, r) => s + r.acquired, 0))} sub="From purchases you recorded" />}
          </Grid>
          {slices.length > 1 && <><h3>{isInv ? 'Allocation by type' : 'By kind'}</h3><Breakdown items={slices} total={total} /></>}
        </Card>
      )}

      <div class="wl-tabhint">
        <Note>{isInv ? 'Values are entered by you — nothing is fetched from the internet.' : 'Values are your own estimates. Update them whenever you like.'}</Note>
        <Button variant="primary" onClick={() => setForm({})}>{isInv ? 'Add investment' : 'Add asset'}</Button>
      </div>

      {!isInv && (
        <Disclosure summary="How buying an asset is counted">
          <p>When you buy gold, property or a vehicle, money moves from an account to the asset. It is <b>not an expense</b> — your net worth stays the same, because cash became an asset. Record the purchase from Quick Add → More → “Buy an asset”; keep the asset’s value up to date here.</p>
        </Disclosure>
      )}

      {items.length === 0 ? (
        isInv
          ? <Card><EmptyState title="No investments yet" body="Add a mutual fund, stock, FD, RD, SIP or PPF/EPF to see value, gain and allocation. You enter the current value yourself." action={<Button variant="primary" onClick={() => setForm({})}>Add investment</Button>} /></Card>
          : <Card><EmptyState title="No assets yet" body="Track property, gold and jewellery, a vehicle or anything else of value. Property and gold count toward your net worth once you add a value." action={<Button variant="primary" onClick={() => setForm({})}>Add an asset</Button>} /></Card>
      ) : rows.map(({ i, h, acquired }) => {
        const age = daysSince(h.lastValuationDate, today);
        const stale = !i.archived && (age === null || age > STALE_DAYS);
        return (
          <Card key={i.id}>
            <div class="wl-item">
              <div class="wl-item-head">
                <div>
                  <h3>{i.name}</h3>
                  <div class="wl-badges"><Badge>{i.typeLabel}</Badge><OwnerBadge db={db} owner={i.ownerId} />{i.institution && <Badge tone="muted">{i.institution}</Badge>}{i.archived && <Badge tone="warn">Archived</Badge>}</div>
                </div>
                <div>
                  <div class="wl-amt">{formatMoney(h.value)}</div>
                  {isInv && h.invested > 0 && <div class="row-sub" style={{ textAlign: 'right' }}>{nice(h.gain)} ({h.gain >= 0 ? '+' : '−'}{Math.abs(h.gainPct).toFixed(1)}%)</div>}
                </div>
              </div>
              <div class="row-sub">
                {isInv && <>Invested {formatMoney(h.invested)} · </>}
                {!isInv && acquired > 0 && <>Bought for {formatMoney(acquired)} · </>}
                {h.lastValuationDate ? `Valued ${formatDate(h.lastValuationDate)}` : 'No value entered yet'}
              </div>
              {stale && <Banner tone="info" action={<Button size="sm" onClick={() => setOpenId(i.id)}>Update value</Button>}>{age === null ? 'Add a current value so this counts in your net worth.' : `Last updated ${age} days ago — a quick refresh keeps things accurate.`}</Banner>}
              <div class="wl-actions"><Button size="sm" onClick={() => setOpenId(i.id)}>Details & history</Button></div>
            </div>
          </Card>
        );
      })}

      {archivedCount > 0 && <Check label={`Show archived (${archivedCount})`} checked={showArchived} onChange={setShowArchived} />}
      {form && <HoldingForm kind={kind} id={form.id} onClose={() => setForm(null)} />}
      {openId && <HoldingDetail kind={kind} id={openId} today={today} onClose={() => setOpenId(null)} onEdit={() => { const id = openId; setOpenId(null); setForm({ id }); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ add / edit
function HoldingForm({ kind, id, onClose }: { kind: HoldingKind; id?: string; onClose: () => void }) {
  const db = useDb(); const store = useStore(); const [scope] = useScope(); const isInv = kind === 'investment';
  const existing = id ? itemsOf(db, kind).find((i) => i.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<string>(existing?.typeKey ?? (isInv ? 'mutual_fund' : 'gold'));
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [owner, setOwner] = useState<OwnerId>(existing?.ownerId ?? defaultOwner(db, scope));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [date, setDate] = useState(store.today());
  const [value, setValue] = useState<number | undefined>();
  const [invested, setInvested] = useState<number | undefined>();
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const base = { name: name.trim(), ownerId: owner, notes: notes.trim() || undefined, archived: existing?.archived };
    const r = isInv
      ? await store.saveInvestment({ ...base, type: type as InvestmentType, institution: institution.trim() || undefined }, id)
      : await store.saveAsset({ ...base, kind: type as AssetKind }, id);
    if (!r.ok) { setIssues(r.issues); setBusy(false); return; }
    if (!existing && value !== undefined) {
      const v = await store.addValuation({ targetType: kind, targetId: r.value.id, date, value, invested: isInv ? invested ?? value : undefined });
      if (!v.ok) { setIssues(v.issues); setBusy(false); toast('Saved, but the first value could not be recorded: ' + v.issues[0]?.message, 'error'); return; }
    }
    setBusy(false); toast(existing ? 'Saved' : isInv ? 'Investment added' : 'Asset added'); onClose();
  };

  return (
    <Sheet title={existing ? `Edit ${existing.name}` : isInv ? 'Add investment' : 'Add asset'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>Save</Button></>}>
      <div class="form">
        <FormErrors issues={issues} />
        <TextField label="Name" value={name} onInput={setName} error={fieldError(issues, 'name')} placeholder={isInv ? 'e.g. Index fund' : 'e.g. Family gold'} autoFocus />
        <SelectField label={isInv ? 'Type' : 'Kind'} value={type} onChange={setType}
          options={isInv ? (Object.entries(INVESTMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))) : Object.entries(ASSET_KIND_LABELS).map(([value, label]) => ({ value, label }))} />
        {isInv && <TextField label="Institution (optional)" value={institution} onInput={setInstitution} placeholder="Bank, broker or fund house" />}
        <SelectField label="Owner" value={owner} onChange={(v) => setOwner(v as OwnerId)} options={ownerOptions(db)} hint="Ownership stays separate: yours, your partner’s, or joint." />
        {!existing && (
          <>
            <div class="wl-two">
              <MoneyField label="Current value" value={value} onChange={setValue} error={fieldError(issues, 'value')} hint="What it is worth today" />
              {isInv && <MoneyField label="Amount invested" value={invested} onChange={setInvested} error={fieldError(issues, 'invested')} hint="Leave blank if same as value" />}
            </div>
            <DateField label="Value as of" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
          </>
        )}
        <TextArea label="Notes (optional)" value={notes} onInput={setNotes} />
        {!isInv && <Note>Property and gold are fully supported: add them with an approximate current value and revisit whenever you like.</Note>}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ detail
function HoldingDetail({ kind, id, today, onClose, onEdit }: { kind: HoldingKind; id: string; today: string; onClose: () => void; onEdit: () => void }) {
  const db = useDb(); const store = useStore(); const { run } = useAction(); const [ask, dialog] = useConfirm();
  const isInv = kind === 'investment';
  const item = itemsOf(db, kind).find((i) => i.id === id);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const h = holdingValue(db, kind, id);
  const [date, setDate] = useState(today);
  const [value, setValue] = useState<number | undefined>(h.value || undefined);
  const [invested, setInvested] = useState<number | undefined>(isInv && h.invested ? h.invested : undefined);
  if (!item) return null;

  const hist = holdingHistory(db, kind, id);
  const vals = valuationsFor(db, kind, id).slice().reverse();
  const flows = flowTxns(db, kind, id);
  const sips = isInv ? db.expectedItems.filter((e) => e.investmentId === id && e.status === 'active') : [];

  const updateValue = async () => {
    if (value === undefined) { setIssues([{ field: 'value', message: 'Enter the current value' }]); return; }
    const r = await store.addValuation({ targetType: kind, targetId: id, date, value, invested: isInv ? invested : undefined });
    if (!r.ok) { setIssues(r.issues); return; }
    setIssues([]); toast('Value updated');
  };
  const del = async () => {
    if (!(await ask({ title: `Delete ${item.name}?`, body: 'This removes it and its value history. Transactions that reference it block deletion — archive it instead in that case.', confirmLabel: 'Delete', danger: true }))) return;
    const r = await store.deleteHolding(kind, id);
    if (!r.ok) { setIssues(r.issues); return; }
    toast('Deleted'); onClose();
  };

  return (
    <Sheet title={item.name} onClose={onClose} wide>
      <div class="form">
        <div class="wl-badges"><Badge>{item.typeLabel}</Badge><OwnerBadge db={db} owner={item.ownerId} />{item.archived && <Badge tone="warn">Archived</Badge>}</div>
        <Grid cols={isInv ? 3 : 2}>
          <Stat label="Current value" value={formatMoney(h.value)} sub={h.lastValuationDate ? `As of ${formatDate(h.lastValuationDate)}` : 'No value yet'} />
          {isInv && <Stat label="Invested" value={formatMoney(h.invested)} />}
          {isInv && <Stat label="Gain / loss" value={nice(h.gain)} sub={h.invested > 0 ? `${h.gain >= 0 ? '+' : '−'}${Math.abs(h.gainPct).toFixed(1)}%` : undefined} />}
        </Grid>
        <FormErrors issues={issues} />

        {hist.length >= 2
          ? (isInv
            ? <DualLine data={hist.map((p) => ({ label: shortDate(p.date), a: p.value, b: p.invested }))} labels={['Value', 'Invested']} summary={`Value moved from ${formatMoney(hist[0].value)} to ${formatMoney(hist[hist.length - 1].value)} across ${hist.length} updates; invested went from ${formatMoney(hist[0].invested)} to ${formatMoney(hist[hist.length - 1].invested)}.`} />
            : <LineChart data={hist.map((p) => ({ label: shortDate(p.date), value: p.value }))} zeroLine={false} summary={`Value moved from ${formatMoney(hist[0].value)} to ${formatMoney(hist[hist.length - 1].value)} across ${hist.length} updates.`} />)
          : <Note>History appears here once you have at least two value updates.</Note>}

        <div class="wl-sec">
          <h3>Update value</h3>
          <div class="wl-two">
            <DateField label="As of" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
            <MoneyField label="Current value" value={value} onChange={setValue} error={fieldError(issues, 'value')} />
          </div>
          {isInv && <MoneyField label="Amount invested (optional)" value={invested} onChange={setInvested} error={fieldError(issues, 'invested')} hint="Pre-filled with the current figure. If left blank, gain/loss shows as zero for this update." />}
          <div><Button variant="primary" onClick={updateValue}>Save value</Button></div>
        </div>

        {isInv && sips.length > 0 && (
          <div class="wl-sec">
            <h3>Expected SIP</h3>
            {sips.map((s) => {
              const next = occurrenceDates(s, today, addDays(today, 70))[0];
              return <Row key={s.id} title={<>{s.name} <Badge tone="info">Expected</Badge></>} sub={`${s.frequency} · next ${next ? formatDate(next) : '—'}${s.accountId ? ` · from ${accountName(db, s.accountId)}` : ''}`} right={formatMoney(s.amount)} />;
            })}
            <Note>Expected amounts are not counted as invested. A contribution is only recorded when you confirm it.</Note>
          </div>
        )}

        <div class="wl-sec">
          <div class="wl-tabhint"><h3>{isInv ? 'Contributions & withdrawals' : 'Purchases recorded'}</h3>{isInv && <Button size="sm" onClick={() => { onClose(); openQuickAdd('invest'); }}>Record a contribution</Button>}</div>
          {flows.length === 0 ? <Note>{isInv ? 'None recorded yet. Contributions move money from an account into this investment — they are not spending.' : 'No purchases recorded against this asset. Buying it moves money from an account to the asset — it is not an expense.'}</Note>
            : flows.map((t) => <Row key={t.id} title={TXN_LABELS[t.type]} sub={`${formatDate(t.date)} · ${accountName(db, t.fromAccountId ?? t.toAccountId)}`} right={`${t.type === 'investment_redemption' ? '−' : ''}${formatMoney(t.amount)}`} />)}
        </div>

        <div class="wl-sec">
          <h3>Value history</h3>
          {vals.length === 0 ? <Note>No values yet.</Note> : vals.map((v) => (
            <Row key={v.id} title={formatMoney(v.value)} sub={`${formatDate(v.date)}${isInv && v.invested !== undefined ? ` · invested ${formatMoney(v.invested)}` : ''}`}
              right={<Button size="sm" variant="ghost" aria-label={`Delete value from ${formatDate(v.date)}`} onClick={async () => { if (await ask({ title: 'Delete this value?', body: 'Only this history entry is removed.', confirmLabel: 'Delete', danger: true })) await run(() => store.deleteValuation(v.id), 'Removed'); }}>Delete</Button>} />
          ))}
        </div>

        <div class="wl-actions">
          <Button onClick={onEdit}>Edit details</Button>
          <Button onClick={async () => { const r = await (isInv ? store.saveInvestment({ ...(db.investments.find((x) => x.id === id) as Investment), archived: !item.archived }, id) : store.saveAsset({ ...(db.assets.find((x) => x.id === id) as Asset), archived: !item.archived }, id)); if (r.ok) toast(item.archived ? 'Restored' : 'Archived'); else setIssues(r.issues); }}>{item.archived ? 'Restore' : 'Archive'}</Button>
          <Button variant="danger" onClick={del}>Delete</Button>
        </div>
        {item.archived ? <Note>Archived items are hidden from the main list. Their value still counts in net worth — set the value to ₹0 if it is gone.</Note> : <Note>Archive instead of deleting to keep history.</Note>}
      </div>
      {dialog}
    </Sheet>
  );
}
