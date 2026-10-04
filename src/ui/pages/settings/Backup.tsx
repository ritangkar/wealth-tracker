import { useEffect, useState } from 'preact/hooks';
import { Banner, Button, Card, Check, Row, Sheet, TextField, useConfirm } from '../../kit';
import { toast, useDb, useStore } from '../../state';
import { backupFilename, parseBackup, previewRestore, type ParseResult } from '../../../data/backup';
import type { Database } from '../../../domain/types';
import type { SafetySnapshot } from '../../../data/storage';
import { formatDate } from '../../format';
import { spendingOf } from '../../../domain/ledger';
import { monthOf } from '../../../domain/dates';

export function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const LABELS: Record<string, string> = { categories: 'Categories', accounts: 'Accounts', cardReports: 'Card reports', transactions: 'Transactions', investments: 'Investments', assets: 'Assets', valuations: 'Valuations', liabilities: 'Loans', emis: 'EMIs', expectedItems: 'Recurring items', goals: 'Goals', goalAllocations: 'Goal allocations', wasteEntries: 'Waste entries', snapshots: 'Net-worth snapshots' };

export function BackupCard() {
  const store = useStore(); const db = useDb();
  const [picked, setPicked] = useState<{ name: string; parsed: ParseResult } | null>(null);
  const [safety, setSafety] = useState<SafetySnapshot[]>([]);
  const [ask, dialog] = useConfirm();
  const refresh = async () => setSafety(await store.meta.listSafety());
  useEffect(() => { void refresh(); }, []);

  const doExport = async () => {
    const { json } = await store.exportBackup();
    download(backupFilename(new Date(store.now())), json);
    await store.markBackedUp(); toast('Backup downloaded. Keep it somewhere safe — it is not encrypted.');
  };
  const doCsv = () => {
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const name = (id?: string) => db.accounts.find((a) => a.id === id)?.name ?? '';
    const cat = (id?: string) => db.categories.find((c) => c.id === id)?.name ?? '';
    const rows = [['date', 'type', 'amount_inr', 'spending_effect_inr', 'owner', 'category', 'subcategory', 'merchant', 'from_account', 'to_account', 'payment_method', 'tags', 'notes']];
    for (const t of [...db.transactions].sort((a, b) => a.date.localeCompare(b.date)))
      rows.push([t.date, t.type, (t.amount / 100).toFixed(2), (spendingOf(t) / 100).toFixed(2), db.settings.people.find((p) => p.id === t.ownerId)?.name ?? 'Joint', cat(t.categoryId), cat(t.subcategoryId), t.merchant ?? '', name(t.fromAccountId), name(t.toAccountId), t.paymentMethod ?? '', (t.tags ?? []).join(';'), t.notes ?? '']);
    download(`wealth-os-transactions-${monthOf(store.today())}.csv`, rows.map((r) => r.map(esc).join(',')).join('\n'), 'text/csv');
  };
  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    const text = await f.text(); setPicked({ name: f.name, parsed: await parseBackup(text) });
    (e.target as HTMLInputElement).value = '';
  };
  const days = db.settings.lastBackupAt ? Math.floor((Date.now() - Date.parse(db.settings.lastBackupAt)) / 86400000) : null;
  const hasData = db.transactions.length + db.accounts.length > 0;

  const restoreSafety = async (s: SafetySnapshot) => {
    const p = await parseBackup(s.json);
    if (!p.ok) { toast('That safety copy could not be read.', 'error'); return; }
    if (!(await ask({ title: 'Restore this earlier copy?', body: <p>Your current data will be saved as a new safety copy first, then replaced by the copy from {formatDate(s.createdAt.slice(0, 10))}.</p>, confirmLabel: 'Restore' }))) return;
    const r = await store.restore(p.db!, 'replace'); if (r.ok) { toast('Restored.'); void refresh(); } else toast(r.issues[0].message, 'error');
  };

  return (
    <Card title="Backup & restore">
      {days === null && hasData && <Banner tone="warn">You haven’t exported a backup yet. Data lives only in this browser — if you clear site data or lose the device it is gone. A backup file is your safety net.</Banner>}
      {days !== null && days > 30 && <Banner tone="warn">Your last backup was {days} days ago.</Banner>}
      {days !== null && days <= 30 && <p class="muted">Last backup: {days === 0 ? 'today' : `${days} day${days > 1 ? 's' : ''} ago`}.</p>}
      <div class="page-actions">
        <Button variant="primary" onClick={doExport}>Download backup (JSON)</Button>
        <label class="btn btn-secondary" style="cursor:pointer">Restore from file…<input type="file" accept="application/json,.json" onChange={onFile} class="sr-only" /></label>
        <Button variant="ghost" onClick={doCsv}>Export transactions (CSV)</Button>
      </div>
      <p class="hint">Backups contain all your records, unencrypted. To use the app on a second device: download here, then restore there (choose “Merge” to combine two devices’ data).</p>
      {safety.length > 0 && <details class="disclosure"><summary>Automatic safety copies ({safety.length})</summary>
        <div class="disclosure-body"><p class="muted">Made just before every restore or reset, so a mistake can be undone.</p>
          {safety.map((s) => <Row key={s.id} title={s.label.replace('Before ', 'Before ').split(' on ')[0]} sub={formatDate(s.createdAt.slice(0, 10))} right={<span><Button size="sm" variant="ghost" onClick={() => download(`wealth-os-safety-${s.id}.json`, s.json)}>Save</Button><Button size="sm" onClick={() => restoreSafety(s)}>Restore</Button></span>} />)}
        </div></details>}
      {picked && <RestoreSheet name={picked.name} parsed={picked.parsed} current={db} onClose={() => { setPicked(null); void refresh(); }} />}
      {dialog}
    </Card>
  );
}

