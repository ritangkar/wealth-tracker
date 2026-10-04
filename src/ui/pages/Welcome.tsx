import { useState } from 'preact/hooks';
import { Banner, Button, Card, Chips, MoneyField, Page, SelectField, TextField } from '../kit';
import { toast, useDb, useStore, ownerOptions } from '../state';
import { navigate } from '../router';
import type { AccountKind, OwnerId } from '../../domain/types';
import { ACCOUNT_KIND_LABELS, formatMoney } from '../format';
import { sampleDatabase } from '../../data/sample';

const PRESETS: { name: string; kind: AccountKind }[] = [
  { name: 'HDFC Savings', kind: 'bank' }, { name: 'HDFC Salary Account', kind: 'bank' }, { name: 'Cash', kind: 'cash' }, { name: 'Credit Card', kind: 'credit_card' }, { name: 'Investment Account', kind: 'investment' },
];

export default function Welcome() {
  const db = useDb(); const store = useStore();
  const [names, setNames] = useState(db.settings.people.map((p) => p.name));
  const [draft, setDraft] = useState<{ name: string; kind: AccountKind; owner: OwnerId; balance?: number; limit?: number }>({ name: '', kind: 'bank', owner: 'p1' });
  const [err, setErr] = useState('');

  const saveNames = async () => { await store.updateSettings({ people: db.settings.people.map((p, i) => ({ ...p, name: names[i].trim() || p.name })) }); toast('Names saved'); };
  const add = async () => {
    setErr('');
    const isCard = draft.kind === 'credit_card';
    const r = await store.addAccount({ name: draft.name.trim(), kind: draft.kind, ownerId: draft.owner, openingBalance: isCard ? -(draft.balance ?? 0) : draft.balance ?? 0, openingDate: store.today(), ...(isCard ? { card: { creditLimit: draft.limit ?? 0 } } : {}) });
    if (r.ok) { toast(`${draft.name} added`); setDraft({ ...draft, name: '', balance: undefined, limit: undefined }); } else setErr(r.issues.map((i) => i.message).join(' · '));
  };
  const demo = async () => { const r = await store.restore(sampleDatabase(store.today(), store.now()), 'replace'); if (r.ok) { toast('Demo data loaded (fictional).'); navigate('/'); } };

  return (
    <Page title="Welcome" subtitle="Track → Understand → Optimize → Save → Grow. Everything stays on your device.">
      <Card title="1 · Who’s tracking?">
        <div class="form-row">{names.map((n, i) => <TextField key={i} label={i === 0 ? 'You' : 'Partner'} value={n} onInput={(v) => setNames(names.map((x, j) => (j === i ? v : x)))} />)}</div>
        <Button onClick={saveNames}>Save names</Button>
      </Card>
      <Card title="2 · Add your accounts">
        <p class="muted">Add where money sits (and your credit card). UPI is a <i>payment method</i>, not an account — you’ll pick it when adding an expense. Starting balances can be approximate; you can correct them later.</p>
        {db.accounts.length > 0 && <ul>{db.accounts.map((a) => <li key={a.id}>{a.name} · {ACCOUNT_KIND_LABELS[a.kind]} · {formatMoney(Math.abs(a.openingBalance))}{a.kind === 'credit_card' ? ' owed' : ''}</li>)}</ul>}
        <Chips label="Quick picks" value={undefined} options={PRESETS.map((p) => ({ value: p.name, label: p.name }))} onChange={(v) => { const p = PRESETS.find((x) => x.name === v); if (p) setDraft({ ...draft, name: p.name, kind: p.kind }); }} />
        <div class="form">
          <TextField label="Account name" value={draft.name} onInput={(v) => setDraft({ ...draft, name: v })} />
          <div class="form-row">
            <SelectField label="Type" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} options={Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => ({ value: value as AccountKind, label }))} />
            <SelectField label="Belongs to" value={draft.owner} onChange={(v) => setDraft({ ...draft, owner: v })} options={ownerOptions(db)} />
          </div>
          <MoneyField label={draft.kind === 'credit_card' ? 'Amount currently owed on the card' : 'Balance today'} value={draft.balance} onChange={(v) => setDraft({ ...draft, balance: v })} />
          {draft.kind === 'credit_card' && <MoneyField label="Total credit limit" value={draft.limit} onChange={(v) => setDraft({ ...draft, limit: v })} hint="Never enter card numbers, CVV or PINs anywhere in this app." />}
          {err && <Banner tone="error">{err}</Banner>}
          <Button variant="primary" onClick={add} disabled={!draft.name.trim()}>Add account</Button>
        </div>
      </Card>
      <Card title="3 · Start tracking" tone="accent">
        <p>Use the ＋ button to add an expense in a few taps. Add loans, EMIs, investments and goals whenever you like.</p>
        <div class="page-actions"><Button variant="primary" onClick={() => navigate('/')}>Go to Home</Button><Button variant="ghost" onClick={demo}>Look around with demo data</Button></div>
      </Card>
    </Page>
  );
}
