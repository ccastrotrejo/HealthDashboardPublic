/**
 * Single source of truth for ⓘ tooltip copy. Edit one place, every card
 * that shows the metric picks up the change.
 *
 * Style guide:
 *  - title: ≤3 words
 *  - body: 1–2 short sentences explaining what it is and what it tells you
 *  - thresholds: concrete bands users can immediately compare to
 */

export type MetricKey =
  | 'weekly-volume'
  | 'weekly-zone-mix'
  | 'acwr'
  | 'intensity-distribution'
  | 'fitness-curve'
  | 'recent-activities'
  | 'pr-tracker'
  | 'year-over-year'
  | 'recovery'
  | 'todays-call'
  | 'sleep'
  | 'hrv'
  | 'rhr'
  | 'strain'
  | 'anomalies'
  | 'sleep-regularity'
  | 'agreement'
  | 'gear'
  | 'race-readiness'
  | 'weekly-plan'
  | 'nutrition'
  | 'steps'
  | 'body-battery'
  | 'stress'
  | 'vo2max'
  | 'race-week'
  | 'intensity-minutes'
  | 'floors'
  | 'training-readiness'
  | 'training-status'
  | 'training-load'
  | 'garmin-race-predictions'
  | 'spo2'
  | 'ftp';

export interface TooltipCopy {
  title: string;
  body: string;
  thresholds?: { label: string; range: string }[];
}

