import { Page } from '../kit';
import { Tabs, TabPanel, useTab } from './plan/Tabs';
import Savings from './plan/Savings';
import Goals from './plan/Goals';
import Upcoming from './plan/Upcoming';
import Afford from './plan/Afford';
import { useScope, useDb, personName } from '../state';

const TABS = [{ id: 'savings', label: 'Savings' }, { id: 'goals', label: 'Goals' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'afford', label: 'Can I afford it?' }] as const;
type TabId = (typeof TABS)[number]['id'];

export default function Plan() {
  const [tab, setTab] = useTab<TabId>('/plan', TABS.map((t) => t.id));
  const db = useDb(); const [scope] = useScope();
  return (
    <Page title="Plan & goals" subtitle={`Savings, goals and what’s coming up — ${scope === 'household' ? 'household view' : personName(db, scope)}`}>
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} label="Plan sections" />
      <TabPanel id={tab}>
        {tab === 'savings' && <Savings />}
        {tab === 'goals' && <Goals />}
        {tab === 'upcoming' && <Upcoming />}
        {tab === 'afford' && <Afford />}
      </TabPanel>
    </Page>
  );
}
