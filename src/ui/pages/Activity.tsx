import { useEffect, useMemo, useState } from 'preact/hooks';
import { monthTxns, scopedTxns, summarizeMonth, topCategoryId } from '../../domain/cashflow';
import { addMonthsKey, diffDays, monthOf, type MonthKey } from '../../domain/dates';
import { incomeOf, interestPortion, principalPortion, spendingOf } from '../../domain/ledger';
import type { Database, OwnerId, PaymentMethod, Transaction, TxnType } from '../../domain/types';
import { Badge, Button, Card, Chips, Disclosure, EmptyState, Field, Page, Row, SelectField, Sheet, Stat } from '../kit';
import { PAYMENT_LABELS, TXN_LABELS, accountName, categoryName, formatCompact, formatDate, formatMoney, monthLabel } from '../format';
import { useRoute } from '../router';
import { openQuickAdd, personName, toast, useDb, useScope, useStore, type QuickKind } from '../state';
import './home-activity.css';

type TypeGroup = 'all' | 'expense' | 'income' | 'transfer' | 'invest' | 'loan';
const GROUPS: { value: TypeGroup; label: string; types?: TxnType[] }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Spending', types: ['expense', 'refund'] },
  { value: 'income', label: 'Income', types: ['income'] },
  { value: 'transfer', label: 'Transfers', types: ['transfer', 'cc_settlement'] },
  { value: 'invest', label: 'Investing', types: ['investment_contribution', 'investment_redemption', 'asset_acquisition'] },
  { value: 'loan', label: 'Loans', types: ['liability_payment', 'liability_creation'] },
];
const PAGE = 120;

const KIND_FOR: Partial<Record<TxnType, QuickKind>> = {
  expense: 'expense', income: 'income', transfer: 'transfer', cc_settlement: 'transfer',
  investment_contribution: 'invest', investment_redemption: 'invest', liability_payment: 'loan',
  refund: 'more', asset_acquisition: 'more', liability_creation: 'more',
};

interface Filters { q: string; month: MonthKey | null; group: TypeGroup; cat: string; owner: string; account: string; method: string; tag: string }
const fromQuery = (q: URLSearchParams, current: MonthKey): Filters => {
  const m = q.get('month'); const g = q.get('type') as TypeGroup | null;
  return {
    q: q.get('q') ?? '', month: m === 'all' ? null : m && /^\d{4}-\d{2}$/.test(m) ? m : current,
    group: g && GROUPS.some((x) => x.value === g) ? g : 'all', cat: q.get('cat') ?? '', owner: q.get('owner') ?? '', account: q.get('account') ?? '', method: q.get('method') ?? '', tag: q.get('tag') ?? '',
  };
};

