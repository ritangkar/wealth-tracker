import { useRef } from 'preact/hooks';
import { navigate, useRoute } from '../../router';
import { cx } from '../../kit';
import './plan.css';

export interface TabDef<T extends string = string> { id: T; label: string }

/** Accessible tab row (role=tablist). Arrow keys / Home / End move between tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault(); onChange(tabs[n].id); refs.current[n]?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === value} aria-controls={`panel-${t.id}`} tabIndex={t.id === value ? 0 : -1}
          class={cx('tab')} ref={(el) => { refs.current[i] = el; }} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>{t.label}</button>
      ))}
    </div>
  );
}

/** Current tab from `?tab=`; setter navigates (keeps deep links working). */
export function useTab<T extends string>(path: string, ids: readonly T[]): [T, (t: T) => void] {
  const { query } = useRoute();
  const q = query.get('tab') as T | null;
  const tab = q && ids.includes(q) ? q : ids[0];
  return [tab, (t: T) => navigate(`${path}?tab=${t}`)];
}

export function TabPanel({ id, children }: { id: string; children: preact.ComponentChildren }) {
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} class="px-panel">{children}</div>;
}
