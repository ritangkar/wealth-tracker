import { addMonthsKey, monthLabel, type MonthKey } from '../../../domain/dates';

/** Previous / next month stepper. `max` blocks navigating past the current month. */
export function MonthNav({ month, onChange, max }: { month: MonthKey; onChange: (m: MonthKey) => void; max: MonthKey }) {
  return (
    <div class="px-monthnav" role="group" aria-label="Choose month">
      <button type="button" class="icon-btn" aria-label="Previous month" onClick={() => onChange(addMonthsKey(month, -1))}>‹</button>
      <strong aria-live="polite">{monthLabel(month, true)}</strong>
      <button type="button" class="icon-btn" aria-label="Next month" disabled={month >= max} onClick={() => onChange(addMonthsKey(month, 1))}>›</button>
    </div>
  );
}
