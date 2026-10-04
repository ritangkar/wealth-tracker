import { Sheet } from '../kit';
import { closeQuickAdd, useQuickAdd } from '../state';
export default function QuickAdd() {
  const q = useQuickAdd(); if (!q) return null;
  return <Sheet title="Add" onClose={closeQuickAdd}><p>Quick add: {q.kind}</p></Sheet>;
}
