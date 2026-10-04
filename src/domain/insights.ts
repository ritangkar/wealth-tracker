/**
 * Explainable, non-judgmental insights. Each one states its data, assumptions and whether it is an estimate.
 * Never fabricates savings: estimates are labelled and driven by user-configurable percentages.
 */
import type { Database, Id, Transaction, ViewScope } from '../domain/types';
import { scopedTxns, monthTxns, projectMonthEnd, summarizeMonth, groupSpending } from './cashflow';
import { spendingOf } from './ledger';
import { addMonthsKey, monthOf, monthLabel, diffDays, type ISODate, type MonthKey } from './dates';
import { formatMoney } from './money';
import { wasteMonth } from './waste';

export type Tone = 'info' | 'positive' | 'note' | 'attention';
export interface Insight {
  id: string; tone: Tone; title: string; body: string; assumptions: string[]; estimate?: boolean;
  /** route to open for details */
  link?: string; data?: Record<string, number | string>;
}

const catOf = (db: Database, t: Transaction): Id | undefined => { const c = db.categories.find((x) => x.id === t.categoryId); return c?.parentId ?? t.categoryId; };
const isSub = (t: Transaction, sub: string) => t.subcategoryId === `sub_${sub}`;

function sumWhere(txns: Transaction[], f: (t: Transaction) => boolean) { return txns.filter(f).reduce((s, t) => s + spendingOf(t), 0); }
function avgPrior(db: Database, txns: Transaction[], month: MonthKey, f: (t: Transaction) => boolean, n = 3) {
  const keys = Array.from({ length: n }, (_, i) => addMonthsKey(month, -(i + 1))).filter((k) => txns.some((t) => monthOf(t.date) === k));
  if (!keys.length) return null;
  return { avg: Math.round(keys.reduce((s, k) => s + sumWhere(monthTxns(txns, k).filter((t) => !t.oneOff), f), 0) / keys.length), months: keys.length };
}

