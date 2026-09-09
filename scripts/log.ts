#!/usr/bin/env tsx
/**
 * Athlete-logged input CLI.
 *
 * Closes the pipeline's two structural blind spots:
 *
 *   1. STRENGTH. Three of seven program days are lifts, and no wearable reports
 *      barbell load. Whoop records 70+ `functional-fitness` sessions carrying
 *      only heart rate and strain. Every AI claim about strength progress was
 *      therefore unfalsifiable — and the coach did in fact invent working
 *      weights and rep schemes that were not in the program.
 *
 *   2. SUBJECTIVE LOAD. Every other signal is passive. Session RPE is the
 *      best-validated internal-load measure available without a lab, it takes
 *      one number per session, and it is what makes a genuine cross-sport ACWR
 *      possible: a lift and a swim have no common distance, but they do have a
 *      common RPE × minutes.
 *
 * Usage:
 *   pnpm log lift                     interactive lift entry
 *   pnpm log rpe                      interactive session RPE entry
 *   pnpm log rpe 7 --note "legs flat" quick RPE for today's single session
 *   pnpm log bike                     structured bike session (prescribed vs actual)
 *   pnpm log show                     summarise what's logged
 *
 * These files live in private/data/ and are never touched by the sync, so
 * hand-entered data survives every run.
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dataPath } from './lib/storage.js';
import athleteConfig from './lib/athlete-config.js';
import { stdin, stdout } from 'node:process';
import { utcDateTime } from '../utils/date.js';
import type {
  AiFeedbackData,
  AiFeedbackEntry,
  BikeWorkoutEntry,
  BikeWorkoutsData,
  LiftEntry,
  LiftSession,
  LiftSet,
  LiftsData,
  SessionRpeEntry,
  SessionsData,
  Snapshot,
} from './lib/types.js';
import {
  cardioBike,
  currentProgramWeek,
  lifts,
  removedExercises,
  weeklySchedule,
  type DayKey,
} from '../src/lib/program.js';

const LIFTS_PATH = dataPath('lifts.json');
const SESSIONS_PATH = dataPath('sessions.json');
const BIKE_PATH = dataPath('bike-workouts.json');
const FEEDBACK_PATH = dataPath('ai-feedback.json');
const SNAPSHOT_PATH = dataPath('snapshot.json');

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    console.error(`! ${path} is unreadable — starting from empty`);
    return fallback;
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function todayIso(tz = process.env.USER_TIMEZONE || athleteConfig.timezone): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const DAY_KEYS: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function dayKeyFor(iso: string): DayKey {
  return DAY_KEYS[(new Date(utcDateTime(iso)).getUTCDay() + 6) % 7]!;
}

/**
 * Parse a compact set string into structured sets.
 *
 * Accepts `60x8, 60x8, 65x6` or `3x8@60` or `bw x12`. Typing five sets one
 * prompt at a time is the fastest way to guarantee nobody ever logs anything.
 */
export function parseSets(input: string): LiftSet[] {
  const out: LiftSet[] = [];
  for (const chunk of input.split(',').map((c) => c.trim()).filter(Boolean)) {
    // "3x8@60" — sets × reps at load
    const grouped = /^(\d+)\s*[x*]\s*(\d+)\s*@\s*(bw|[\d.]+)$/i.exec(chunk);
    if (grouped) {
      const count = parseInt(grouped[1]!, 10);
      const reps = parseInt(grouped[2]!, 10);
      const kg = /bw/i.test(grouped[3]!) ? 0 : parseFloat(grouped[3]!);
      for (let i = 0; i < count; i++) out.push({ reps, kg });
      continue;
    }
    // "60x8" — load × reps
    const single = /^(bw|[\d.]+)\s*[x*]\s*(\d+)$/i.exec(chunk);
    if (single) {
      out.push({
        kg: /bw/i.test(single[1]!) ? 0 : parseFloat(single[1]!),
        reps: parseInt(single[2]!, 10),
      });
      continue;
    }
    throw new Error(`could not parse "${chunk}" — use "60x8" or "3x8@60" or "bw x12"`);
  }
  if (!out.length) throw new Error('no sets parsed');
  return out;
}

