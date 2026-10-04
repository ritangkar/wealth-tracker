import { render } from 'preact';
import './ui/styles.css';
import { Store } from './data/store';
import { IdbStorage } from './data/idb';
import { App } from './ui/App';
import { registerSW } from './pwa/register';

try { const t = localStorage.getItem('wealthos.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch { /* storage unavailable */ }

async function boot() {
  const root = document.getElementById('app')!;
  try {
    const storage = new IdbStorage();
    const store = await Store.open(storage, { appVersion: __APP_VERSION__, channel: 'wealth-os-sync' });
    void storage.persist();
    root.textContent = ''; // remove the static "Loading…" placeholder
    render(<App store={store} />, root);
    void registerSW();
    // debug/e2e hook, only on localhost (never exposed on the deployed site)
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') (window as unknown as { __store?: Store }).__store = store;
  } catch (e) {
    root.innerHTML = '';
    const p = document.createElement('p'); p.style.cssText = 'font-family:system-ui;padding:2rem;max-width:36rem;margin:auto';
    p.textContent = `Wealth OS could not open its local database (${(e as Error).message}). Private browsing or blocked site data can cause this. Nothing was changed.`;
    root.appendChild(p);
  }
}
void boot();
