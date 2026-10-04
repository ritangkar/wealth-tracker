import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../data/store';
import { StoreContext, openQuickAdd, setScope, toast, useDb, useScope, useToasts } from './state';
import { navigate, useRoute } from './router';
import { ROUTES } from './routes';
import { Banner, Button, Card } from './kit';
import QuickAdd from './quickadd/QuickAdd';
import { LockScreen } from './Lock';
import { hasPin } from './lock';
import { applyUpdate, onUpdateState, type UpdateState } from '../pwa/register';
import type { ViewScope } from '../domain/types';

function useOnline() {
  const [on, set] = useState(navigator.onLine);
  useEffect(() => { const a = () => set(true), b = () => set(false); window.addEventListener('online', a); window.addEventListener('offline', b); return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); }; }, []);
  return on;
}

function ScopeSwitch() {
  const db = useDb(); const [scope, set] = useScope();
  const opts: { value: ViewScope; label: string }[] = [{ value: 'household', label: 'Household' }, ...db.settings.people.map((p) => ({ value: p.id as ViewScope, label: p.name }))];
  return (
    <div class="scope" role="radiogroup" aria-label="Whose finances to show">
      {opts.map((o) => <button key={o.value} type="button" role="radio" aria-checked={scope === o.value} onClick={() => set(o.value)}>{o.label}</button>)}
    </div>
  );
}

function Recovery({ store }: { store: Store }) {
  const r = store.recovery!;
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.raw], { type: 'application/json' })); a.download = 'wealth-os-raw-stored-data.json'; a.click(); };
  return (
    <div class="fullscreen"><Card>
      <h1>We couldn’t open your data safely</h1>
      <Banner tone="error">Nothing has been changed or deleted. The app is paused so it can’t overwrite anything.</Banner>
      <ul>{r.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
      <Button onClick={download}>Download what’s stored (JSON)</Button>
      <p class="muted">If this happened after an app update, reloading or updating the app may fix it. You can also keep the downloaded file for support.</p>
    </Card></div>
  );
}

function UpdateBar() {
  const [s, setS] = useState<UpdateState>({ waiting: null, offlineReady: false });
  const [hide, setHide] = useState(false);
  useEffect(() => onUpdateState(setS), []);
  useEffect(() => { if (s.offlineReady) { toast('Ready to work offline'); } }, [s.offlineReady]);
  if (!s.waiting || hide) return null;
  return <div class="update-bar"><Banner tone="good" action={<span><Button size="sm" variant="primary" onClick={applyUpdate}>Update now</Button> <Button size="sm" variant="ghost" onClick={() => setHide(true)}>Later</Button></span>}>A new version is ready. Your data is safe.</Banner></div>;
}

export function App({ store }: { store: Store }) {
  return <StoreContext.Provider value={store}><Shell store={store} /></StoreContext.Provider>;
}

function Shell({ store }: { store: Store }) {
  const route = useRoute();
  const db = useDb();
  const online = useOnline();
  const toasts = useToasts();
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => { if (store.status !== 'ready') return; (async () => setLocked(db.settings.lockEnabled && (await hasPin(store.meta))))(); /* only at boot */ // eslint-disable-next-line
  }, []);
  // re-lock after the app has been in the background for 2 minutes
  useEffect(() => {
    let hiddenAt = 0;
    const on = async () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 120_000 && store.db.settings.lockEnabled && (await hasPin(store.meta))) setLocked(true);
    };
    document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on);
  }, []);
  // keep today's net-worth snapshot fresh (real data only), debounced
  useEffect(() => {
    if (store.status !== 'ready' || !db.accounts.length) return;
    const t = setTimeout(() => { void store.captureSnapshot(); }, 1500); return () => clearTimeout(t);
  }, [db.transactions, db.accounts, db.valuations, db.investments, db.assets, db.liabilities]);

  if (store.status === 'recovery') return <Recovery store={store} />;
  if (locked === null) return null;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  const def = ROUTES.find((r) => r.path === route.path);
  const Page = def?.component;
  const isNew = db.accounts.length === 0 && db.transactions.length === 0;
  const mainNav = ROUTES.filter((r) => r.group === 'main');
  const more = ROUTES.filter((r) => r.group === 'more');
  const active = (p: string) => (route.path === p ? 'page' : undefined);

  return (
    <>
      <div class="shell">
        <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
        <div class="topbar">
          <div class="brand-wrap"><div class="brand"><i aria-hidden="true" />Wealth OS</div></div>
          <ScopeSwitch />
          {!online && <span class="offline-pill" role="status">Offline — all data is local</span>}
        </div>
        <nav class="sidenav" aria-label="Main">
          <Button variant="primary" class="add-btn" onClick={() => openQuickAdd('expense')}>＋ Add</Button>
          {[...mainNav, ...more].map((r) => <a key={r.path} href={`#${r.path}`} aria-current={active(r.path)}><span aria-hidden="true">{r.icon}</span>{r.title}</a>)}
        </nav>
        <main class="main" id="main" tabIndex={-1}>
          {store.persistError && <Banner tone="error">Your last change could not be saved: {store.persistError}. Export a backup if this keeps happening.</Banner>}
          {isNew && route.path !== '/welcome' && route.path !== '/settings' ? <WelcomeNudge /> : null}
          {Page ? <Page /> : <Card><h2>Page not found</h2><Button onClick={() => navigate('/')}>Go home</Button></Card>}
        </main>
        <nav class="bottomnav" aria-label="Main">
          <a href="#/" aria-current={active('/')}><span class="ico" aria-hidden="true">⌂</span>Home</a>
          <a href="#/activity" aria-current={active('/activity')}><span class="ico" aria-hidden="true">☰</span>Activity</a>
          <button type="button" class="fab fab-mobile" aria-label="Add transaction" onClick={() => openQuickAdd('expense')}>＋</button>
          <a href="#/wealth" aria-current={active('/wealth')}><span class="ico" aria-hidden="true">◈</span>Wealth</a>
          <a href="#/more" aria-current={more.some((m) => m.path === route.path) || route.path === '/more' ? 'page' : undefined}><span class="ico" aria-hidden="true">⋯</span>More</a>
        </nav>
        <QuickAdd />
        <UpdateBar />
        <div class="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} class={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}>{t.text}</div>)}</div>
      </div>
    </>
  );
}

function WelcomeNudge() {
  return <Banner tone="info" action={<Button size="sm" variant="primary" onClick={() => navigate('/welcome')}>Set up</Button>}>New here? Add your accounts to get started — it takes about a minute.</Banner>;
}
export { setScope };
