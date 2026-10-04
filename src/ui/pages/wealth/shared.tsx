import type { ComponentChildren } from 'preact';
import { Badge } from '../../kit';
import { navigate } from '../../router';
import { personName } from '../../state';
import type { Database, OwnerId } from '../../../domain/types';
import { diffDays } from '../../../domain/dates';
import './wealth.css';

export function Tabs({ tabs, value, base, label }: { tabs: { id: string; label: string }[]; value: string; base: string; label: string }) {
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    if (e.key === 'ArrowRight') navigate(`${base}?tab=${tabs[(i + 1) % tabs.length].id}`);
    if (e.key === 'ArrowLeft') navigate(`${base}?tab=${tabs[(i - 1 + tabs.length) % tabs.length].id}`);
  };
  return (
    <div class="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} class="tab" onClick={() => navigate(`${base}?tab=${t.id}`)}>{t.label}</button>
      ))}
    </div>
  );
}

export const OwnerBadge = ({ db, owner }: { db: Database; owner: OwnerId }) => <Badge tone={owner === 'hh' ? 'info' : undefined}>{personName(db, owner)}</Badge>;

export const Note = ({ children }: { children: ComponentChildren }) => <p class="hint note">{children}</p>;

/** Whole days since a date, or null. */
export const daysSince = (date: string | undefined, today: string): number | null => (date ? diffDays(today, date) : null);

export const shortDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** Two-series line chart (value vs invested). Hand-drawn SVG like the kit charts; includes a text summary. */
export function DualLine({ data, summary, labels }: { data: { label: string; a: number; b: number }[]; summary: string; labels: [string, string] }) {
  if (data.length < 2) return null;
  const W = 320, H = 150, PL = 8, PR = 8, PT = 14, PB = 22;
  const vals = data.flatMap((d) => [d.a, d.b]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) max = min + 1;
  const x = (i: number) => PL + 14 + ((W - PL - PR - 28) * i) / (data.length - 1);
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - min) / (max - min));
  const path = (k: 'a' | 'b') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const step = Math.ceil(data.length / 5);
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} class="axis" />
        <path d={path('b')} fill="none" stroke="var(--c-accent)" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round" />
        <path d={path('a')} fill="none" stroke="var(--c-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.a)} r="3" fill="var(--c-primary)" />)}
        {data.map((d, i) => (i % step === 0 || i === data.length - 1) && <text key={`t${i}`} x={x(i)} y={H - 7} text-anchor="middle" class="tick">{d.label}</text>)}
      </svg>
      <figcaption class="legend"><span><i style={{ background: 'var(--c-primary)' }} />{labels[0]}</span><span><i style={{ background: 'var(--c-accent)' }} />{labels[1]}</span></figcaption>
    </figure>
  );
}