export default function Activity() {
  const store = useStore(); const db = useDb(); const [scope] = useScope(); const route = useRoute();
  const today = store.today(); const thisMonth = monthOf(today);
  const [f, setF] = useState<Filters>(() => fromQuery(route.query, thisMonth));
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const qs = route.query.toString();
  const [initialOpen] = useState(() => !!(f.cat || f.owner || f.account || f.method || f.tag || f.group !== 'all'));
  useEffect(() => { setF(fromQuery(route.query, thisMonth)); setLimit(PAGE); }, [qs]);
  const set = (p: Partial<Filters>) => { setF((x) => ({ ...x, ...p })); setLimit(PAGE); };

  const all = useMemo(() => scopedTxns(db, scope), [db.transactions, scope]);
  const tags = useMemo(() => [...new Set(all.flatMap((t) => t.tags ?? []))].sort(), [all]);
  const topCats = db.categories.filter((c) => !c.parentId);

  const list = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    const types = GROUPS.find((g) => g.value === f.group)?.types;
    return (f.month ? monthTxns(all, f.month) : all).filter((t) => {
      if (types && !types.includes(t.type)) return false;
      if (f.cat && !((t.categoryId || spendingOf(t) !== 0) && topCategoryId(t, db.categories) === f.cat)) return false;
      if (f.owner && t.ownerId !== f.owner) return false;
      if (f.account && t.fromAccountId !== f.account && t.toAccountId !== f.account) return false;
      if (f.method && t.paymentMethod !== f.method) return false;
      if (f.tag && !t.tags?.includes(f.tag)) return false;
      if (needle) {
        const hay = [t.merchant, t.notes, categoryName(db, t.categoryId), categoryName(db, t.subcategoryId), ...(t.tags ?? [])].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [all, f, db.categories, db.accounts, db.investments, db.liabilities]);

  const totals = useMemo(() => {
    if (f.month) { const s = summarizeMonth(all, f.month); return { income: s.income, spending: s.spending, savings: s.savings }; }
    const income = all.reduce((s, t) => s + incomeOf(t), 0); const spending = all.reduce((s, t) => s + spendingOf(t), 0);
    return { income, spending, savings: income - spending };
  }, [all, f.month]);

  const activeCount = [f.cat, f.owner, f.account, f.method, f.tag].filter(Boolean).length + (f.group !== 'all' ? 1 : 0);
  const anyFilter = activeCount > 0 || !!f.q.trim();
  const clear = () => set({ q: '', group: 'all', cat: '', owner: '', account: '', method: '', tag: '' });

  const open = (t: Transaction) => { const k = KIND_FOR[t.type]; if (k) openQuickAdd(k, t.id); else setDetail(t); };

  // group by date
  const groups: { date: string; items: Transaction[] }[] = [];
  for (const t of list.slice(0, limit)) { const g = groups[groups.length - 1]; if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] }); }

  const dayLabel = (d: string) => { const n = diffDays(today, d); return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : formatDate(d); };
  const owners: { value: string; label: string }[] = [{ value: '', label: 'Everyone' }, ...db.settings.people.map((p) => ({ value: p.id, label: p.name })), { value: 'hh', label: 'Joint / household' }];

  return (
    <Page title="Activity" subtitle={personName(db, scope)} actions={<Button variant="primary" onClick={() => openQuickAdd('expense')}>＋ Add</Button>}>
      <Card class="act-head">
        <div class="act-month">
          {f.month ? (
            <>
              <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => set({ month: addMonthsKey(f.month!, -1) })}>‹</Button>
              <strong aria-live="polite">{monthLabel(f.month, true)}</strong>
              <Button variant="ghost" size="sm" aria-label="Next month" disabled={f.month >= thisMonth} onClick={() => set({ month: addMonthsKey(f.month!, 1) })}>›</Button>
            </>
          ) : <strong>All time</strong>}
          <Button variant="ghost" size="sm" onClick={() => set({ month: f.month ? null : thisMonth })}>{f.month ? 'All time' : 'By month'}</Button>
        </div>
        <div class="act-totals">
          <Stat label="Income" value={formatCompact(totals.income)} tone="good" />
          <Stat label="Spending" value={formatCompact(totals.spending)} />
          <Stat label="Saved" value={formatCompact(totals.savings)} tone={totals.savings < 0 ? 'warn' : undefined} />
        </div>
        <Field label="Search">
          {(a) => <input {...a} type="search" placeholder="Merchant, notes, tags…" value={f.q} onInput={(e) => set({ q: (e.target as HTMLInputElement).value })} />}
        </Field>
        <Disclosure summary={`Filters${activeCount ? ` (${activeCount} on)` : ''}`} open={initialOpen}>
          <div class="act-filters">
            <div class="field"><span class="qa-label">Type</span><Chips label="Transaction type" value={f.group} options={GROUPS.map((g) => ({ value: g.value, label: g.label }))} onChange={(v) => set({ group: v ?? 'all' })} /></div>
            <div class="form-row">
              <SelectField label="Category" value={f.cat} onChange={(v) => set({ cat: v })} options={[{ value: '', label: 'All categories' }, ...topCats.map((c) => ({ value: c.id, label: c.name }))]} />
              <SelectField label="Person" value={f.owner} onChange={(v) => set({ owner: v })} options={owners} />
              <SelectField label="Account" value={f.account} onChange={(v) => set({ account: v })} options={[{ value: '', label: 'All accounts' }, ...db.accounts.map((a) => ({ value: a.id, label: a.name }))]} />
              <SelectField label="Payment method" value={f.method} onChange={(v) => set({ method: v })} options={[{ value: '', label: 'Any method' }, ...(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))]} />
              {tags.length > 0 && <SelectField label="Tag" value={f.tag} onChange={(v) => set({ tag: v })} options={[{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t, label: t }))]} />}
            </div>
          </div>
        </Disclosure>
        {anyFilter && <div class="home-note"><span class="muted">{list.length} match{list.length === 1 ? '' : 'es'}</span><Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button></div>}
      </Card>

      {list.length === 0 ? (
        <Card>
          {all.length === 0
            ? <EmptyState title="No transactions yet" body="Add your first expense or income and it will show up here." action={<Button variant="primary" onClick={() => openQuickAdd('expense')}>Add a transaction</Button>} />
            : <EmptyState title="Nothing matches" body={anyFilter ? 'Try different filters or a different month.' : `No transactions in ${f.month ? monthLabel(f.month, true) : 'this view'}.`}
              action={anyFilter ? <Button onClick={clear}>Clear filters</Button> : <Button variant="primary" onClick={() => openQuickAdd('expense')}>Add a transaction</Button>} />}
        </Card>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.date} aria-label={dayLabel(g.date)}>
              <div class="act-day"><span>{dayLabel(g.date)}</span><span>{formatDate(g.date).replace(/ \d{4}$/, '')}</span></div>
              <Card class="act-list">{g.items.map((t) => <TxnRow key={t.id} db={db} t={t} onOpen={() => open(t)} />)}</Card>
            </section>
          ))}
          {list.length > limit && <div class="act-more"><Button onClick={() => setLimit(limit + PAGE)}>Show more ({list.length - limit} left)</Button></div>}
        </>
      )}
      {detail && <DetailSheet db={db} t={detail} onClose={() => setDetail(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------- row
function describe(db: Database, t: Transaction) {
  const acc = (id?: string) => accountName(db, id);
  const method = t.paymentMethod ? PAYMENT_LABELS[t.paymentMethod] : undefined;
  const cat = categoryName(db, t.subcategoryId) || categoryName(db, t.categoryId);
  const join = (...xs: (string | undefined | false)[]) => xs.filter(Boolean).join(' · ');
  switch (t.type) {
    case 'expense': return { title: t.merchant || cat || 'Expense', sub: join(t.merchant && cat, acc(t.fromAccountId), method) };
    case 'refund': return { title: t.merchant || cat || 'Refund', sub: join(cat, `into ${acc(t.toAccountId)}`) };
    case 'income': return { title: t.incomeType || 'Income', sub: join(t.notes, `into ${acc(t.toAccountId)}`) };
    case 'transfer': case 'cc_settlement': return { title: `${acc(t.fromAccountId)} → ${acc(t.toAccountId)}`, sub: t.type === 'cc_settlement' ? 'Moves money to the card — not a new expense' : t.notes ?? 'Between your own accounts' };
    case 'investment_contribution': return { title: db.investments.find((i) => i.id === t.investmentId)?.name ?? 'Investment', sub: `${acc(t.fromAccountId)} → invested` };
    case 'investment_redemption': return { title: db.investments.find((i) => i.id === t.investmentId)?.name ?? 'Investment', sub: `withdrawn → ${acc(t.toAccountId)}` };
    case 'asset_acquisition': return { title: db.assets.find((a) => a.id === t.assetId)?.name ?? 'Asset', sub: `${acc(t.fromAccountId)} → asset` };
    case 'liability_payment': {
      const l = db.liabilities.find((x) => x.id === t.liabilityId);
      return { title: l?.name ?? 'Loan', sub: join(acc(t.fromAccountId), `principal ${formatMoney(principalPortion(t))}`, interestPortion(t) > 0 && `interest ${formatMoney(interestPortion(t))}`) };
    }
    case 'liability_creation': return { title: db.liabilities.find((x) => x.id === t.liabilityId)?.name ?? 'Loan', sub: t.toAccountId ? `disbursed to ${acc(t.toAccountId)}` : 'Loan recorded' };
    case 'adjustment': return { title: 'Balance correction', sub: join(acc(t.toAccountId), t.notes) };
  }
}

function TxnRow({ db, t, onOpen }: { db: Database; t: Transaction; onOpen: () => void }) {
  const d = describe(db, t);
  const sp = spendingOf(t);
  let amount: preact.ComponentChildren; let rightSub: string | undefined;
  if (t.type === 'expense') amount = <span>{formatMoney(-t.amount)}</span>;
  else if (t.type === 'refund') amount = <span class="act-amt-pos">+{formatMoney(t.amount)}</span>;
  else if (t.type === 'income') amount = <span class="act-amt-pos">+{formatMoney(t.amount)}</span>;
  else if (t.type === 'adjustment') amount = <span class="act-amt-neutral">{t.amount > 0 ? '+' : ''}{formatMoney(t.amount)}</span>;
  else { amount = <span class="act-amt-neutral">{formatMoney(t.amount)}</span>; if (sp > 0) rightSub = `${formatMoney(sp)} spending`; }
  const flags = [t.oneOff && 'one-off', t.recurring && 'recurring'].filter(Boolean).join(' · ');
  return (
    <Row onClick={onOpen}
      title={<span class="act-title">{d.title}{t.type !== 'expense' && <Badge tone={t.type === 'income' ? 'good' : undefined}>{TXN_LABELS[t.type]}</Badge>}<Badge tone="muted">{personName(db, t.ownerId as OwnerId)}</Badge></span>}
      sub={[d.sub, flags].filter(Boolean).join(' · ')} right={amount} rightSub={rightSub} />
  );
}

// ---------------------------------------------------------------- details for types without a form
function DetailSheet({ db, t, onClose }: { db: Database; t: Transaction; onClose: () => void }) {
  const store = useStore(); const [busy, setBusy] = useState(false); const [confirming, setConfirming] = useState(false);
  const d = describe(db, t);
  const remove = async () => {
    setBusy(true);
    try { const r = await store.deleteTransaction(t.id); if (r.ok) { toast('Deleted'); onClose(); } else { toast(r.issues.map((i) => i.message).join(' · '), 'error'); setConfirming(false); } }
    finally { setBusy(false); }
  };
  return (
    <Sheet title={TXN_LABELS[t.type]} onClose={onClose}
      footer={confirming
        ? <><Button variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button><Button variant="danger" disabled={busy} onClick={remove}>Yes, delete</Button></>
        : <><Button variant="danger" onClick={() => setConfirming(true)}>Delete</Button><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <dl class="kv">
        <dt>What</dt><dd>{d.title}</dd>
        <dt>Amount</dt><dd>{formatMoney(t.amount)}</dd>
        <dt>Date</dt><dd>{formatDate(t.date)}</dd>
        <dt>For</dt><dd>{personName(db, t.ownerId)}</dd>
        {t.notes && <><dt>Notes</dt><dd>{t.notes}</dd></>}
      </dl>
      <p class="muted">{d.sub}. This kind of entry is managed from its own page, but you can remove it here.</p>
      {confirming && <p role="alert">Delete this entry? It will be removed from your history and balances.</p>}
    </Sheet>
  );
}