/** Which program lift falls on a given date, if any. */
function liftForDate(iso: string) {
  const day = dayKeyFor(iso);
  return lifts.find((l) => l.day === day) ?? null;
}

async function logLift(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const dateAnswer = (await rl.question(`Date [${todayIso()}]: `)).trim();
    const date = dateAnswer || todayIso();
    const programLift = liftForDate(date);

    if (programLift) {
      console.log(`\n${programLift.label} — ${programLift.focus}`);
    } else {
      console.log(`\nNo program lift scheduled for ${dayKeyFor(date)}. Logging as a one-off.`);
    }

    const liftId =
      programLift?.id ??
      ((await rl.question('Label for this session [extra]: ')).trim() || 'extra');

    const entries: LiftEntry[] = [];
    const planned = programLift?.exercises ?? [];

    console.log(
      `\nEnter sets as "60x8, 60x8, 65x6" or "3x8@60". Blank to skip an exercise, "done" to finish.\n`,
    );

    for (const ex of planned) {
      const answer = (await rl.question(`  ${ex.name} (${ex.sets}×${ex.reps}): `)).trim();
      if (!answer) continue;
      if (answer.toLowerCase() === 'done') break;
      try {
        entries.push({ exercise: ex.name, sets: parseSets(answer) });
      } catch (e) {
        console.error(`  ! ${(e as Error).message} — skipped`);
      }
    }

    // Anything extra the athlete did beyond the template.
    for (;;) {
      const name = (await rl.question('  Extra exercise (blank to finish): ')).trim();
      if (!name) break;
      if (removedExercises.some((r) => r.toLowerCase() === name.toLowerCase())) {
        console.error(`  ! "${name}" is on the removed-exercise list for this athlete. Not logged.`);
        continue;
      }
      const sets = (await rl.question(`    sets for ${name}: `)).trim();
      try {
        entries.push({ exercise: name, sets: parseSets(sets) });
      } catch (e) {
        console.error(`  ! ${(e as Error).message} — skipped`);
      }
    }

    if (!entries.length) {
      console.error('\nNothing entered. Not writing.');
      return;
    }

    const rpeAnswer = (await rl.question('\nSession RPE 1-10 (blank to skip): ')).trim();
    const notes = (await rl.question('Notes (blank to skip): ')).trim();

    const session: LiftSession = {
      date,
      liftId,
      entries,
      ...(rpeAnswer ? { sessionRpe: Number(rpeAnswer) } : {}),
      ...(notes ? { notes } : {}),
    };

    const data = readJson<LiftsData>(LIFTS_PATH, { sessions: [] });
    // Re-logging the same day replaces rather than duplicates.
    data.sessions = data.sessions.filter((s) => !(s.date === date && s.liftId === liftId));
    data.sessions.push(session);
    data.sessions.sort((a, b) => a.date.localeCompare(b.date));
    writeJson(LIFTS_PATH, data);

    const totalSets = entries.reduce((acc, e) => acc + e.sets.length, 0);
    console.error(`\n✓ Logged ${entries.length} exercises / ${totalSets} sets to ${LIFTS_PATH}`);

    // A lift is also a session, so mirror the RPE into sessions.json where the
    // load calculation reads it.
    if (rpeAnswer) {
      upsertRpe({ date, sport: 'functional-fitness', rpe: Number(rpeAnswer), ...(notes ? { note: notes } : {}) });
      console.error(`✓ Mirrored session RPE ${rpeAnswer} into ${SESSIONS_PATH}`);
    }
    console.error('  Saved locally. Only commit private/data/ to a private repository.');
  } finally {
    rl.close();
  }
}

function upsertRpe(entry: SessionRpeEntry): void {
  const data = readJson<SessionsData>(SESSIONS_PATH, { sessions: [] });
  data.sessions = data.sessions.filter(
    (s) =>
      !(
        s.date === entry.date &&
        (entry.activityId != null ? s.activityId === entry.activityId : s.sport === entry.sport)
      ),
  );
  data.sessions.push(entry);
  data.sessions.sort((a, b) => a.date.localeCompare(b.date));
  writeJson(SESSIONS_PATH, data);
}

