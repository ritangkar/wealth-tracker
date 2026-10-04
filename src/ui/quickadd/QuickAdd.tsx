import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../kit';
import { TXN_LABELS } from '../format';
import { closeQuickAdd, useDb, useQuickAdd, useScope, type QuickKind } from '../state';
import ExpenseForm from './ExpenseForm';
import IncomeForm from './IncomeForm';
import TransferForm from './TransferForm';
import InvestForm from './InvestForm';
import LoanForm from './LoanForm';
import WasteForm from './WasteForm';
import GoalForm from './GoalForm';
import MoreForm from './MoreForm';
import { Note } from './shared';

const TABS: { kind: QuickKind; label: string }[] = [
  { kind: 'expense', label: 'Expense' }, { kind: 'income', label: 'Income' }, { kind: 'transfer', label: 'Transfer' },
  { kind: 'invest', label: 'Invest' }, { kind: 'loan', label: 'Loan payment' }, { kind: 'waste', label: 'Waste' }, { kind: 'goal', label: 'Goal' }, { kind: 'more', label: 'More' },
];

export default function QuickAdd() {
  const q = useQuickAdd(); const db = useDb(); const [scope] = useScope();
  const [kind, setKind] = useState<QuickKind>(q?.kind ?? 'expense');
  useEffect(() => { if (q) setKind(q.kind); }, [q]);
  if (!q) return null;

  const editing = !!q.editId;
  const editTxn = editing ? db.transactions.find((t) => t.id === q.editId) : undefined;
  const title = editing ? `Edit ${editTxn ? TXN_LABELS[editTxn.type].toLowerCase() : kind === 'waste' ? 'waste entry' : 'entry'}` : 'Add';
  const props = { key: `${kind}-${q.editId ?? 'new'}`, editId: q.editId, onClose: closeQuickAdd, scope };
  const needsAccount = db.accounts.length === 0 && kind !== 'waste' && kind !== 'goal';

  return (
    <Sheet title={title} onClose={closeQuickAdd}>
      {!editing && (
        <div class="tabs qa-tabs" role="tablist" aria-label="What are you adding?">
          {TABS.map((t) => (
            <button key={t.kind} type="button" role="tab" class="tab" aria-selected={t.kind === kind} onClick={() => setKind(t.kind)}>{t.label}</button>
          ))}
        </div>
      )}
      {needsAccount ? (
        <Note>You’ll need an account first, so we know where the money moves.{' '}
          <a href="#/welcome" onClick={closeQuickAdd}>Set up your accounts</a></Note>
      ) : kind === 'expense' ? <ExpenseForm {...props} />
        : kind === 'income' ? <IncomeForm {...props} />
        : kind === 'transfer' ? <TransferForm {...props} />
        : kind === 'invest' ? <InvestForm {...props} />
        : kind === 'loan' ? <LoanForm {...props} />
        : kind === 'waste' ? <WasteForm {...props} />
        : kind === 'more' ? <MoreForm {...props} />
        : <GoalForm {...props} />}
    </Sheet>
  );
}
