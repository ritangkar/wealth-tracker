import { createContext } from 'preact';
import { useContext, useEffect, useState, useCallback } from 'preact/hooks';
import type { Store } from '../data/store';
import type { Database, OwnerId, ViewScope } from '../domain/types';

export const StoreContext = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(StoreContext);

/** Re-render when the store changes. Returns the current immutable Database. */
export function useDb(): Database {
  const store = useStore();
  const [, set] = useState(0);
  useEffect(() => store.subscribe(() => set((n) => n + 1)), [store]);
  return store.db;
}

// ---- view scope (household | p1 | p2), remembered per device
const KEY = 'wealthos.scope';
let scope: ViewScope = 'household';
try { const s = localStorage.getItem(KEY); if (s === 'p1' || s === 'p2' || s === 'household') scope = s; } catch { /* storage unavailable */ }
const scopeListeners = new Set<() => void>();
export function setScope(s: ViewScope) { scope = s; try { localStorage.setItem(KEY, s); } catch { /* ignore */ } scopeListeners.forEach((l) => l()); }
export function useScope(): [ViewScope, (s: ViewScope) => void] {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((n) => n + 1); scopeListeners.add(l); return () => { scopeListeners.delete(l); }; }, []);
  return [scope, setScope];
}

export const personName = (db: Database, o: OwnerId | ViewScope): string =>
  o === 'hh' || o === 'household' ? 'Household' : db.settings.people.find((p) => p.id === o)?.name ?? o;
export const ownerOptions = (db: Database, withJoint = true): { value: OwnerId; label: string }[] => [
  ...db.settings.people.map((p) => ({ value: p.id as OwnerId, label: p.name })),
  ...(withJoint ? [{ value: 'hh' as OwnerId, label: 'Joint / household' }] : []),
];
/** Default owner for new records: the person being viewed, else last-used default, else first person. */
export const defaultOwner = (db: Database, s: ViewScope): OwnerId => (s !== 'household' ? s : db.settings.defaults.ownerId ?? 'p1');

// ---- toasts
export interface ToastMsg { id: number; text: string; tone: 'ok' | 'error' }
let toasts: ToastMsg[] = []; let tid = 0; const toastListeners = new Set<() => void>();
export function toast(text: string, tone: 'ok' | 'error' = 'ok') {
  const t = { id: ++tid, text, tone }; toasts = [...toasts, t]; toastListeners.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); toastListeners.forEach((l) => l()); }, tone === 'error' ? 6000 : 3000);
}
export function useToasts() {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((n) => n + 1); toastListeners.add(l); return () => { toastListeners.delete(l); }; }, []);
  return toasts;
}

// ---- quick-add sheet control
export type QuickKind = 'expense' | 'income' | 'transfer' | 'invest' | 'loan' | 'waste' | 'goal' | 'more';
let quick: { kind: QuickKind; editId?: string } | null = null; const quickListeners = new Set<() => void>();
export function openQuickAdd(kind: QuickKind = 'expense', editId?: string) { quick = { kind, editId }; quickListeners.forEach((l) => l()); }
export function closeQuickAdd() { quick = null; quickListeners.forEach((l) => l()); }
export function useQuickAdd() {
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((n) => n + 1); quickListeners.add(l); return () => { quickListeners.delete(l); }; }, []);
  return quick;
}

/** Helper for async actions with toast feedback. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<{ ok: true; value: T } | { ok: false; issues: { message: string }[] }>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) { if (success) toast(success); return r.value; }
      toast(r.issues.map((i) => i.message).join(' · '), 'error');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
    return undefined;
  }, []);
  return { busy, run };
}
