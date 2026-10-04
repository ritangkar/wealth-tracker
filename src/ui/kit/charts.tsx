/** Tiny dependency-free SVG charts. Every chart has a text summary for assistive tech. */
import { formatCompact, formatMoney } from '../../domain/money';

const W = 320, H = 150, PL = 8, PR = 8, PT = 10, PB = 22;

export interface BarDatum { label: string; value: number; value2?: number }
export function BarChart({ data, summary, color = 'var(--c-primary)', color2 = 'var(--c-accent)', target, legend }: { data: BarDatum[]; summary: string; color?: string; color2?: string; target?: number; legend?: [string, string?] }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0)), target ?? 0);
  const bw = (W - PL - PR) / data.length;
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max);
  const two = data.some((d) => d.value2 !== undefined);
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} class="axis" />
        {target !== undefined && <><line x1={PL} x2={W - PR} y1={y(target)} y2={y(target)} class="target" /><text x={W - PR} y={y(target) - 3} text-anchor="end" class="tick">target</text></>}
        {data.map((d, i) => {
          const x = PL + i * bw; const inner = bw * 0.7; const off = (bw - inner) / 2; const w = two ? inner / 2 : inner;
          return (
            <g key={d.label}>
              <rect x={x + off} y={y(d.value)} width={w} height={Math.max(0, H - PB - y(d.value))} rx="3" fill={color}><title>{`${d.label}: ${formatMoney(d.value)}`}</title></rect>
              {two && <rect x={x + off + w} y={y(d.value2 ?? 0)} width={w} height={Math.max(0, H - PB - y(d.value2 ?? 0))} rx="3" fill={color2}><title>{`${d.label}: ${formatMoney(d.value2 ?? 0)}`}</title></rect>}
              <text x={x + bw / 2} y={H - 7} text-anchor="middle" class="tick">{d.label}</text>
            </g>
          );
        })}
        <text x={PL} y={PT - 1} class="tick">{formatCompact(max)}</text>
      </svg>
      {legend && <figcaption class="legend"><span><i style={{ background: color }} />{legend[0]}</span>{legend[1] && <span><i style={{ background: color2 }} />{legend[1]}</span>}</figcaption>}
    </figure>
  );
}

export interface PointDatum { label: string; value: number }
export function LineChart({ data, summary, color = 'var(--c-primary)', zeroLine = true }: { data: PointDatum[]; summary: string; color?: string; zeroLine?: boolean }) {
  if (data.length < 2) return null;
  const vals = data.map((d) => d.value); let min = Math.min(...vals), max = Math.max(...vals);
  if (zeroLine) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { max = min + 1; }
  const x = (i: number) => PL + 14 + ((W - PL - PR - 28) * i) / (data.length - 1);
  const y = (v: number) => PT + 8 + (H - PT - PB - 8) * (1 - (v - min) / (max - min));
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(data.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z`;
  const step = Math.ceil(data.length / 6);
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {zeroLine && min < 0 && <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} class="axis" />}
        <path d={area} fill={color} opacity=".12" /><path d={path} fill="none" stroke={color} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r="3.5" fill={color}><title>{`${d.label}: ${formatMoney(d.value)}`}</title></circle>)}
        {data.map((d, i) => (i % step === 0 || i === data.length - 1) && <text key={`t${i}`} x={x(i)} y={H - 7} text-anchor="middle" class="tick">{d.label}</text>)}
        <text x={PL} y={PT + 2} class="tick">{formatCompact(max)}</text><text x={PL} y={H - PB - 3} class="tick">{formatCompact(min)}</text>
      </svg>
    </figure>
  );
}

export interface Slice { label: string; value: number }
const PALETTE = ['#0f766e', '#d97706', '#4f46e5', '#be185d', '#0891b2', '#65a30d', '#9333ea', '#64748b'];
export function Breakdown({ items, total, max = 6, onSelect }: { items: Slice[]; total?: number; max?: number; onSelect?: (label: string) => void }) {
  const t = total ?? items.reduce((s, i) => s + Math.max(0, i.value), 0);
  if (t <= 0) return null;
  const top = items.filter((i) => i.value > 0).slice(0, max);
  const rest = items.filter((i) => i.value > 0).slice(max).reduce((s, i) => s + i.value, 0);
  const rows = rest > 0 ? [...top, { label: 'Everything else', value: rest }] : top;
  return (
    <div class="breakdown">
      <div class="stackbar" role="img" aria-label={rows.map((r) => `${r.label} ${Math.round((r.value / t) * 100)}%`).join(', ')}>
        {rows.map((r, i) => <span key={r.label} style={{ width: `${(r.value / t) * 100}%`, background: PALETTE[i % PALETTE.length] }} />)}
      </div>
      <ul class="bk-list">
        {rows.map((r, i) => (
          <li key={r.label}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            {onSelect ? <button type="button" class="linklike" onClick={() => onSelect(r.label)}>{r.label}</button> : <span>{r.label}</span>}
            <span class="bk-pct">{Math.round((r.value / t) * 100)}%</span><b>{formatMoney(r.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ values, summary }: { values: number[]; summary: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values, min + 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min)) * 24}`).join(' ');
  return <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={summary}><polyline points={pts} fill="none" stroke="var(--c-primary)" stroke-width="2" vector-effect="non-scaling-stroke" /></svg>;
}