async function logRpe(argv: string[]): Promise<void> {
  const date = todayIso();
  const snapshot = existsSync(SNAPSHOT_PATH)
    ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot)
    : null;
  const todays = (snapshot?.weekly?.recentActivities ?? []).filter((a) =>
    a.startDateLocal.startsWith(date),
  );

  // Non-interactive fast path: `pnpm log rpe 7 --note "legs flat"`
  const quick = argv[0] && /^\d+(\.\d+)?$/.test(argv[0]) ? Number(argv[0]) : null;
  if (quick != null) {
    const noteIdx = argv.indexOf('--note');
    const note = noteIdx >= 0 ? argv[noteIdx + 1] : undefined;
    if (todays.length > 1) {
      console.error(
        `! ${todays.length} sessions logged today — quick mode is ambiguous. Run "pnpm log rpe" interactively.`,
      );
      process.exit(2);
    }
    const only = todays[0];
    upsertRpe({
      date,
      rpe: quick,
      ...(only ? { activityId: only.id, sport: only.sportType } : {}),
      ...(note ? { note } : {}),
    });
    console.error(`✓ RPE ${quick} recorded for ${only ? only.name : date}`);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!todays.length) {
      console.error(`No activities in the snapshot for ${date}. Has the sync run?`);
      const proceed = (await rl.question('Log an unmatched RPE anyway? [y/N] ')).trim();
      if (proceed.toLowerCase() !== 'y') return;
      const rpe = Number((await rl.question('RPE 1-10: ')).trim());
      const note = (await rl.question('Note (blank to skip): ')).trim();
      upsertRpe({ date, rpe, ...(note ? { note } : {}) });
      console.error(`✓ RPE ${rpe} recorded for ${date}`);
      return;
    }

    console.log(`\nSessions on ${date}:`);
    todays.forEach((a, i) => {
      console.log(
        `  ${i + 1}. ${a.name} — ${a.sportType}, ${Math.round(a.movingTimeSeconds / 60)} min` +
          (a.sessionRpe != null ? ` (already RPE ${a.sessionRpe})` : ''),
      );
    });
    console.log('');

    for (const a of todays) {
      const answer = (
        await rl.question(`  RPE 1-10 for "${a.name}" (blank to skip): `)
      ).trim();
      if (!answer) continue;
      const note = (await rl.question(`    note (blank to skip): `)).trim();
      upsertRpe({
        date,
        activityId: a.id,
        sport: a.sportType,
        rpe: Number(answer),
        ...(note ? { note } : {}),
      });
      console.error(`  ✓ ${a.name}: RPE ${answer}`);
    }
    console.error('\n  Saved locally. Only commit private/data/ to a private repository.');
  } finally {
    rl.close();
  }
}

/**
 * Ingest feedback exported from the dashboard.
 *
 * The site is static and behind basic auth with no backend, so the UI records
 * thumbs up/down in localStorage and offers a copy button. This mirrors the
 * existing `coach:save` clipboard convention: paste it back in, commit, and the
 * next generation run picks the notes up as few-shot negatives.
 */
