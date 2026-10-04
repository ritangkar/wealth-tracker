/** Service worker registration with a user-controlled update flow (no surprise reloads mid-entry). */
export type UpdateState = { waiting: ServiceWorker | null; offlineReady: boolean };
type Listener = (s: UpdateState) => void;
let state: UpdateState = { waiting: null, offlineReady: false };
const listeners = new Set<Listener>();
const set = (p: Partial<UpdateState>) => { state = { ...state, ...p }; listeners.forEach((l) => l(state)); };
export const onUpdateState = (l: Listener) => { listeners.add(l); l(state); return () => { listeners.delete(l); }; };

let reg: ServiceWorkerRegistration | undefined;
export async function registerSW(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    // relative URL: resolves against the page, so it works under /<repo>/ on GitHub Pages
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (reg.active && !navigator.serviceWorker.controller) set({ offlineReady: true });
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') { if (navigator.serviceWorker.controller) set({ waiting: w }); else set({ offlineReady: true }); }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) set({ waiting: reg.waiting });
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg!.installing));
    // reload only when an UPDATE replaces an existing controller (not on first install's clients.claim())
    let reloading = false; const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !hadController) return; reloading = true; location.reload(); });
    // check for a new deploy when the app returns to the foreground and hourly
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg?.update().catch(() => {}); });
    setInterval(() => void reg?.update().catch(() => {}), 60 * 60 * 1000);
  } catch (e) { console.warn('Service worker registration failed', e); }
}
export const checkForUpdate = async () => { await reg?.update(); };
export function applyUpdate() { state.waiting?.postMessage('SKIP_WAITING'); }
