import type { ComponentChildren, Ref } from 'preact';
import { useState } from 'preact/hooks';
import type { Draft } from '../../data/store';
import type { Issue } from '../../domain/ledger';
import type { Account, Database, PaymentMethod, Transaction, ViewScope } from '../../domain/types';
import { Button, useConfirm } from '../kit';
import { PAYMENT_LABELS } from '../format';
import { toast, useStore } from '../state';
import '../pages/home-activity.css';

export interface FormProps { editId?: string; onClose: () => void; scope: ViewScope }

export const PAYMENT_OPTIONS = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({ value: v, label: PAYMENT_LABELS[v] }));

/** Active accounts passing `filter`; an archived account is kept only when it is currently selected (edit mode). */
export function accountOptions(db: Database, filter: (a: Account) => boolean = () => true, keepId?: string) {
  return db.accounts
    .filter((a) => filter(a) && (!a.archived || a.id === keepId))
    .map((a) => ({ value: a.id, label: a.kind === 'credit_card' ? `${a.name} (credit card)` : a.name }));
}
export const isCard = (db: Database, id?: string) => db.accounts.find((a) => a.id === id)?.kind === 'credit_card';
export const nonCard = (a: Account) => a.kind !== 'credit_card';

/** Inline error under a custom (non-Field) control. */
export function ErrText({ issues, field }: { issues: Issue[]; field: string }) {
  const m = issues.find((i) => i.field === field)?.message;
  return m ? <div class="err" role="alert">{m}</div> : null;
}

/** Shows issues that no visible field would display (general + unknown fields). */
export function ErrorSummary({ issues, known }: { issues: Issue[]; known: string[] }) {
  const rest = issues.filter((i) => i.field === '_' || !known.includes(i.field));
  return rest.length ? <div class="banner banner-error" role="alert">{rest.map((i) => i.message).join(' · ')}</div> : null;
}

export function FormShell({ onSubmit, children, formRef }: { onSubmit: () => void; children: ComponentChildren; formRef?: Ref<HTMLFormElement> }) {
  return <form class="qa-form" ref={formRef} noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{children}</form>;
}

export function Note({ children, tone = 'info' }: { children: ComponentChildren; tone?: 'info' | 'good' | 'warn' }) {
  return <div class={`qa-note qa-note-${tone}`} role="note">{children}</div>;
}

export function SaveBar({ busy, saveLabel = 'Save', onAnother, onDelete }: { busy: boolean; saveLabel?: string; onAnother?: () => void; onDelete?: () => void }) {
  return (
    <div class="qa-bar">
      {onDelete && <Button variant="danger" onClick={onDelete} disabled={busy}>Delete</Button>}
      <span class="qa-spacer" />
      {onAnother && <Button onClick={onAnother} disabled={busy}>Save &amp; add another</Button>}
      <Button type="submit" variant="primary" disabled={busy}>{saveLabel}</Button>
    </div>
  );
}

/** Save/delete plumbing shared by every transaction form. */
export function useTxnSave(editId: string | undefined, onClose: () => void) {
  const store = useStore();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();

  const save = async (draft: Draft<Transaction>, success: string): Promise<Transaction | undefined> => {
    setBusy(true);
    try {
      const r = editId ? await store.updateTransaction(editId, draft) : await store.addTransaction(draft);
      if (r.ok) { setIssues([]); toast(editId ? 'Changes saved' : success); return r.value; }
      setIssues(r.issues);
      toast(r.issues.length === 1 ? r.issues[0].message : 'Please check the highlighted fields', 'error');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
    return undefined;
  };

  const remove = editId ? async () => {
    const ok = await ask({ title: 'Delete this transaction?', body: 'It will be removed from your history and balances. This can’t be undone (a backup restore can bring it back).', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await store.deleteTransaction(editId);
      if (r.ok) { toast('Deleted'); onClose(); return; }
      setIssues(r.issues); toast(r.issues.map((i) => i.message).join(' · '), 'error');
    } finally { setBusy(false); }
  } : undefined;

  return { issues, setIssues, busy, save, remove, dialog };
}

export const splitTags = (s: string): string[] | undefined => {
  const t = s.split(',').map((x) => x.trim()).filter(Boolean);
  return t.length ? t : undefined;
};
