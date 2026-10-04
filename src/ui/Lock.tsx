import { useState } from 'preact/hooks';
import { Banner, Card } from './kit';
import { useStore } from './state';
import { verifyPin } from './lock';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const store = useStore();
  const [pin, setPin] = useState(''); const [msg, setMsg] = useState('');
  const submit = async (value: string) => {
    if (value.length < 4) return;
    const r = await verifyPin(store.meta, value);
    if (r.ok) onUnlock();
    else { setPin(''); setMsg(r.waitMs ? `Too many attempts. Try again in ${Math.ceil(r.waitMs / 1000)}s.` : 'That PIN did not match.'); }
  };
  const press = async (d: string) => {
    const next = (pin + d).slice(0, 8); setPin(next); setMsg('');
    if (next.length === 8) await submit(next);
  };
  return (
    <div class="fullscreen"><Card>
      <h1>Wealth OS is locked</h1><p class="muted">Enter your PIN (4–8 digits), then tap Unlock.</p>
      <div class="pin-dots" aria-label={`${pin.length} digits entered`}>{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} class={i < pin.length ? 'on' : ''} />)}</div>
      {msg && <Banner tone="warn">{msg}</Banner>}
      <div class="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} aria-label={d}>{d}</button>)}
        <button type="button" onClick={() => setPin('')} aria-label="Clear">⌫</button><button type="button" onClick={() => press('0')} aria-label="0">0</button><button type="button" onClick={() => submit(pin)} aria-label="Unlock" disabled={pin.length < 4}>↵</button>
      </div>
      <p class="hint">The lock keeps casual onlookers out. It does not encrypt the data stored on this device.</p>
    </Card></div>
  );
}
