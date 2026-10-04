/* Wealth OS service worker. Generated into dist/sw.js at build time (see vite.config.ts).
 * - Precaches the whole app shell with RELATIVE urls, so it works under any GitHub Pages subpath.
 * - Cache name contains the build id: a new deploy = new cache; old caches are deleted on activate.
 * - New workers WAIT (no skipWaiting) so a user never gets half-old/half-new code mid-session; the page offers "Update".
 * - Navigations: network-first (fresh index.html when online), cache fallback when offline.
 * - No data ever goes through here: user data lives in IndexedDB only.
 */
const BUILD_ID = '__BUILD_ID__';
const CONTENT_REV = '__CONTENT_REV__';
const PRECACHE = __PRECACHE__;
const CACHE = `wealth-os-${BUILD_ID}-${CONTENT_REV}`;
const PREFIX = 'wealth-os-';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' bypasses the HTTP cache so a fresh deploy is never precached from stale responses
    await Promise.all(PRECACHE.map(async (url) => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`Precache failed for ${url}: ${res.status}`);
      await cache.put(url, res);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', buildId: BUILD_ID });
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    // no-cache = always revalidate with the server, so Pages' max-age never serves a stale shell after a deploy
    const res = await fetch(request.url, { cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) { cache.put('./index.html', res.clone()); return res; }
  } catch (_) { /* offline or slow: fall through */ }
  return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin traffic
  if (req.mode === 'navigate') { event.respondWith(networkFirstNavigation(req)); return; }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
