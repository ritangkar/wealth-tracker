import { Page } from '../kit';
import { Tabs, TabPanel, useTab } from './plan/Tabs';
import Nudges from './insights/Nudges';
import Spending from './insights/Spending';
import Trends from './insights/Trends';
import { useDb, useScope, personName } from '../state';

const TABS = [{ id: 'nudges', label: 'Nudges' }, { id: 'spending', label: 'Spending' }, { id: 'trends', label: 'Trends' }] as const;
type TabId = (typeof TABS)[number]['id'];

export default function Insights() {
  const [tab, setTab] = useTab<TabId>('/insights', TABS.map((t) => t.id));
  const db = useDb(); const [scope] = useScope();
  return (
    <Page title="Insights & analytics" subtitle={`Calm observations and answers — ${scope === 'household' ? 'household view' : personName(db, scope)}`}>
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} label="Insight sections" />
      <TabPanel id={tab}>
        {tab === 'nudges' && <Nudges />}
        {tab === 'spending' && <Spending />}
        {tab === 'trends' && <Trends />}
      </TabPanel>
    </Page>
  );
}
