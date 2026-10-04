import { useEffect, useState } from 'preact/hooks';

/** Hash routing: works under any GitHub Pages subpath and survives refresh/deep links. */
export interface Route { path: string; query: URLSearchParams }
export function parseHash(h: string): Route {
  const raw = h.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  const path = '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');
  return { path: path === '/' ? '/' : path, query: new URLSearchParams(q) };
}
export function useRoute(): Route {
  const [r, set] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => { set(parseHash(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    set(parseHash(location.hash)); // catch a change that happened before this effect subscribed
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const navigate = (path: string) => { location.hash = path; };
