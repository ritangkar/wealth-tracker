import { Card, Grid, Page, Stat } from '../kit';
import { formatDate, formatMoney } from '../format';
import { personName, useDb, useScope, useStore } from '../state';
import { useRoute } from '../router';
import { cardMetrics } from '../../domain/cards';
import { emiState } from '../../domain/emi';
import { debtOverview } from '../../domain/liabilities';
import { inScope } from '../../domain/scope';
import { Note, Tabs } from './wealth/shared';
import CardsTab from './debt/Cards';
import EmisTab from './debt/Emis';
import LoansTab from './debt/Loans';
import './debt/debt.css';

const TABS = [{ id: 'cards', label: 'Cards' }, { id: 'emis', label: 'EMIs' }, { id: 'loans', label: 'Loans' }];

export default function Debt() {
  const route = useRoute(); const db = useDb(); const store = useStore(); const [scope] = useScope();
  const raw = route.query.get('tab') ?? 'cards';
  const tab = TABS.some((t) => t.id === raw) ? raw : 'cards';
  const today = store.today();

  const cards = db.accounts.filter((a) => a.kind === 'credit_card' && !a.archived && inScope(a.ownerId, scope));
  const cardOut = cards.reduce((s, a) => s + cardMetrics(db, a, today).outstanding, 0);
  const loans = debtOverview({ transactions: db.transactions, liabilities: db.liabilities.filter((l) => inScope(l.ownerId, scope)) }, today);
  const emiMonthly = db.emis.filter((e) => inScope(e.ownerId, scope)).filter((e) => emiState(e).active).reduce((s, e) => s + e.emiAmount, 0);
  const total = cardOut + loans.totalDebt;
  const monthly = emiMonthly + loans.monthlyCommitment;

  return (
    <Page title="Cards, EMIs & loans" subtitle={scope === 'household' ? 'What the household owes, in one calm place' : `${personName(db, scope)}’s share`}>
      <Card tone="accent">
        <div class="db-total">
          <div class="muted">Total debt</div>
          <div class="hero" aria-label={`Total debt ${formatMoney(total)}`}>{formatMoney(total)}</div>
        </div>
        <Grid cols={3}>
          <Stat label="Card outstanding" value={formatMoney(cardOut)} />
          <Stat label="Loans outstanding" value={formatMoney(loans.totalDebt)} />
          <Stat label="Monthly commitments" value={formatMoney(monthly)} sub="EMIs + loan payments" />
        </Grid>
        <Note>
          Loans debt-free: {loans.totalDebt === 0 ? 'no active loans' : loans.debtFreeUnknown ? 'depends on EMI (some loans have no EMI set)' : loans.projectedDebtFree ? `${formatDate(loans.projectedDebtFree)} (estimate at current EMIs)` : 'depends on EMI'}.
          {' '}Card outstanding is a balance you clear with your own bill payments, so it’s kept out of that date.
        </Note>
      </Card>
      <Tabs tabs={TABS} value={tab} base="/debt" label="Debt sections" />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'cards' && <CardsTab />}
        {tab === 'emis' && <EmisTab />}
        {tab === 'loans' && <LoansTab />}
      </div>
    </Page>
  );
}
