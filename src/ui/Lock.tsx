import { useState } from 'preact/hooks';
import { Banner, Card } from './kit';
import { useStore } from './state';
import { verifyPin } from './lock';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const store = useStore();
  const [pin, setPin] = useState(''); const [msg, setMsg] = useState('');
  const press = async (d: string) => {
    const next = (pin + d).slice(0, 8); setPin(next); setMsg('');
    if (next.length >= 4) {
      const r = await verifyPin(store.meta, next);
      if (r.ok) onUnlock();
      else if (next.length === 8 || r.waitMs) { setPin(''); setMsg(r.waitMs ? `Too many attempts. Try again in ${Math.ceil(r.waitMs / 1000)}s.` : 'That PIN did not match.'); }
    }
  };
  return (
    <div class="fullscreen"><Card>
      <h1>Wealth OS is locked</h1><p class="muted">Enter your PIN. Digits are checked automatically from 4 digits.</p>
      <div class="pin-dots" aria-label={`${pin.length} digits entered`}>{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} class={i < pin.length ? 'on' : ''} />)}</div>
      {msg && <Banner tone="warn">{msg}</Banner>}
      <div class="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} aria-label={d}>{d}</button>)}
        <button type="button" onClick={() => setPin('')} aria-label="Clear">⌫</button><button type="button" onClick={() => press('0')} aria-label="0">0</button><span />
      </div>
      <p class="hint">The lock keeps casual onlookers out. It does not encrypt the data stored on this device.</p>
    </Card></div>
  );
}
