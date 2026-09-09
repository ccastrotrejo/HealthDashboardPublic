import { useMemo } from 'react';
import type { CoachDay } from '../../lib/types';
import { trainingHeights, type ThreeScene } from '../../lib/threeScene';
import { ThreeView } from '../shared/ThreeView';

interface TrainingMiniatureProps {
  days: CoachDay[];
  selectedDay: CoachDay['weekday'];
}

/** Shares the agenda selection; categorical heights are not measured training load. */
export function TrainingMiniature({ days, selectedDay }: TrainingMiniatureProps) {
  const scene = useMemo<ThreeScene>(() => ({
    kind: 'training',
    days: days.map((day) => ({ label: day.weekday, intensity: day.intensity })),
    selectedIndex: days.findIndex((day) => day.weekday === selectedDay),
  }), [days, selectedDay]);
  const valid = days.length > 0 && days.length <= 7 &&
    days.every((day) => Object.hasOwn(trainingHeights, day.intensity));
  if (!valid) {
    return <p className="mt-3 text-caption text-ink-500">The miniature needs up to seven sessions with recorded intensity labels.</p>;
  }
  return (
    <div className="mt-4">
      <ThreeView label="Training week" scene={scene} interactive className="h-56 sm:h-64"
        fallback={(
          <svg viewBox={`0 0 ${days.length * 60} 160`} aria-hidden="true" className="h-full w-full">
            {days.map((day, index) => {
              const height = trainingHeights[day.intensity] * 65;
              const selected = day.weekday === selectedDay;
              return (
                <g key={day.weekday}>
                  <rect x={index * 60 + 12} y={120 - height} width="36" height={height} rx="4"
                    fill={selected ? 'var(--color-sage-ink)' : 'var(--color-ink-500)'} />
                  <text x={index * 60 + 30} y="144" textAnchor="middle" fontSize="12"
                    fontWeight={selected ? '700' : '400'} fill="var(--color-ink-900)">{day.weekday}</text>
                  {selected && <circle cx={index * 60 + 30} cy="154" r="3" fill="var(--color-ink-900)" />}
                </g>
              );
            })}
          </svg>
        )}
      />
      <p className="mt-2 text-caption text-ink-500">
        Left to right: {days.map((day) => day.weekday).join(', ')}.
        Height shows planned intensity: rest, easy, moderate, hard, from shortest to tallest.
        The dot marks {selectedDay}. Use the day buttons above to change selection.
        This is the generated plan, not completed sessions or measured load.
      </p>
    </div>
  );
}
