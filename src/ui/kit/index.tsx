import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { parseRupees } from '../../domain/money';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

// ---------------------------------------------------------------- layout
export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="page">
      <header class="page-head">
        <div><h1>{title}</h1>{subtitle && <p class="muted">{subtitle}</p>}</div>
        {actions && <div class="page-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
export function Card({ title, action, children, class: c, tone }: { title?: string; action?: ComponentChildren; children: ComponentChildren; class?: string; tone?: 'soft' | 'accent' | 'warn' }) {
  return (
    <div class={cx('card', tone && `card-${tone}`, c)}>
      {(title || action) && <div class="card-head">{title && <h2>{title}</h2>}{action}</div>}
      {children}
    </div>
  );
}
export function Grid({ children, cols = 2 }: { children: ComponentChildren; cols?: 2 | 3 | 4 }) { return <div class={`grid grid-${cols}`}>{children}</div>; }
export function Stat({ label, value, sub, tone, hint }: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: 'good' | 'warn' | 'neutral'; hint?: string }) {
  return (
    <div class={cx('stat', tone && `stat-${tone}`)} title={hint}>
      <div class="stat-label">{label}</div><div class="stat-value">{value}</div>{sub && <div class="stat-sub">{sub}</div>}
    </div>
  );
}
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ComponentChildren }) {
  return <div class="empty"><div class="empty-icon" aria-hidden="true">✦</div><h3>{title}</h3>{body && <p class="muted">{body}</p>}{action}</div>;
}
export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'good' | 'error'; children: ComponentChildren; action?: ComponentChildren }) {
  return <div class={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><div>{children}</div>{action}</div>;
}
export function Badge({ children, tone }: { children: ComponentChildren; tone?: 'good' | 'warn' | 'muted' | 'info' }) { return <span class={cx('badge', tone && `badge-${tone}`)}>{children}</span>; }
export function Progress({ pct, label, tone }: { pct: number; label?: string; tone?: 'good' | 'warn' }) {
  const v = Math.max(0, Math.min(100, pct));
  return <div class={cx('progress', tone && `progress-${tone}`)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><div style={{ width: `${v}%` }} /></div>;
}
export function Row({ title, sub, right, rightSub, onClick, leading, href }: { title: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren; rightSub?: ComponentChildren; onClick?: () => void; leading?: ComponentChildren; href?: string }) {
  const inner = (<>
    {leading && <div class="row-lead">{leading}</div>}
    <div class="row-main"><div class="row-title">{title}</div>{sub && <div class="row-sub">{sub}</div>}</div>
    {(right || rightSub) && <div class="row-right"><div class="row-amt">{right}</div>{rightSub && <div class="row-sub">{rightSub}</div>}</div>}
  </>);
  if (href) return <a class="row row-click" href={href}>{inner}</a>;
  if (onClick) return <button type="button" class="row row-click" onClick={onClick}>{inner}</button>;
  return <div class="row">{inner}</div>;
}
export function Disclosure({ summary, children, open }: { summary: string; children: ComponentChildren; open?: boolean }) {
  return <details class="disclosure" open={open}><summary>{summary}</summary><div class="disclosure-body">{children}</div></details>;
}

// ---------------------------------------------------------------- buttons & selection
type BtnProps = JSX.IntrinsicElements['button'] & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' };
export function Button({ variant = 'secondary', size = 'md', class: c, type = 'button', ...rest }: BtnProps) {
  return <button type={type} class={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', c as string)} {...rest} />;
}
/** Standard radio-group keyboard behaviour: roving tabindex, arrows move focus AND select. */
function useRadioKeys<T extends string>(options: { value: T }[], value: T | undefined, select: (v: T) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  const tabbable = idx >= 0 ? idx : 0;
  const onKeyDown = (e: KeyboardEvent) => {
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown'; const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back && e.key !== 'Home' && e.key !== 'End') return;
    if (!options.length) return;
    e.preventDefault();
    const cur = (e.target as HTMLElement).closest('[role="radio"]');
    const from = cur ? Array.from(ref.current?.querySelectorAll('[role="radio"]') ?? []).indexOf(cur) : tabbable;
    const n = options.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (from + (fwd ? 1 : -1) + n) % n;
    select(options[next].value);
    requestAnimationFrame(() => (ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next])?.focus());
  };
  return { ref, tabbable, onKeyDown };
}
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const k = useRadioKeys(options, value, onChange);
  return (
    <div class="segmented" role="radiogroup" aria-label={label} ref={k.ref} onKeyDown={k.onKeyDown}>
      {options.map((o, i) => (
        <button type="button" key={o.value} role="radio" aria-checked={o.value === value} tabIndex={i === k.tabbable ? 0 : -1} class={cx('seg', o.value === value && 'seg-on')} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
export function Chips<T extends string>({ value, options, onChange, label, allowNone }: { value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T | undefined) => void; label: string; allowNone?: boolean }) {
  const k = useRadioKeys(options, value, (v) => onChange(v));
  return (
    <div class="chips" role="radiogroup" aria-label={label} ref={k.ref} onKeyDown={k.onKeyDown}>
      {options.map((o, i) => (
        <button type="button" key={o.value} role="radio" aria-checked={o.value === value} tabIndex={i === k.tabbable ? 0 : -1} class={cx('chip', o.value === value && 'chip-on')} onClick={() => onChange(allowNone && o.value === value ? undefined : o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: string; children: (a: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ComponentChildren; id?: string }) {
  const gen = useId(); const fid = id ?? gen; const did = `${fid}-d`;
  return (
    <div class={cx('field', error && 'field-error')}>
      <label for={fid}>{label}</label>
      {children({ id: fid, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? did : undefined })}
      {(error || hint) && <div id={did} class={error ? 'err' : 'hint'}>{error ?? hint}</div>}
    </div>
  );
}
export function TextField({ label, value, onInput, error, hint, placeholder, list, autoFocus, maxLength, required }: { label: string; value: string; onInput: (v: string) => void; error?: string; hint?: string; placeholder?: string; list?: string; autoFocus?: boolean; maxLength?: number; required?: boolean }) {
  return <Field label={label} error={error} hint={hint}>{(a) => <input {...a} type="text" value={value} placeholder={placeholder} list={list} autoFocus={autoFocus} maxLength={maxLength} required={required} onInput={(e) => onInput((e.target as HTMLInputElement).value)} autocomplete="off" />}</Field>;
}
/** PIN / secret input: masked, numeric keypad on phones, never autofilled or remembered. */
export function PasswordField({ label, value, onInput, error, hint, maxLength, autoComplete = 'off', autoFocus }: { label: string; value: string; onInput: (v: string) => void; error?: string; hint?: string; maxLength?: number; autoComplete?: 'off' | 'new-password' | 'current-password'; autoFocus?: boolean }) {
  return <Field label={label} error={error} hint={hint}>{(a) => <input {...a} type="password" inputMode="numeric" autocomplete={autoComplete} value={value} maxLength={maxLength} autoFocus={autoFocus} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />}</Field>;
}
export function TextArea({ label, value, onInput, hint }: { label: string; value: string; onInput: (v: string) => void; hint?: string }) {
  return <Field label={label} hint={hint}>{(a) => <textarea {...a} rows={2} value={value} onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)} />}</Field>;
}
/** Money input: user types rupees; value is integer paise (or undefined when empty/invalid). */
export function MoneyField({ label, value, onChange, error, hint, autoFocus, big, allowNegative }: { label: string; value: number | undefined; onChange: (paise: number | undefined) => void; error?: string; hint?: string; autoFocus?: boolean; big?: boolean; allowNegative?: boolean }) {
  const [text, setText] = useState(value === undefined ? '' : String(value / 100));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setText(value === undefined ? '' : String(value / 100)); } }, [value]);
  const parsed = text.trim() === '' ? undefined : parseRupees(text);
  const bad = text.trim() !== '' && (parsed === null || (!allowNegative && (parsed ?? 0) < 0));
  return (
    <Field label={label} error={error ?? (bad ? 'Enter a valid amount, e.g. 1250 or 1250.50' : undefined)} hint={hint}>
      {(a) => (
        <div class={cx('money-in', big && 'money-big')}>
          <span aria-hidden="true">₹</span>
          <input {...a} type="text" inputMode={allowNegative ? 'text' : 'decimal'} autoComplete="off" autoFocus={autoFocus} value={text} placeholder="0"
            onInput={(e) => { const t = (e.target as HTMLInputElement).value; setText(t); const p = t.trim() === '' ? undefined : parseRupees(t); const v = p === null || (!allowNegative && (p ?? 0) < 0) ? undefined : p; last.current = v; onChange(v); }} />
        </div>
      )}
    </Field>
  );
}
export function DateField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return <Field label={label} error={error}>{(a) => <input {...a} type="date" value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />}</Field>;
}
export function SelectField<T extends string>({ label, value, onChange, options, error, placeholder, hint }: { label: string; value: T | undefined; onChange: (v: T) => void; options: { value: T; label: string }[]; error?: string; placeholder?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(a) => (
        <select {...a} value={value ?? ''} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
          {(placeholder || value === undefined) && <option value="" disabled>{placeholder ?? 'Choose…'}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}
export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return <div class="check"><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /><label for={id}>{label}{hint && <span class="hint"> {hint}</span>}</label></div>;
}
export function IntField({ label, value, onChange, error, hint, min, max }: { label: string; value: number | undefined; onChange: (n: number | undefined) => void; error?: string; hint?: string; min?: number; max?: number }) {
  return <Field label={label} error={error} hint={hint}>{(a) => <input {...a} type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} onInput={(e) => { const t = (e.target as HTMLInputElement).value; onChange(t === '' ? undefined : Math.trunc(Number(t))); }} />}</Field>;
}
export function FormErrors({ issues }: { issues: { field: string; message: string }[] }) {
  const general = issues.filter((i) => i.field === '_');
  return general.length ? <div class="banner banner-error" role="alert">{general.map((i) => i.message).join(' · ')}</div> : null;
}
export const fieldError = (issues: { field: string; message: string }[], f: string) => issues.find((i) => i.field === f)?.message;

// ---------------------------------------------------------------- sheet / dialog
export function Sheet({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
    (el.querySelector<HTMLElement>('[autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') { const f = focusables(); if (!f.length) return; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    el.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { el.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); prev?.focus?.(); };
  }, []);
  return (
    <div class="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={cx('sheet', wide && 'sheet-wide')} role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref}>
        <div class="sheet-head"><h2 id={tid}>{title}</h2><button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div class="sheet-body">{children}</div>
        {footer && <div class="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: { title: string; body: ComponentChildren; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Sheet title={title} onClose={onCancel} footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button></>}><div>{body}</div></Sheet>;
}
/** Hook: const [ask, dialog] = useConfirm(); ask({title, body, danger}).then(ok => …) */
export function useConfirm(): [(o: { title: string; body: ComponentChildren; confirmLabel?: string; danger?: boolean }) => Promise<boolean>, ComponentChildren] {
  const [state, setState] = useState<null | { o: { title: string; body: ComponentChildren; confirmLabel?: string; danger?: boolean }; res: (b: boolean) => void }>(null);
  const ask = (o: { title: string; body: ComponentChildren; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((res) => setState({ o, res }));
  const done = (b: boolean) => { state?.res(b); setState(null); };
  return [ask, state && <ConfirmDialog {...state.o} onConfirm={() => done(true)} onCancel={() => done(false)} />];
}