export const tooltipCopy: Record<MetricKey, TooltipCopy> = {
  ftp: {
    title: 'FTP — Functional Threshold Power',
    body: 'The highest power you can hold for about an hour, in watts. Every training zone is a percentage of it, so it is the single number the whole cycling block is trying to move. W/kg matters more than raw watts on anything uphill. Power is only measured on the indoor trainer — outdoor rides here are heart-rate only, which is what the coverage figure tracks.',
    thresholds: [
      { label: 'Cat 4', range: '2.9–3.4 W/kg' },
      { label: 'Cat 5', range: '2.4–2.9 W/kg' },
      { label: 'Novice', range: '1.9–2.4 W/kg' },
    ],
  },
  'weekly-volume': {
    title: 'Weekly volume',
    body: 'Total distance per calendar week across all sports. The dashed line is your 4-week average — easiest way to see whether this week is on, above, or below your recent normal.',
  },
  'weekly-zone-mix': {
    title: 'Weekly HR-zone mix',
    body: 'Total minutes spent in each Whoop HR zone over the last 7 days. The polarized target (80% easy / 10% moderate / 10% hard) is what Seiler\'s research on elite endurance athletes recommends — most time aerobic, a small dose of true high-intensity. The header grade tells you how close the actual mix is.',
    thresholds: [
      { label: 'Polarized', range: '≥ 85% match — minimal middle' },
      { label: 'Mixed', range: '65–85% — some Z3 creep' },
      { label: 'Threshold-heavy', range: '< 65% — the "black hole"' },
    ],
  },
  acwr: {
    title: 'ACWR — Acute : Chronic Workload Ratio',
    body: 'How much you trained the last 7 days vs your weekly average over the last 28. Roughly 1.0 means "same as usual." Sharp spikes correlate with injury risk in the research; sharp drops correlate with detraining.',
    thresholds: [
      { label: 'Detraining', range: '< 0.8' },
      { label: 'Sweet spot', range: '0.8 – 1.3' },
      { label: 'Caution', range: '1.3 – 1.5' },
      { label: 'Injury risk', range: '> 1.5' },
    ],
  },
  'intensity-distribution': {
    title: 'Intensity distribution',
    body: 'Share of your last 28 days spent in easy, moderate, and hard efforts. Endurance research suggests "polarized" training works best — most time easy, a small fraction hard, very little in the moderate middle.',
    thresholds: [
      { label: 'Target easy', range: '≥ 80%' },
      { label: 'Target hard', range: '≈ 20%' },
    ],
  },
  'fitness-curve': {
    title: 'Fitness · Fatigue · Form',
    body: 'CTL (fitness) is your slow-moving 42-day average load — it builds up when you train consistently. ATL (fatigue) is the fast 7-day version. TSB (form) is CTL − ATL: positive means fresh, negative means accumulating fatigue.',
    thresholds: [
      { label: 'Fresh / peaking', range: 'TSB > +5' },
      { label: 'Productive', range: '−10 to +5' },
      { label: 'Overreaching', range: 'TSB < −30' },
    ],
  },
  'recent-activities': {
    title: "This week's activities",
    body: 'Every workout from the last 7 days, with an intensity tag based on type and pace. Use it as a sanity check against what the charts above are summarising.',
  },
  'pr-tracker': {
    title: 'Distance PRs',
    body: 'For each standard distance, your best average pace across all runs that landed close to that distance. This is an approximation — true PRs (the fastest 5k within a 10k run, for example) need Strava\'s per-activity best_efforts data which we don\'t pull. Good enough for tracking progression on round-distance training runs.',
  },
  'year-over-year': {
    title: 'Year over year',
    body: 'Solid line: this year\'s cumulative km from Jan 1 to today. Dashed line: last year through the same calendar date. The delta in the header tells you whether you\'re ahead or behind your same-time-last-year self.',
  },
  recovery: {
    title: 'Recovery score',
    body: 'Whoop\'s overall readiness number for the day. Combines overnight HRV, resting heart rate, SpO₂, and skin temperature against your personal baselines. The badge gives you the immediate read; the four contributors show what\'s driving the number.',
    thresholds: [
      { label: 'Optimal', range: '≥ 85' },
      { label: 'Good', range: '67–84' },
      { label: 'Adequate', range: '34–66' },
      { label: 'Pay attention', range: '< 34' },
    ],
  },
  'todays-call': {
    title: "Today's call",
    body: 'Recommended effort level for today, derived from your recovery score with downgrades for high training load (ACWR), short sleep, low HRV, or elevated skin temp. The bullets explain exactly why we landed where we did.',
  },
  sleep: {
    title: 'Sleep',
    body: 'Last night\'s sleep, in hours actually asleep (not just in bed). Performance % is asleep / needed — Whoop calculates need from your baseline plus recent sleep debt and strain. The stacked bar shows the time spent in each stage.',
  },
  hrv: {
    title: 'HRV — Heart Rate Variability',
    body: 'Overnight average of the variation in time between heartbeats. Higher = better autonomic recovery. Track the trend (sparkline) not the day-to-day number — HRV is noisy. The status badge compares the last 7 nights\' mean against the prior 23 nights — Balanced means within ±5%, Low and Poor flag sustained suppression below baseline.',
    thresholds: [
      { label: 'Balanced', range: '7d mean within ±5% of baseline' },
      { label: 'Unbalanced', range: 'Outside ±5% but not sustained low' },
      { label: 'Low', range: '7d mean 10–15% below baseline' },
      { label: 'Poor', range: '7d mean >15% below — recovery flag' },
    ],
  },
  rhr: {
    title: 'Resting heart rate',
    body: 'Your overnight lowest heart rate. Rising RHR over multiple days is a strong early signal of under-recovery, illness, or accumulated fatigue. The delta vs baseline above the sparkline flips red when RHR trends up.',
  },
  strain: {
    title: 'Day strain',
    body: 'Whoop\'s daily cardiovascular load on a 0–21 scale. Built from time spent in each heart-rate zone across all activities (not just workouts). Use it to see whether your day was actually as taxing as it felt.',
    thresholds: [
      { label: 'Light', range: '0–9' },
      { label: 'Moderate', range: '10–13' },
      { label: 'Hard', range: '14–17' },
      { label: 'All-out', range: '18–21' },
    ],
  },
  anomalies: {
    title: 'Anomalies',
    body: 'Auto-surfaced warnings when a recovery signal trends meaningfully off baseline. The dashboard does the watching so you don\'t have to remember to scan every metric. Card hides itself when nothing is firing.',
  },
  'sleep-regularity': {
    title: 'Sleep regularity',
    body: 'Bed time + wake time over the last 30 nights, plotted on a clock scale. Tight horizontal clusters mean consistent timing — research suggests that regularity is a stronger predictor of long-term health than total sleep duration.',
  },
  agreement: {
    title: 'Source agreement',
    body: 'For each recent workout, compares the heart-rate stats Strava recorded (from your watch) against the Whoop strap. >5% disagreement on average HR usually means one device had a sensor issue — strap was loose, or watch optical reading was off during high motion.',
  },
  gear: {
    title: 'Gear mileage',
    body: 'Distance accumulated on each pair of shoes / each bike you\'ve tagged in Strava. Shoes get a wear bar — research suggests 600 km is when cushioning starts degrading meaningfully and 800 km is when most runners should retire them.',
  },
  'race-readiness': {
    title: 'Race readiness',
    body: 'Predicted finish times for standard race distances, computed from your best recent PR using Riegel\'s formula: T2 = T1 × (D2/D1)^1.06. Reasonable for distances within ~2× of your anchor effort; over-promises if you extrapolate from a 5k to a marathon without doing the long runs.',
  },
  'weekly-plan': {
    title: 'Weekly plan',
    body: 'AI-generated Mon→Sun training plan tailored to your current state (recovery, ACWR, fitness, recent activities). You generate this manually via Claude.ai — see COACH.md for the workflow. Updates only when you re-paste a new plan.',
  },
  nutrition: {
    title: 'Nutrition',
    body: 'AI-generated practical nutrition guidance for the week ahead, tailored to your training load. Four short sections: daily eating anchors, pre/post fueling, one specific meal idea, one grocery prioritisation. Generated together with the weekly plan via Claude.ai.',
  },
  steps: {
    title: 'Daily steps',
    body: 'Step count for the most recent day from your Garmin device, with progress toward your daily goal. The sparkline shows the last 30 days — useful for spotting whether a sedentary patch is sneaking up on you.',
  },
  'body-battery': {
    title: 'Body Battery',
    body: 'Garmin\'s composite energy score, 0–100. Drains through stress and activity, charges through rest and quality sleep. The high/low pair tells you how much you replenished overnight and how much you burned through the day.',
  },
  stress: {
    title: 'Stress',
    body: 'Garmin\'s 0–100 stress score, derived from HRV throughout the day. Sustained high values across multiple days correlate with under-recovery. Note this is a different methodology from Whoop\'s recovery score — they\'re cross-checks, not duplicates.',
    thresholds: [
      { label: 'Rest', range: '0–25' },
      { label: 'Low', range: '26–50' },
      { label: 'Medium', range: '51–75' },
      { label: 'High', range: '76–100' },
    ],
  },
  vo2max: {
    title: 'VO₂ max',
    body: 'Garmin\'s estimate of your maximum aerobic capacity, in mL/kg/min. Updates after qualifying outdoor runs, so it\'s sticky — don\'t expect it to move day-to-day. A meaningful change over weeks is what to watch for.',
  },
  'race-week': {
    title: 'Race week strategy',
    body: 'Day-by-day plan for the final 7 days, plus a race-day fueling calculator. Volume drops sharply but intensity stays — you can\'t add fitness now, only lose it through fatigue. Fueling targets are heuristics; practice the exact plan in training before relying on it.',
  },
  'intensity-minutes': {
    title: 'Intensity minutes',
    body: 'WHO-aligned weekly target of 150 moderate-equivalent minutes — vigorous minutes count double. Garmin tallies this from any HR-elevated movement, not just logged workouts, so walks and chores count too.',
    thresholds: [
      { label: 'WHO weekly target', range: '150 min' },
    ],
  },
  floors: {
    title: 'Floors climbed',
    body: 'Garmin counts ~3 m of elevation gain as one floor. The default goal is 10/day. Useful as a proxy for "did I move vertically today" — sitting all day usually shows up as a single-digit count.',
  },
  'training-readiness': {
    title: 'Training readiness',
    body: 'Garmin\'s 0–100 morning readiness score combining sleep, HRV, recovery time, and acute load. Conceptually similar to Whoop\'s recovery score but with different inputs and methodology — head-to-head agreement is interesting, disagreement is informative.',
    thresholds: [
      { label: 'Low', range: '< 25' },
      { label: 'Medium', range: '25–50' },
      { label: 'High', range: '51–75' },
      { label: 'Maximum', range: '> 75' },
    ],
  },
  'training-status': {
    title: 'Training status',
    body: 'Garmin\'s plain-English summary of whether your training is paying off. Looks at your VO₂ max trend, acute vs chronic load, and recent intensity. Independent of the fitness curve above — uses Garmin\'s proprietary load model rather than CTL/ATL.',
    thresholds: [
      { label: 'Productive', range: 'Load + VO₂ both trending right' },
      { label: 'Peaking', range: 'Fitness up, fatigue managed' },
      { label: 'Maintaining', range: 'Steady state' },
      { label: 'Overreaching', range: 'Load high, recovery lagging' },
      { label: 'Unproductive', range: 'Load up but fitness flat/dropping' },
      { label: 'Detraining', range: 'Volume dropped below threshold' },
    ],
  },
  'training-load': {
    title: 'Training load (Garmin)',
    body: 'Acute load (7-day) vs chronic load (28-day) using Garmin\'s EPOC-derived model. The "load tunnel" is Garmin\'s sweet spot for your current fitness — too low = detraining, too high = overreaching. Different units from our ACWR card; not directly comparable but typically tells the same story.',
  },
  'garmin-race-predictions': {
    title: 'Race predictions (Garmin)',
    body: 'Garmin\'s estimates from your lactate threshold and VO₂ max — derived from the device, not from the Riegel formula our Race Readiness card uses. Side-by-side comparison: agreement reinforces the number; large divergence usually means one model is over-fitting to recent data.',
  },
  spo2: {
    title: 'Pulse Ox (SpO₂)',
    body: 'Overnight blood oxygen saturation, measured by the watch\'s pulse-ox sensor. Normal sea-level values sit in the high 90s. Drops can flag altitude acclimation, illness onset, or sleep-disordered breathing. Optical sensors are noisy — track multi-night trends, not single readings.',
    thresholds: [
      { label: 'Normal (sea level)', range: '95–100%' },
      { label: 'Mild hypoxia', range: '90–94%' },
      { label: 'Investigate', range: '< 90%' },
    ],
  },
};
