import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '../shared/Card';
import { macros, dailyTiming, todayKey, planForDay } from '../../lib/program';
import { formatNumber } from '../../lib/format';
import { macroEnergy } from '../../lib/trainingPresentation';

/**
 * Today's listed macros and their energy split. The program calorie target
 * stays separate because it does not always equal energy from the listed grams.
 */
export function MacrosCard() {
  const day = todayKey();
  const plan = planForDay(day);

  const { calories, proteinPct, carbsPct, fatPct } = macroEnergy(macros.protein, plan.carbs, macros.fat);

  return (
    <Card title="Today's fuel" subtitle={macros.cycling} fitContent>
      <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink-900">
        {formatNumber(calories)} <span className="text-sm font-normal tracking-normal text-ink-500">kcal from today’s macros</span>
      </p>
      <p className="mt-1 text-xs text-ink-500">
        Program calorie target: {formatNumber(plan.calories)} kcal · {day}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3 border-y border-border py-3">
        <Stat label="Protein" value={`${macros.protein}g`} sub="constant" />
        <Stat
          label="Carbs"
          value={`${plan.carbs}g`}
          sub={`cycles · ${day}`}
        />
        <Stat label="Fat" value={`${macros.fat}g`} sub="constant" />
      </div>

      {/* Macro split — protein/carbs/fat as a share of daily calories. The
          percentages are printed in the legend below rather than hidden in
          tooltips, which no touch device can reach. */}
      <div aria-hidden className="mt-4 flex h-2 overflow-hidden rounded-sm bg-ink-900/5">
        <div className="bg-ink-900/70" style={{ width: `${proteinPct}%` }} />
        <div className="bg-ink-900/40" style={{ width: `${carbsPct}%` }} />
        <div className="bg-ink-900/20" style={{ width: `${fatPct}%` }} />
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        {[
          { label: 'Protein', pct: proteinPct, swatch: 'bg-ink-900/70' },
          { label: 'Carbs', pct: carbsPct, swatch: 'bg-ink-900/40' },
          { label: 'Fat', pct: fatPct, swatch: 'bg-ink-900/20' },
        ].map((m) => (
          <li key={m.label} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-sm ${m.swatch}`} />
            <span>
              {m.label} <span className="tabular-nums">{formatNumber(m.pct)}%</span>
            </span>
          </li>
        ))}
      </ul>

      {calories !== plan.calories && (
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          The listed grams total {formatNumber(calories)} kcal using 4/4/9 kcal per gram;
          the program’s separate calorie target is {formatNumber(plan.calories)} kcal.
        </p>
      )}

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold text-ink-500">
          Meal timing · program reference
        </p>
        <div className="text-sm [&_dt]:whitespace-nowrap">
          <MetadataList columns="single" label={{ position: 'start', width: '4.5rem' }}>
            {dailyTiming.map((m) => (
              <MetadataListItem key={m.time} label={m.time}>
                <span className="flex min-w-0 flex-col gap-0.5 min-[460px]:flex-row min-[460px]:items-baseline min-[460px]:justify-between min-[460px]:gap-2">
                  <span className="min-w-0 text-ink-700">{m.meal}</span>
                  <span className="shrink-0 tabular-nums text-xs text-ink-500">
                    {m.kcal > 0 ? `${m.kcal} kcal · ${m.protein}g P` : ''}
                  </span>
                </span>
              </MetadataListItem>
            ))}
          </MetadataList>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{value}</p>
      <p className="break-words text-xs text-ink-500">{sub}</p>
    </div>
  );
}
