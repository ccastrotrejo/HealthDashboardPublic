import type { TodaysCall } from './types';

interface TrainingAction {
  title: string;
  guidance: string;
  adjusted: boolean;
}

/** Present readiness as an effort ceiling, never permission to add unplanned work. */
export function resolveTrainingAction(call: TodaysCall | null, session: string): TrainingAction {
  if (!call) {
    return {
      title: session,
      guidance: 'No readiness call is available. Use your own judgment before training.',
      adjusted: false,
    };
  }

  switch (call.intensity) {
    case 'rest':
      return {
        title: 'Make today a recovery day.',
        guidance: 'Replace the programmed session with recovery.',
        adjusted: true,
      };
    case 'easy':
      return {
        title: 'Keep today easy.',
        guidance: 'Keep the programmed session easy and controlled. This is an effort ceiling, not extra work.',
        adjusted: true,
      };
    case 'moderate':
      return {
        title: 'Leave some margin today.',
        guidance: 'Keep effort moderate at most. An easy or rest day stays easy or restful.',
        adjusted: true,
      };
    case 'hard':
      return {
        title: session,
        guidance: 'Readiness supports the programmed work. Keep any planned rest or easy work as written.',
        adjusted: false,
      };
  }
}
