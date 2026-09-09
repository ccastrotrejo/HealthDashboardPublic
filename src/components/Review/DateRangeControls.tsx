import { useId, useState } from 'react';
import { shiftChartDate } from '../../lib/chartRefinement';
import { isCalendarDate, type DateRange } from '../../lib/exploration';

interface DateRangeControlsProps {
  bounds: DateRange;
  range: DateRange | null;
  onChange: (range: DateRange | null) => void;
}

export function DateRangeControls({ bounds, range, onChange }: DateRangeControlsProps) {
  const id = useId();
  const current = range ?? bounds;
  const [draft, setDraft] = useState<DateRange | null>(null);
  const [error, setError] = useState('');
  const values = draft ?? current;
  const apply = (next: DateRange | null) => {
    setDraft(null);
    setError('');
    onChange(next);
  };

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (!isCalendarDate(values.start) || !isCalendarDate(values.end) || values.start > values.end) {
        setError('Choose valid dates with the start on or before the end.');
      } else if (values.start < bounds.start || values.end > bounds.end) {
        setError('Choose dates within the recorded history.');
      } else apply(values);
    }}>
      {(['start', 'end'] as const).map((key) => (
        <label key={key} className="min-w-0 text-caption text-ink-500">
          {key === 'start' ? 'From' : 'Through'}
          <input type="date" value={values[key]} min={bounds.start} max={bounds.end}
            required aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
            className="mt-1 block min-h-11 max-w-full rounded-lg border border-ink-200 bg-transparent px-2 text-sm text-ink-900"
            onChange={(event) => setDraft({ ...values, [key]: event.target.value })} />
        </label>
      ))}
      <button type="submit" className="min-h-11 rounded-lg border border-ink-200 px-3 text-sm text-ink-900">Apply dates</button>
      {[7, 30].map((days) => (
        <button key={days} type="button" className="min-h-11 rounded-lg px-3 text-sm text-ink-700 hover:bg-ink-100"
          onClick={() => apply({ start: [bounds.start, shiftChartDate(bounds.end, 1 - days)].sort().at(-1)!, end: bounds.end })}>
          Last {days} days
        </button>
      ))}
      <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-ink-700 hover:bg-ink-100" onClick={() => apply(null)}>Reset</button>
      {error && <p id={`${id}-error`} role="alert" className="w-full text-sm text-terra-ink">{error}</p>}
    </form>
  );
}
