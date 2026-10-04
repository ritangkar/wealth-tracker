import { useState } from 'preact/hooks';
import type { Issue } from '../../domain/ledger';
import { WASTE_LABELS } from '../../domain/waste';
import type { OwnerId, WasteCategory } from '../../domain/types';
import { Chips, DateField, MoneyField, Segmented, TextField, fieldError, useConfirm } from '../kit';
import { defaultOwner, ownerOptions, toast, useDb, useStore } from '../state';
import { ErrorSummary, FormShell, Note, SaveBar, type FormProps } from './shared';

const REASONS = ['Spoiled', 'Forgot about it', 'Ordered too much', 'Didn’t like it', 'Unused'];

export default function WasteForm({ editId, onClose, scope }: FormProps) {
  const store = useStore(); const db = useDb();
  const old = editId ? db.wasteEntries.find((w) => w.id === editId) : undefined;
  const [item, setItem] = useState(old?.item ?? '');
  const [cost, setCost] = useState<number | undefined>(old?.cost);
  const [category, setCategory] = useState<WasteCategory>(old?.category ?? 'food');
  const [quantity, setQuantity] = useState(old?.quantity ?? '');
  const [reason, setReason] = useState(old?.reason ?? '');
  const [owner, setOwner] = useState<OwnerId>(old?.ownerId ?? defaultOwner(db, scope));
  const [date, setDate] = useState(old?.date ?? store.today());
  const [issues, setIssues] = useState<Issue[]>([]); const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();

  const submit = async () => {
    setBusy(true);
    try {
      const r = await store.saveWaste({ date, item, cost: cost ?? 0, category, quantity: quantity.trim() || undefined, reason: reason.trim() || undefined, ownerId: owner }, editId);
      if (r.ok) { toast(editId ? 'Changes saved' : 'Noted — thanks for tracking it'); onClose(); } else { setIssues(r.issues); toast(r.issues[0].message, 'error'); }
    } finally { setBusy(false); }
  };
  const remove = editId ? async () => {
    if (!(await ask({ title: 'Delete this entry?', body: 'It will be removed from your waste log.', confirmLabel: 'Delete', danger: true }))) return;
    const r = await store.deleteWaste(editId); if (r.ok) { toast('Deleted'); onClose(); } else toast(r.issues[0].message, 'error');
  } : undefined;

  return (
    <FormShell onSubmit={submit}>
      <Note>Noticing waste is the first step — no guilt. It’s logged for awareness only and isn’t counted as spending (the money was already spent).</Note>
      <TextField label="What was it?" value={item} onInput={setItem} autoFocus placeholder="e.g. Leftover dal, bread" error={fieldError(issues, 'item')} />
      <MoneyField label="Approximate cost" value={cost} onChange={setCost} error={fieldError(issues, 'cost')} />
      <div class="field"><span class="qa-label">Type</span>
        <Chips label="Waste type" value={category} onChange={(v) => v && setCategory(v)} options={(Object.keys(WASTE_LABELS) as WasteCategory[]).map((v) => ({ value: v, label: WASTE_LABELS[v] }))} />
      </div>
      <TextField label="Quantity (optional)" value={quantity} onInput={setQuantity} placeholder="e.g. 1 loaf, 500 g" />
      <div class="field"><span class="qa-label">What happened?</span>
        <Chips label="Reason" allowNone value={REASONS.includes(reason) ? reason : undefined} onChange={(v) => setReason(v ?? '')} options={REASONS.map((r) => ({ value: r, label: r }))} />
      </div>
      <TextField label="Or describe it" value={reason} onInput={setReason} maxLength={120} />
      <div class="field"><span class="qa-label">Whose</span><Segmented label="Owner" value={owner} options={ownerOptions(db)} onChange={setOwner} /></div>
      <DateField label="Date" value={date} onChange={setDate} error={fieldError(issues, 'date')} />
      <ErrorSummary issues={issues} known={['item', 'cost', 'date']} />
      <SaveBar busy={busy} onDelete={remove} />
      {dialog}
    </FormShell>
  );
}
