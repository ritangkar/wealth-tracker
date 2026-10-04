import { useEffect, useState } from 'preact/hooks';
import { Banner, Button, Card, Field, MoneyField, Page, Row, TextField, useConfirm, Sheet } from '../kit';
import { toast, useDb, useStore } from '../state';
import { BackupCard } from './settings/Backup';
import { LockCard } from './settings/LockCard';
import { CategoriesCard } from './settings/Categories';
import { checkForUpdate } from '../../pwa/register';
import { sampleDatabase } from '../../data/sample';
import { navigate } from '../router';

function PeopleCard() {
  const db = useDb(); const store = useStore();
  const s = db.settings;
  const [names, setNames] = useState(s.people.map((p) => p.name));
  const [targets, setTargets] = useState({ hh: s.householdSavingsTarget, min: s.householdSavingsMinimum, p: s.people.map((p) => p.savingsTarget) });
  const save = async () => {
    const r = await store.updateSettings({ people: s.people.map((p, i) => ({ ...p, name: names[i].trim(), savingsTarget: targets.p[i] })), householdSavingsTarget: targets.hh, householdSavingsMinimum: targets.min });
    toast(r.ok ? 'Saved' : r.issues[0].message, r.ok ? 'ok' : 'error');
  };
  return (
    <Card title="People & savings targets">
      <div class="form">
        <div class="form-row">{s.people.map((p, i) => <TextField key={p.id} label={i === 0 ? 'First person' : 'Second person'} value={names[i]} onInput={(v) => setNames(names.map((n, j) => (j === i ? v : n)))} />)}</div>
        <div class="form-row">
          <MoneyField label="Household monthly savings target" value={targets.hh} onChange={(v) => setTargets({ ...targets, hh: v ?? 0 })} />
          <MoneyField label="Acceptable minimum" value={targets.min} onChange={(v) => setTargets({ ...targets, min: v ?? 0 })} />
        </div>
        <div class="form-row">{s.people.map((p, i) => <MoneyField key={p.id} label={`${names[i] || p.name}’s target`} value={targets.p[i]} onChange={(v) => setTargets({ ...targets, p: targets.p.map((x, j) => (j === i ? v ?? 0 : x)) })} hint="conceptual — the household total matters most" />)}</div>
        <Button variant="primary" onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

function IncomeTypesCard() {
  const db = useDb(); const store = useStore(); const [v, setV] = useState('');
  const add = async () => { const n = v.trim(); if (!n) return; if (db.settings.incomeTypes.some((t) => t.toLowerCase() === n.toLowerCase())) return toast('Already there', 'error'); await store.updateSettings({ incomeTypes: [...db.settings.incomeTypes, n] }); setV(''); };
  const rm = async (t: string) => { const used = db.transactions.some((x) => x.incomeType === t); if (used) return toast('Used by income entries — it can stay.', 'error'); await store.updateSettings({ incomeTypes: db.settings.incomeTypes.filter((x) => x !== t) }); };
  return (
    <Card title="Income types">
      <div class="chips">{db.settings.incomeTypes.map((t) => <button key={t} type="button" class="chip" onClick={() => rm(t)} aria-label={`Remove ${t}`}>{t} ✕</button>)}</div>
      <div class="form-row"><TextField label="Add a type" value={v} onInput={setV} placeholder="e.g. Freelance" /><div style="align-self:end"><Button onClick={add}>Add</Button></div></div>
    </Card>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('wealthos.theme') ?? 'system'; } catch { return 'system'; } });
  const apply = (t: string) => { setTheme(t); try { localStorage.setItem('wealthos.theme', t); } catch { /* ignore */ } if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); };
  return <Card title="Appearance"><div class="chips" role="radiogroup" aria-label="Theme">{['system', 'light', 'dark'].map((t) => <button key={t} type="button" role="radio" aria-checked={theme === t} class={`chip ${theme === t ? 'chip-on' : ''}`} onClick={() => apply(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div></Card>;
}

function StorageCard() {
  const store = useStore();
  const [info, setInfo] = useState<{ persisted?: boolean; usage?: number; quota?: number }>({});
  const [checking, setChecking] = useState(false);
  const load = async () => {
    const persisted = await navigator.storage?.persisted?.(); const est = await navigator.storage?.estimate?.();
    setInfo({ persisted, usage: est?.usage, quota: est?.quota });
  };
  useEffect(() => { void load(); }, []);
  const ask = async () => { await store.meta.persist?.(); await load(); };
  const upd = async () => { setChecking(true); try { await checkForUpdate(); toast('Checked for updates.'); } catch { toast('Couldn’t check (offline?).', 'error'); } setChecking(false); };
  return (
    <Card title="This device & app">
      <dl class="kv">
        <dt>App version</dt><dd>{store.appVersion}</dd>
        <dt>Storage</dt><dd>{info.persisted === undefined ? 'unknown' : info.persisted ? 'protected from auto-clearing' : 'may be cleared by the browser'}</dd>
        {info.usage !== undefined && <><dt>Space used</dt><dd>{(info.usage / 1024 / 1024).toFixed(2)} MB</dd></>}
        <dt>Works offline</dt><dd>{'serviceWorker' in navigator ? 'yes, once installed' : 'not supported here'}</dd>
      </dl>
      {info.persisted === false && <Banner tone="warn" action={<Button size="sm" onClick={ask}>Request protection</Button>}>Browsers can clear site data under storage pressure (iPhone Safari also clears it after weeks of non-use unless the app is added to the Home Screen). Download backups regularly.</Banner>}
      <div class="page-actions"><Button onClick={upd} disabled={checking}>Check for updates</Button></div>
      <p class="hint">Install: iPhone — Share → Add to Home Screen. Android/desktop Chrome — menu → Install app.</p>
    </Card>
  );
}

function DangerCard() {
  const store = useStore(); const db = useDb(); const [ask, dialog] = useConfirm();
  const [typed, setTyped] = useState(''); const [open, setOpen] = useState(false);
  const empty = db.transactions.length + db.accounts.length === 0;
  const demo = async () => {
    if (!empty && !(await ask({ title: 'Replace your data with demo data?', body: <p>Your current data is saved as a safety copy first (Settings → Backup → safety copies). Demo data is fictional.</p>, confirmLabel: 'Load demo data' }))) return;
    const r = await store.restore(sampleDatabase(store.today(), store.now()), 'replace');
    if (r.ok) { toast('Demo data loaded (fictional).'); navigate('/'); } else toast(r.issues[0].message, 'error');
  };
  const erase = async () => { const r = await store.resetAll(); if (r.ok) { setOpen(false); setTyped(''); toast('All data erased. A safety copy was kept.'); navigate('/welcome'); } else toast(r.issues[0].message, 'error'); };
  return (
    <Card title="Demo & reset">
      <p class="muted">Want to look around first? Load fictional demo data, then erase it when you’re done.</p>
      <div class="page-actions"><Button onClick={demo}>Load demo data</Button><Button variant="danger" onClick={() => setOpen(true)}>Erase all data…</Button></div>
      {open && <Sheet title="Erase all data?" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={typed.trim().toUpperCase() !== 'ERASE'} onClick={erase}>Erase everything</Button></>}>
        <p>This removes every record from this device. We’ll keep an automatic safety copy, but download a backup first if you’re unsure.</p>
        <TextField label="Type ERASE to confirm" value={typed} onInput={setTyped} />
      </Sheet>}
      {dialog}
    </Card>
  );
}

export default function Settings() {
  return (
    <Page title="Settings & backup" subtitle="Your data lives only on this device.">
      <BackupCard />
      <div class="cols cols-2"><PeopleCard /><LockCard /></div>
      <CategoriesCard />
      <div class="cols cols-2"><IncomeTypesCard /><AppearanceCard /></div>
      <StorageCard />
      <DangerCard />
      <Card title="About"><p class="muted">Wealth OS tracks, explains and plans — it is a planning aid, not financial advice. No analytics, no accounts, no servers. Cross-device sync isn’t built in; use backup &amp; merge (see docs/SYNC.md).</p></Card>
    </Page>
  );
}
export { Field, Row };
