import { useEffect, useState } from 'preact/hooks';
import { Banner, Button, Card, Sheet, TextField } from '../../kit';
import { toast, useDb, useStore } from '../../state';
import { clearPin, hasPin, setPin, verifyPin } from '../../lock';

export function LockCard() {
  const store = useStore(); const db = useDb();
  const [has, setHas] = useState(false); const [open, setOpen] = useState<'set' | 'remove' | null>(null);
  const [cur, setCur] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { hasPin(store.meta).then(setHas); }, [open]);
  const close = () => { setOpen(null); setCur(''); setA(''); setB(''); setErr(''); };
  const save = async () => {
    if (!/^\d{4,8}$/.test(a)) return setErr('Use 4 to 8 digits.');
    if (a !== b) return setErr('The two PINs do not match.');
    if (has && !(await verifyPin(store.meta, cur)).ok) return setErr('Current PIN is not correct.');
    await setPin(store.meta, a); await store.updateSettings({ lockEnabled: true }); toast('App lock is on.'); close();
  };
  const remove = async () => {
    if (!(await verifyPin(store.meta, cur)).ok) return setErr('PIN is not correct.');
    await clearPin(store.meta); await store.updateSettings({ lockEnabled: false }); toast('App lock removed.'); close();
  };
  return (
    <Card title="Privacy & app lock">
      <p class="muted">Everything stays on this device. Nothing is sent to any server, and there is no tracking or analytics.</p>
      <p>App lock: <b>{has && db.settings.lockEnabled ? 'on' : 'off'}</b></p>
      <div class="page-actions">
        <Button onClick={() => setOpen('set')}>{has ? 'Change PIN' : 'Set a PIN'}</Button>
        {has && <Button variant="ghost" onClick={() => setOpen('remove')}>Remove lock</Button>}
      </div>
      <Banner tone="info">The lock hides the app from someone picking up your phone or laptop. It is <b>not encryption</b>: the data in this browser’s storage is not encrypted, and backup files are plain JSON. Don’t rely on it as banking-grade security. Never store card numbers, CVV, PINs or bank passwords in notes.</Banner>
      {open === 'set' && <Sheet title={has ? 'Change PIN' : 'Set a PIN'} onClose={close} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        {has && <TextField label="Current PIN" value={cur} onInput={setCur} />}
        <TextField label="New PIN (4–8 digits)" value={a} onInput={(v) => setA(v.replace(/\D/g, ''))} maxLength={8} />
        <TextField label="Repeat new PIN" value={b} onInput={(v) => setB(v.replace(/\D/g, ''))} maxLength={8} error={err} />
        <p class="hint">If you forget the PIN you can still recover your data from a backup file, so keep one.</p>
      </Sheet>}
      {open === 'remove' && <Sheet title="Remove app lock" onClose={close} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={remove}>Remove lock</Button></>}>
        <TextField label="Current PIN" value={cur} onInput={setCur} error={err} />
      </Sheet>}
    </Card>
  );
}
