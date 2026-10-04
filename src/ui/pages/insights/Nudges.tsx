import { useState } from 'preact/hooks';
import { Badge, Banner, Button, Card, Disclosure, EmptyState, FormErrors, MoneyField, Sheet, Field } from '../../kit';
import { toast, useDb, useScope, useStore } from '../../state';
import { formatMoney } from '../../format';
import { generateInsights, type Insight } from '../../../domain/insights';
import { scopedTxns } from '../../../domain/cashflow';
import '../plan/plan.css';

const TONE_CLASS: Record<Insight['tone'], string> = { positive: 'insight-positive', note: 'insight-note', attention: 'insight-note', info: 'insight-info' };

export default function Nudges() {
  const db = useDb(); const store = useStore(); const [scope] = useScope();
  const [tune, setTune] = useState(false);
  const list = generateInsights(db, scope, store.today());
  const hasData = scopedTxns(db, scope).length > 0;
  return (<>
    <Card title="Gentle observations" action={<Button size="sm" onClick={() => setTune(true)}>Tune insights</Button>}>
      <p class="px-sub" style={{ margin: 0 }}>Calm notes drawn from your own records. Anything marked <Badge tone="info">Estimate</Badge> is a rough guess, never a promise. Nothing here is a judgement.</p>
    </Card>
    {!list.length && <Card><EmptyState title={hasData ? 'Nothing to flag right now' : 'Not enough to go on yet'} body={hasData ? 'Things look steady. New observations appear as the month unfolds.' : 'Add a few expenses and some income and gentle observations will begin to appear here.'} /></Card>}
    {list.map((i) => (
      <Card key={i.id}>
        <div class={`insight ${TONE_CLASS[i.tone]}`}>
          <div class="px-badges">{i.estimate && <Badge tone="info">Estimate</Badge>}</div>
          <div class="insight-title">{i.title}</div>
          <div>{i.body}</div>
          <Disclosure summary="How we worked this out">
            <ul class="px-list">{i.assumptions.map((a) => <li key={a}>{a}</li>)}{i.estimate && <li>This is an estimate — treat it as a possibility to explore.</li>}</ul>
          </Disclosure>
          {i.link && <div><a href={i.link}>See details →</a></div>}
        </div>
      </Card>
    ))}
    {tune && <TuneSheet onClose={() => setTune(false)} />}
  </>);
}

function TuneSheet({ onClose }: { onClose: () => void }) {
  const db = useDb(); const store = useStore(); const s = db.settings;
  const [transport, setTransport] = useState<number | undefined>(s.transportReviewThreshold);
  const [spikeMin, setSpikeMin] = useState<number | undefined>(s.spikeMinimum);
  const [factor, setFactor] = useState(String(s.spikeFactor));
  const [home, setHome] = useState(String(s.homeCookSavingsPct));
  const [local, setLocal] = useState(String(s.localMarketSavingsPct));
  const [days, setDays] = useState(String(s.subscriptionReviewDays));
  const [err, setErr] = useState<{ field: string; message: string }[]>([]);
  const save = async () => {
    const f = Number(factor), h = Number(home), l = Number(local), d = Number(days);
    if (transport === undefined || spikeMin === undefined) return setErr([{ field: '_', message: 'Please enter both amounts.' }]);
    if (!(f >= 1.1 && f <= 10)) return setErr([{ field: '_', message: 'Spike factor should be between 1.1 and 10.' }]);
    if (![h, l].every((x) => x >= 0 && x <= 100)) return setErr([{ field: '_', message: 'Percentages should be between 0 and 100.' }]);
    if (!(Number.isInteger(d) && d >= 7 && d <= 730)) return setErr([{ field: '_', message: 'Review days should be a whole number between 7 and 730.' }]);
    const r = await store.updateSettings({ transportReviewThreshold: transport, spikeMinimum: spikeMin, spikeFactor: f, homeCookSavingsPct: h, localMarketSavingsPct: l, subscriptionReviewDays: d });
    if (r.ok) { toast('Insights tuned'); onClose(); } else setErr(r.issues);
  };
  const num = (label: string, v: string, set: (s: string) => void, hint: string, step = '1') => (
    <Field label={label} hint={hint}>{(a) => <input {...a} type="number" step={step} inputMode="decimal" value={v} onInput={(e) => set((e.target as HTMLInputElement).value)} />}</Field>
  );
  return (
    <Sheet title="Tune insights" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div class="px-form">
        <Banner>These are personal markers, not rules. Change them to match how you live.</Banner>
        <FormErrors issues={err} />
        <MoneyField label="Transport review marker (per month)" value={transport} onChange={setTransport} hint={`Transport above this is gently flagged. Now ${formatMoney(s.transportReviewThreshold)}.`} />
        {num('“Higher than usual” means … × the recent average', factor, setFactor, 'For example 1.5 = half as much again.', '0.1')}
        <MoneyField label="…and at least this much more" value={spikeMin} onChange={setSpikeMin} hint="Ignores small rises." />
        {num('Home cooking costs about … % less than delivery', home, setHome, 'Used only for the delivery estimate.')}
        {num('Local markets cost about … % less for groceries', local, setLocal, 'Used only for the grocery opportunity estimate.')}
        {num('Flag a subscription as “worth a check” after … days', days, setDays, 'Counted from when you last tapped “Still using”.')}
      </div>
    </Sheet>
  );
}
