import type { ComponentType } from 'preact';
import Home from './pages/Home';
import Activity from './pages/Activity';
import Wealth from './pages/Wealth';
import Debt from './pages/Debt';
import Plan from './pages/Plan';
import Subscriptions from './pages/Subscriptions';
import Waste from './pages/Waste';
import Insights from './pages/Insights';
import More from './pages/More';
import Settings from './pages/Settings';
import Welcome from './pages/Welcome';

export interface RouteDef { path: string; title: string; icon: string; component: ComponentType; group: 'main' | 'more' | 'hidden' }
/** Sub-views use ?tab= query params, e.g. #/plan?tab=goals — see each page. */
export const ROUTES: RouteDef[] = [
  { path: '/', title: 'Home', icon: '⌂', component: Home, group: 'main' },
  { path: '/activity', title: 'Activity', icon: '☰', component: Activity, group: 'main' },
  { path: '/wealth', title: 'Wealth', icon: '◈', component: Wealth, group: 'main' },
  { path: '/plan', title: 'Plan & goals', icon: '◎', component: Plan, group: 'more' },
  { path: '/debt', title: 'Cards, EMIs & loans', icon: '▤', component: Debt, group: 'more' },
  { path: '/subscriptions', title: 'Subscriptions', icon: '↻', component: Subscriptions, group: 'more' },
  { path: '/waste', title: 'Waste', icon: '♻', component: Waste, group: 'more' },
  { path: '/insights', title: 'Insights & analytics', icon: '✧', component: Insights, group: 'more' },
  { path: '/settings', title: 'Settings & backup', icon: '⚙', component: Settings, group: 'more' },
  { path: '/more', title: 'More', icon: '⋯', component: More, group: 'hidden' },
  { path: '/welcome', title: 'Welcome', icon: '✦', component: Welcome, group: 'hidden' },
];
