import { useState } from 'preact/hooks';
import { Badge, Card, MoneyField, TextField } from '../../kit';
import { useDb, useScope, useStore } from '../../state';
import { formatMoney } from '../../format';
import { canIAfford, type Verdict } from '../../../domain/afford';
import './plan.css';

const VERDICT: Record<Verdict, { label: string; tone: 'good' | 'warn' | 'info' | 'muted' }> = {
  comfortable: { label: 'Looks comfortable', tone: 'good' }, tight: { label: 'A little tight', tone: 'info' },
  dips_into_goals: { label: 'Dips into goal money', tone: 'warn' }, exceeds_cash: { label: 'Not enough cash right now', tone: 'warn' },
};

export default function Afford() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const [amount, setAmount] = useState<number | undefined>();
  const [note, setNote] = useState('');
  const res = amount && amount > 0 ? canIAfford(db, scope, amount, store.today()) : null;
  return (<>
    <Card title="Can I afford this?">
      <p class="px-sub" style={{ margin: 0 }}>Type an amount to see how it fits with your cash, upcoming commitments, goal envelopes and this month’s savings. Nothing is saved.</p>
      <MoneyField label="How much is it?" value={amount} onChange={setAmount} big autoFocus />
      <TextField label="What for? (optional, just for you)" value={note} onInput={setNote} placeholder="e.g. new phone" />
    </Card>
    {!res && <Card tone="soft"><p class="muted" style={{ margin: 0 }}>Enter an amount above and the picture appears here.</p></Card>}
    {res && (<>
      <Card tone={res.verdict === 'comfortable' ? 'accent' : res.verdict === 'tight' ? 'soft' : 'warn'}>
        <div class="px-verdict" aria-live="polite">
          <Badge tone={VERDICT[res.verdict].tone}>{VERDICT[res.verdict].label}</Badge>
          <h3>{note.trim() ? `${note.trim()} — ${formatMoney(res.amount)}` : formatMoney(res.amount)}</h3>
          <p style={{ margin: 0 }}>{res.headline}</p>
        </div>
      </Card>
      <Card title="The numbers">
        <div class="px-lines">
          {res.lines.map((l) => (
            <div class="px-line" key={l.label}><span>{l.label}{l.note && <div class="px-sub">{l.note}</div>}</span><b>{formatMoney(l.value)}</b></div>
          ))}
        </div>
      </Card>
      <Card title="In plain words">
        <ul class="px-list">{res.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
        <p class="px-sub" style={{ margin: 0 }}>{res.disclaimer}</p>
      </Card>
    </>)}
  </>);
}