export function generateInsights(db: Database, scope: ViewScope, today: ISODate): Insight[] {
  const out: Insight[] = [];
  const month = monthOf(today);
  const txns = scopedTxns(db, scope);
  const cur = monthTxns(txns, month);
  const s = db.settings;
  const note = s.monthNotes[month];

  // --- savings projection
  const p = projectMonthEnd(db, scope, month, today);
  if (txns.length && (p.actualIncome > 0 || p.expectedIncomeRemaining > 0)) {
    if (p.gap > 0) {
      out.push({ id: 'savings-gap', tone: 'note', title: `Projected savings ${formatMoney(p.projectedSavings)} — ${formatMoney(p.gap)} below the ${formatMoney(p.target)} target`,
        body: note ? `You noted “${note}” for this month, so a lower figure is understandable. Nothing here is a failure; it's a picture of the month so far.` : 'A lower-saving month happens. This is a projection, not a verdict — it can move a lot before month-end.',
        assumptions: p.assumptions, estimate: true, link: '#/plan', data: { projected: p.projectedSavings, gap: p.gap } });
    } else {
      out.push({ id: 'savings-ontrack', tone: 'positive', title: `On track to save about ${formatMoney(p.projectedSavings)} this month`, body: `That is ${formatMoney(-p.gap)} above your ${formatMoney(p.target)} target if the rest of the month looks like what we've seen.`, assumptions: p.assumptions, estimate: true, link: '#/plan' });
    }
  }

  // --- transport review (threshold is a configurable prompt, not a rule)
  const transport = sumWhere(cur, (t) => catOf(db, t) === 'cat_transport');
  if (transport > s.transportReviewThreshold) {
    const prior = avgPrior(db, txns, month, (t) => catOf(db, t) === 'cat_transport');
    out.push({ id: 'transport-review', tone: 'info', title: `Transport is ${formatMoney(transport)} this month`,
      body: `That is above your ${formatMoney(s.transportReviewThreshold)} review marker${prior ? ` (your recent average is ${formatMoney(prior.avg)})` : ''}. Travel, road conditions, air quality or an unusual month can all make it reasonable — it's just flagged so you can glance at it.`,
      assumptions: ['The review marker is a setting you control, not a rule.'], link: '#/activity', data: { transport } });
  }

  // --- shopping + generic category spikes
  const cats = groupSpending(cur.filter((t) => !t.oneOff), (t) => { const c = catOf(db, t); return c ? { key: c, label: db.categories.find((x) => x.id === c)?.name ?? 'Other' } : null; });
  for (const g of cats) {
    if (g.key === 'cat_transport' && g.amount > s.transportReviewThreshold) continue;
    const prior = avgPrior(db, txns, month, (t) => catOf(db, t) === g.key);
    if (prior && prior.avg > 0 && g.amount >= prior.avg * s.spikeFactor && g.amount - prior.avg >= s.spikeMinimum) {
      out.push({ id: `spike-${g.key}`, tone: 'info', title: `${g.label} is higher than usual: ${formatMoney(g.amount)}`,
        body: `Your ${prior.months}-month average is ${formatMoney(prior.avg)}. Spikes are often one-offs (a gift, a festival, a bulk purchase). Mark a purchase as “one-off” and it won't count toward the baseline.`,
        assumptions: [`“Higher than usual” means at least ${s.spikeFactor}× your recent average and ${formatMoney(s.spikeMinimum)} more.`], link: '#/insights', data: { amount: g.amount, avg: prior.avg } });
    }
  }

  // --- food delivery
  const delivery = cur.filter((t) => isSub(t, 'delivery') && spendingOf(t) > 0);
  if (delivery.length >= 3) {
    const total = sumWhere(cur, (t) => isSub(t, 'delivery'));
    const est = Math.round((total * s.homeCookSavingsPct) / 100);
    out.push({ id: 'food-delivery', tone: 'info', title: `${delivery.length} food-delivery orders this month (${formatMoney(total)})`,
      body: `Convenience matters — busy days happen. If a few of these were home-cooked, a rough estimate is about ${formatMoney(est)} less, but that is a guess, not a promise.`,
      assumptions: [`Estimate assumes home cooking costs about ${s.homeCookSavingsPct}% less than delivery (adjustable in Settings).`], estimate: true, link: '#/insights', data: { orders: delivery.length, total } });
  }

  // --- online grocery opportunity
  const online = sumWhere(cur, (t) => isSub(t, 'online_grocery'));
  if (online > 0 && cur.filter((t) => isSub(t, 'online_grocery') && spendingOf(t) > 0).length >= 3) {
    const est = Math.round((online * s.localMarketSavingsPct) / 100);
    out.push({ id: 'online-grocery', tone: 'info', title: `Online grocery spend is ${formatMoney(online)} this month`,
      body: `Buying some staples at a local market might cost less — an opportunity of roughly ${formatMoney(est)} if so. We have no price comparison data, so treat this as a possibility to test, not a saving.`,
      assumptions: [`Opportunity assumes about ${s.localMarketSavingsPct}% lower prices at local markets (adjustable). No actual prices were compared.`], estimate: true, link: '#/insights' });
  }

  // --- subscriptions worth a check (never assumes wasteful)
  const review = db.expectedItems.filter((e) => e.kind === 'subscription' && e.status === 'active' && (scope === 'household' || e.ownerId === scope))
    .filter((e) => diffDays(today, e.lastUsed ?? e.startDate) > s.subscriptionReviewDays);
  if (review.length) {
    const total = review.reduce((a, e) => a + e.amount, 0);
    out.push({ id: 'subs-check', tone: 'note', title: `${review.length} subscription${review.length > 1 ? 's' : ''} worth a quick check`,
      body: `${review.map((e) => e.name).join(', ')} (${formatMoney(total)}/month combined). You haven't marked ${review.length > 1 ? 'them' : 'it'} as used in a while — if you still enjoy ${review.length > 1 ? 'them' : 'it'}, tap “Still using” and it will stop showing.`,
      assumptions: [`Based on the “last used” date you set; flagged after ${s.subscriptionReviewDays} days.`], link: '#/subscriptions' });
  }

  // --- waste
  const w = wasteMonth(db, scope, month);
  const wPrev = wasteMonth(db, scope, addMonthsKey(month, -1));
  if (w.total > 0) {
    const top = w.byCategory[0];
    out.push({ id: 'waste-month', tone: 'info', title: `About ${formatMoney(w.total)} of purchases went to waste this month`,
      body: `Most of it was ${top.category === 'unused' ? 'unused items' : top.category} (${formatMoney(top.amount)}). ${w.topItems[0] ? `${w.topItems[0].item} shows up most.` : ''} Small tweaks — smaller packs, a weekly fridge check — usually help more than big changes.`.trim(),
      assumptions: ['Based on the waste entries you logged; the cost is what you entered.'], link: '#/waste', data: { total: w.total } });
  }
  if (wPrev.total > 0 && w.total > 0 && w.total < wPrev.total * 0.8) {
    out.push({ id: 'waste-down', tone: 'positive', title: 'Waste is down compared with last month', body: `${formatMoney(w.total)} vs ${formatMoney(wPrev.total)} — nice progress.`, assumptions: ['Compares logged waste for the two months.'], link: '#/waste' });
  }

  // --- positive reinforcement: spending below average
  const sm = summarizeMonth(txns, month);
  const prev = [1, 2, 3].map((i) => summarizeMonth(txns, addMonthsKey(month, -i))).filter((m) => m.spending > 0);
  if (prev.length >= 2 && today.slice(8) >= '15') {
    const avg = Math.round(prev.reduce((a, m) => a + m.spending, 0) / prev.length);
    if (sm.spending < avg * 0.8 && sm.spending > 0) out.push({ id: 'spend-low', tone: 'positive', title: 'Spending is running below your recent average', body: `${formatMoney(sm.spending)} so far vs a typical ${formatMoney(avg)} for the full month.`, assumptions: [`Average of the last ${prev.length} months.`], link: '#/insights' });
  }
  void monthLabel;
  return out;
}