function saveFeedback(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (e) {
    console.error('Input is not valid JSON:', e instanceof Error ? e.message : 'unknown');
    process.exit(2);
  }

  const incoming: AiFeedbackEntry[] = Array.isArray(parsed)
    ? (parsed as AiFeedbackEntry[])
    : ((parsed as AiFeedbackData).entries ?? []);

  if (!Array.isArray(incoming) || !incoming.length) {
    console.error('No feedback entries found in the input.');
    process.exit(2);
  }

  const valid = incoming.filter(
    (e) => e && typeof e.at === 'string' && typeof e.artifact === 'string' && (e.rating === 'up' || e.rating === 'down'),
  );
  if (!valid.length) {
    console.error('Input contained no well-formed entries.');
    process.exit(2);
  }

  const data = readJson<AiFeedbackData>(FEEDBACK_PATH, { entries: [] });
  const seen = new Set(data.entries.map((e) => `${e.at}|${e.artifact}`));
  let added = 0;
  for (const e of valid) {
    const key = `${e.at}|${e.artifact}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.entries.push(e);
    added++;
  }
  data.entries.sort((a, b) => a.at.localeCompare(b.at));
  // Keep the file bounded; only the most recent notes are ever used as examples.
  if (data.entries.length > 200) data.entries = data.entries.slice(-200);
  writeJson(FEEDBACK_PATH, data);

  console.error(`✓ Added ${added} new entries (${data.entries.length} total) to ${FEEDBACK_PATH}`);
  console.error('  Saved locally. Only commit private/data/ai-feedback.json to a private repository.');
}

/**
 * Log a structured bike session: what was prescribed, and what actually happened.
 *
 * The prescribed-versus-actual gap is the only way the coach can tell a session
 * that was nailed from one that fell apart in the third interval — Strava
 * reports both as "45 minutes of riding".
 */
async function logBike(): Promise<void> {
  const KINDS: BikeWorkoutEntry['kind'][] = [
    'z2',
    'tempo',
    'sweet-spot',
    'threshold',
    'over-unders',
    'vo2max',
    'anaerobic',
    'sprints',
    'test',
  ];

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const dateAnswer = (await rl.question(`Date [${todayIso()}]: `)).trim();
    const date = dateAnswer || todayIso();

    // Offer the week's prescription so the athlete can accept it rather than retype it.
    const week = currentProgramWeek(new Date(date + 'T12:00:00Z'));
    const prescribedDefault = week != null ? (cardioBike.find((w) => w.week === week)?.workout ?? '') : '';
    if (prescribedDefault) {
      console.log(`\nWeek ${week} key session: ${prescribedDefault}`);
    }

    console.log(`\nKinds: ${KINDS.join(', ')}`);
    const kindRaw = (await rl.question('Kind: ')).trim().toLowerCase();
    const kind = KINDS.find((k) => k === kindRaw);
    if (!kind) {
      console.error(`! "${kindRaw}" is not a known kind. Use one of: ${KINDS.join(', ')}`);
      return;
    }

    const prescribedRaw = (
      await rl.question(`Prescription${prescribedDefault ? ' [enter to accept above]' : ''}: `)
    ).trim();
    const prescribed = prescribedRaw || prescribedDefault;
    if (!prescribed) {
      console.error('! A prescription is required — it is the whole point of this log.');
      return;
    }

    const targetRaw = (await rl.question('Target watts (blank if none): ')).trim();
    const actualRaw = (await rl.question('Actual avg watts on the work intervals (blank if none): ')).trim();
    const completionRaw = (await rl.question('Completion — full / partial / abandoned [full]: '))
      .trim()
      .toLowerCase();
    const completion: BikeWorkoutEntry['completion'] =
      completionRaw === 'partial' || completionRaw === 'abandoned' ? completionRaw : 'full';
    const rpeRaw = (await rl.question('Session RPE 1-10 (blank to skip): ')).trim();
    const indoorRaw = (await rl.question('Indoor? y/N: ')).trim().toLowerCase();
    const note = (await rl.question('Note (optional): ')).trim();

    const entry: BikeWorkoutEntry = {
      date,
      kind,
      prescribed,
      completion,
      ...(targetRaw ? { targetWatts: Number(targetRaw) } : {}),
      ...(actualRaw ? { actualWatts: Number(actualRaw) } : {}),
      ...(rpeRaw ? { rpe: Number(rpeRaw) } : {}),
      ...(indoorRaw === 'y' ? { indoor: true } : {}),
      ...(note ? { note } : {}),
    };

    if (entry.rpe != null && (!Number.isFinite(entry.rpe) || entry.rpe < 1 || entry.rpe > 10)) {
      console.error('! RPE must be between 1 and 10.');
      return;
    }

    const data = readJson<BikeWorkoutsData>(BIKE_PATH, { workouts: [] });
    data.workouts.push(entry);
    data.workouts.sort((a, b) => a.date.localeCompare(b.date));
    writeJson(BIKE_PATH, data);

    // A session RPE entry keeps the cross-sport load model fed from the same input.
    if (entry.rpe != null) {
      const sessions = readJson<SessionsData>(SESSIONS_PATH, { sessions: [] });
      sessions.sessions.push({
        date,
        rpe: entry.rpe,
        sport: 'Ride',
        ...(note ? { note } : {}),
      } as SessionRpeEntry);
      sessions.sessions.sort((a, b) => a.date.localeCompare(b.date));
      writeJson(SESSIONS_PATH, sessions);
    }

    const delta =
      entry.targetWatts && entry.actualWatts
        ? ` (${entry.actualWatts - entry.targetWatts >= 0 ? '+' : ''}${
            entry.actualWatts - entry.targetWatts
          }W vs target)`
        : '';
    console.error(`✓ Logged ${kind} on ${date} — ${completion}${delta}`);
    console.error('  Saved locally. Only commit private/data/bike-workouts.json to a private repository.');
  } finally {
    rl.close();
  }
}

function show(): void {
  const liftsData = readJson<LiftsData>(LIFTS_PATH, { sessions: [] });
  const sessionsData = readJson<SessionsData>(SESSIONS_PATH, { sessions: [] });

  console.log(`Lift sessions: ${liftsData.sessions.length}`);
  for (const s of liftsData.sessions.slice(-8)) {
    const sets = s.entries.reduce((acc, e) => acc + e.sets.length, 0);
    console.log(
      `  ${s.date} [${s.liftId}] ${s.entries.length} exercises / ${sets} sets` +
        (s.sessionRpe != null ? ` · RPE ${s.sessionRpe}` : ''),
    );
  }

  console.log(`\nSession RPE entries: ${sessionsData.sessions.length}`);
  for (const s of sessionsData.sessions.slice(-8)) {
    console.log(`  ${s.date} ${s.sport ?? 'unmatched'} · RPE ${s.rpe}${s.note ? ` — ${s.note}` : ''}`);
  }

  const feedback = readJson<AiFeedbackData>(FEEDBACK_PATH, { entries: [] });
  const down = feedback.entries.filter((e) => e.rating === 'down').length;
  console.log(
    `\nAI feedback: ${feedback.entries.length} entries (${down} negative, used as few-shot negatives).`,
  );

  const scheduled = weeklySchedule.filter((d) => d.sessionType === 'lift').length;
  console.log(
    `\nProgram schedules ${scheduled} lifts/week. Without lifts.json entries the AI cannot make any ` +
      `claim about strength progression.`,
  );

  const bike = readJson<BikeWorkoutsData>(BIKE_PATH, { workouts: [] });
  console.log(`\nBike workouts: ${bike.workouts.length}`);
  for (const w of bike.workouts.slice(-8)) {
    const delta =
      w.targetWatts && w.actualWatts
        ? ` · ${w.actualWatts}W vs ${w.targetWatts}W target`
        : '';
    console.log(`  ${w.date} [${w.kind}] ${w.completion}${delta} — ${w.prescribed}`);
  }
  if (!bike.workouts.length) {
    console.log(
      '  None logged. Without these the coach can see ride volume but cannot tell whether a ' +
        'prescribed interval session was actually completed.',
    );
  }
}

const cmd = process.argv[2];
const rest = process.argv.slice(3);

if (cmd === 'lift') {
  await logLift();
} else if (cmd === 'rpe') {
  await logRpe(rest);
} else if (cmd === 'bike') {
  await logBike();
} else if (cmd === 'show') {
  show();
} else if (cmd === 'feedback') {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    console.error('No input on stdin. Copy the feedback JSON from the dashboard, then:');
    console.error('  pbpaste | pnpm log feedback');
    process.exit(2);
  }
  saveFeedback(raw);
} else {
  console.error('Usage:');
  console.error('  pnpm log lift               # log a strength session');
  console.error("  pnpm log rpe                # log session RPE for today's activities");
  console.error('  pnpm log rpe 7 --note "legs flat"');
  console.error('  pnpm log bike               # log a structured bike session (prescribed vs actual)');
  console.error('  pbpaste | pnpm log feedback # ingest AI feedback exported from the dashboard');
  console.error('  pnpm log show               # summarise what is logged');
  process.exit(2);
}
