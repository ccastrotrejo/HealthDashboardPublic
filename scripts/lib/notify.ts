/**
 * Escalation notification hook — the ONLY place the daily pipeline reaches out
 * beyond writing static JSON.
 *
 * Security posture (see SECURITY.md):
 *  - Runs server-side only, inside the daily GitHub Action / local sync run.
 *  - The webhook URL is read from process.env (HEALTH_ESCALATION_WEBHOOK_URL),
 *    never hardcoded and never written into the browser bundle or snapshot.json.
 *  - No-ops gracefully when the env var is unset, so the pipeline works
 *    unchanged for anyone who hasn't configured a webhook.
 *  - Failures are swallowed (logged, not thrown): a flaky webhook must never
 *    fail the sync or block the snapshot from being written.
 */

import type { AnomalyEscalation } from './types.js';

/** Env var carrying the webhook URL. Configure as a GitHub Actions secret. */
const WEBHOOK_ENV = 'HEALTH_ESCALATION_WEBHOOK_URL';

export interface EscalationContext {
  /** YYYY-MM-DD of the snapshot this escalation belongs to. */
  date: string;
  /** Titles of the anomalies that combined to escalate, for a readable message. */
  anomalyTitles: string[];
}

/**
 * Fire the escalation notification. Call this ONLY when
 * `escalation.active === true`. POSTs a compact JSON payload to the configured
 * webhook. When the env var is unset (or DRY_RUN is on) it logs and no-ops.
 *
 * Returns `true` if a notification was actually sent, `false` otherwise, so the
 * caller can log the outcome without needing to know the transport details.
 */
export async function notifyEscalation(
  escalation: AnomalyEscalation,
  ctx: EscalationContext,
): Promise<boolean> {
  if (!escalation.active) return false;

  const url = process.env[WEBHOOK_ENV];
  if (!url) {
    console.error(
      `[notify] escalation active but ${WEBHOOK_ENV} not set — skipping notification`,
    );
    return false;
  }
  if (process.env.DRY_RUN === '1') {
    console.error('[dry-run] would POST escalation notification to webhook');
    return false;
  }

  const payload = {
    kind: 'health-anomaly-escalation',
    date: ctx.date,
    reasons: escalation.reasons,
    triggeredBy: escalation.triggeredBy,
    anomalies: ctx.anomalyTitles,
    firedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[notify] webhook returned ${res.status} — escalation not delivered`);
      return false;
    }
    console.error('[notify] escalation notification delivered');
    return true;
  } catch {
    // Never surface the error object — it can echo the URL back into logs.
    console.error('[notify] escalation webhook POST failed — continuing');
    return false;
  }
}