function RestoreSheet({ name, parsed, current, onClose }: { name: string; parsed: ParseResult; current: Database; onClose: () => void }) {
  const store = useStore();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [typed, setTyped] = useState(''); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!parsed.ok) {
    return <Sheet title="This backup can’t be used" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>OK</Button>}>
      <Banner tone="error">Nothing was changed. Your current data is untouched.</Banner>
      <p><b>{name}</b></p><ul>{parsed.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>
    </Sheet>;
  }
  const rows = previewRestore(current, parsed.db!, mode);
  const needAck = parsed.checksumMismatch && !ack;
  const needTyped = mode === 'replace' && current.transactions.length + current.accounts.length > 0 && typed.trim().toUpperCase() !== 'REPLACE';
  const go = async () => {
    setBusy(true); setErr('');
    const r = await store.restore(parsed.db!, mode); setBusy(false);
    if (r.ok) { toast(mode === 'merge' ? 'Merged. Your previous data was saved as a safety copy.' : 'Restored. Your previous data was saved as a safety copy.'); onClose(); } else setErr(r.issues.map((i) => i.message).join(' · '));
  };
  return (
    <Sheet title="Review before restoring" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || needAck || needTyped} onClick={go}>{mode === 'merge' ? 'Merge' : 'Replace my data'}</Button></>}>
      <p class="muted">{name}{parsed.exportedAt ? ` · exported ${formatDate(parsed.exportedAt.slice(0, 10))}` : ''}{parsed.migratedFrom ? ` · upgraded from schema ${parsed.migratedFrom}` : ''}</p>
      {parsed.warnings.length > 0 && <Banner tone="warn"><ul style="margin:0;padding-left:1.1rem">{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner>}
      {parsed.checksumMismatch && <Check label="I understand this file may have been edited or damaged and want to continue anyway" checked={ack} onChange={setAck} />}
      <div class="chips" role="radiogroup" aria-label="How to restore">
        <button type="button" role="radio" aria-checked={mode === 'merge'} class={`chip ${mode === 'merge' ? 'chip-on' : ''}`} onClick={() => setMode('merge')}>Merge (keep both)</button>
        <button type="button" role="radio" aria-checked={mode === 'replace'} class={`chip ${mode === 'replace' ? 'chip-on' : ''}`} onClick={() => setMode('replace')}>Replace everything</button>
      </div>
      <p class="hint">{mode === 'merge' ? 'Adds anything new from the file and keeps the newer version of anything in both. Deletions made on the other device are applied when they are newer. Your current data is saved as a safety copy first.' : 'Replaces everything here with the file’s contents. Your current data is saved as a safety copy first, so you can undo this.'}</p>
      <table class="table-lite"><thead><tr><th>Section</th><th>Now</th><th>File</th>{mode === 'merge' && <th>New / updated</th>}</tr></thead>
        <tbody>{rows.filter((r) => r.current || r.incoming).map((r) => <tr key={r.collection}><td>{LABELS[r.collection] ?? r.collection}</td><td>{r.current}</td><td>{r.incoming}</td>{mode === 'merge' && <td>{r.added} / {r.updated}</td>}</tr>)}</tbody></table>
      {mode === 'replace' && current.transactions.length + current.accounts.length > 0 && <TextField label="Type REPLACE to confirm" value={typed} onInput={setTyped} />}
      {err && <Banner tone="error">{err}</Banner>}
      <p class="hint">The file was fully checked (structure, links between records, and financial rules) before this screen appeared.</p>
    </Sheet>
  );
}
