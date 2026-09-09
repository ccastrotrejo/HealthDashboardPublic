import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '../shared/Card';
import { weeklySchedule, todayKey } from '../../lib/program';

/**
 * The 7-day grid: session + duration + calorie/carb cycling target per day.
 * Today's row is highlighted so it's the first thing the eye lands on.
 */
export function ScheduleCard() {
  const today = todayKey();

  return (
    <Card title="Weekly schedule" subtitle="Carb cycling follows training stimulus">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-900/10 text-left text-xs font-semibold text-ink-500">
              <th className="py-2 pr-3">Day</th>
              <th className="py-2 pr-3">Session</th>
              <th className="py-2 pr-3 hidden sm:table-cell">Duration</th>
              <th className="py-2 pr-3 text-right tabular-nums">kcal</th>
              <th className="py-2 text-right tabular-nums">Carbs</th>
            </tr>
          </thead>
          <tbody>
            {weeklySchedule.map((d) => {
              const isToday = d.day === today;
              return (
                <tr
                  key={d.day}
                  className={`border-b border-ink-900/5 last:border-0 ${
                    isToday ? 'bg-sage-ink/5 font-medium text-ink-900' : 'text-ink-700'
                  }`}
                >
                  <td className="py-2 pr-3">
                    {d.day}
                    {isToday && (
                      <span className="ml-1.5">
                        <Badge variant="green" label="today" />
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {d.session}
                    <span className="mt-1 block text-xs text-ink-500 sm:hidden">{d.duration}</span>
                  </td>
                  <td className="py-2 pr-3 hidden sm:table-cell text-ink-500">
                    {d.duration}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {d.calories.toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">{d.carbs}g</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
