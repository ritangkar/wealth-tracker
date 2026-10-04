import { useState } from 'preact/hooks';
import type { Database, GoalAllocation, Id, OwnerId } from '../../domain/types';
import { fundingSources, goalSourceBreakdown, type FundingSource } from '../../domain/goals';
import { formatMoney } from '../format';
import { Button, MoneyField, SelectField } from '../kit';
import type { Draft } from '../../data/store';

/** One "from where, how much" row. src: '' = not chosen yet, 'none' = not tied to a source, otherwise `${kind}:${id}`. */
export interface AllocLine { id: number; src: string; amount?: number }
let nextId = 1;
export const newLine = (src = ''): AllocLine => ({ id: nextId++, src });

const NONE_LABEL = 'Not tied to a source (counts against cash)';

export function initialLines(db: Database, mode: 'add' | 'release', goalId?: Id): AllocLine[] {
  const opts = sourceOptions(db, mode, goalId);
  return [newLine(opts.length === 1 ? opts[0].value : '')];
}

interface Opt { value: string; label: string; free?: number; heldByGoal?: number }
function sourceOptions(db: Database, mode: 'add' | 'release', goalId?: Id): Opt[] {
  if (mode === 'release' && goalId) {
    return goalSourceBreakdown(db, goalId).filter((r) => r.amount > 0).map((r) => ({
      value: r.kind ? `${r.kind}:${r.id}` : 'none', label: `${r.name} · set aside ${formatMoney(r.amount)}`, heldByGoal: r.amount,
    }));
  }
  const srcs = fundingSources(db, 'household');
  const label = (s: FundingSource) => `${s.name} · ${s.label} · free ${formatMoney(s.free)}`;
  return [...srcs.map((s) => ({ value: `${s.kind}:${s.id}`, label: label(s), free: s.free })), { value: 'none', label: NONE_LABEL }];
}

export function linesTotal(lines: AllocLine[]) { return lines.reduce((s, l) => s + (l.amount ?? 0), 0); }

/** Convert lines into allocation drafts; returns an error message for the first incomplete line. */
export function linesToDrafts(lines: AllocLine[], base: { goalId: Id; date: string; ownerId: OwnerId; notes?: string; sign: 1 | -1 }): { drafts?: Draft<GoalAllocation>[]; error?: string } {
  const used = lines.filter((l) => l.src || l.amount);
  if (!used.length) return { error: 'Enter an amount' };
  const drafts: Draft<GoalAllocation>[] = [];
  for (const [i, l] of used.entries()) {
    if (!l.amount || l.amount <= 0) return { error: `Line ${i + 1}: enter an amount` };
    if (!l.src) return { error: `Line ${i + 1}: choose where this money comes from` };
    const d: Draft<GoalAllocation> = { goalId: base.goalId, date: base.date, amount: l.amount * base.sign, ownerId: base.ownerId, notes: base.notes };
    if (l.src !== 'none') { const [kind, ...rest] = l.src.split(':'); d.sourceKind = kind as GoalAllocation['sourceKind']; d.sourceId = rest.join(':'); }
    drafts.push(d);
  }
  return { drafts };
}

export function AllocationLines({ db, mode, goalId, lines, setLines }: { db: Database; mode: 'add' | 'release'; goalId?: Id; lines: AllocLine[]; setLines: (l: AllocLine[]) => void }) {
  const opts = sourceOptions(db, mode, goalId);
  const [, bump] = useState(0); void bump;
  const patch = (id: number, p: Partial<AllocLine>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const total = linesTotal(lines);
  const chosen = new Set(lines.map((l) => l.src));
  const canAdd = opts.some((o) => !chosen.has(o.value));
  return (
    <div class="alloc-lines" role="group" aria-label={mode === 'add' ? 'Where the money comes from' : 'Which source to release back to'}>
      {mode === 'add' && opts.length === 1 && <p class="hint">You haven’t added any bank accounts or investments yet, so this can only be a general set-aside. Add accounts, FDs, RDs, funds or stocks under Wealth to choose where the money comes from.</p>}
      {lines.map((l, i) => {
        const o = opts.find((x) => x.value === l.src);
        const free = o?.free; const after = free !== undefined && l.amount ? free - l.amount : undefined;
        const over = mode === 'release' && o?.heldByGoal !== undefined && (l.amount ?? 0) > o.heldByGoal;
        return (
          <div class="alloc-line" key={l.id}>
            <SelectField label={lines.length > 1 ? `Source ${i + 1}` : mode === 'add' ? 'Set aside from' : 'Release from'} value={l.src || undefined} placeholder="Choose where from…"
              options={opts.filter((x) => x.value === l.src || !chosen.has(x.value)).map((x) => ({ value: x.value, label: x.label }))} onChange={(v) => patch(l.id, { src: v })} />
            <MoneyField label={`Amount${lines.length > 1 ? ` ${i + 1}` : ''}`} value={l.amount} onChange={(v) => patch(l.id, { amount: v })}
              error={over ? 'More than this goal has set aside from here' : undefined}
              hint={after !== undefined ? (after < 0 ? `This is ${formatMoney(-after)} more than is free in this source — allowed (it’s only a plan), but worth checking.` : `Free in this source after: ${formatMoney(after)}`) : undefined} />
            {lines.length > 1 && <Button size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>Remove</Button>}
          </div>
        );
      })}
      <div class="alloc-foot">
        {canAdd && <Button size="sm" onClick={() => setLines([...lines, newLine()])}>＋ Add another source</Button>}
        <div class="alloc-total" aria-live="polite">Total {mode === 'add' ? 'set aside' : 'released'}: <b>{formatMoney(total)}</b></div>
      </div>
    </div>
  );
}
