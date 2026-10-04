import { render } from 'preact';
import './ui/styles.css';
import { Store } from './data/store';
import { IdbStorage } from './data/idb';
import { StoreContext, useScope } from './ui/state';
import { useRoute } from './ui/router';
import { ROUTES } from './ui/routes';
function H() {
  const r = useRoute(); useScope();
  const C = (ROUTES.find((x) => x.path === r.path) ?? ROUTES[0]).component;
  return <main class="main" style="margin:0 auto;max-width:1040px"><C /></main>;
}
(async () => {
  const store = await Store.open(new IdbStorage(), {});
  (window as any).__store = store;
  render(<StoreContext.Provider value={store}><H /></StoreContext.Provider>, document.getElementById('app')!);
})();
