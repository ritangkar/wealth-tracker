import { render } from 'preact';
import './ui/styles.css';
import { Store } from './data/store';
import { MemoryStorage } from './data/storage';
import { StoreContext, useScope, useToasts, setScope, useDb } from './ui/state';
import { useRoute } from './ui/router';
import { ROUTES } from './ui/routes';
import QuickAdd from './ui/quickadd/QuickAdd';
function H() {
  const r = useRoute(); const [scope] = useScope(); useDb(); const toasts = useToasts();
  const C = (ROUTES.find((x) => x.path === r.path) ?? ROUTES[0]).component;
  return <div class="shell"><div class="topbar"><div class="brand"><i />Wealth OS</div><div class="scope">{(['household','p1','p2'] as const).map((s) => <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}>{s}</button>)}</div></div><main class="main"><C /></main><QuickAdd /><div class="toasts">{toasts.map((t) => <div key={t.id} class="toast">{t.text}</div>)}</div></div>;
}
(async () => {
  const store = await Store.open(new MemoryStorage(), {});
  (window as any).__store = store;
  render(<StoreContext.Provider value={store}><H /></StoreContext.Provider>, document.getElementById('app')!);
})();
