/**
 * `fallbackReason` and the LLM error path are published surfaces: they are
 * written into private/data/*.json, committed to a private repo by the workflow, and
 * rendered into a title attribute in the browser. SECURITY.md requires the
 * vendor clients to report an HTTP status and nothing else; these tests hold
 * the AI client to the same line.
 */
import { describe, expect, it } from 'vitest';
import { scrubReason } from './ai-context.js';

describe('scrubReason', () => {
  it('redacts an OpenAI-style key echoed by a provider 401', () => {
    const out = scrubReason(
      'LLM openai returned HTTP 401: Incorrect API key provided: sk-proj-AbC123DeF456GhI789',
    );
    expect(out).not.toContain('sk-proj-AbC123DeF456GhI789');
    expect(out).toContain('[redacted]');
  });

  it('redacts a GitHub token', () => {
    const out = scrubReason('auth failed for ghp_AbCdEf0123456789AbCdEf0123456789');
    expect(out).not.toContain('ghp_AbCdEf0123456789AbCdEf0123456789');
  });

  it('redacts a bearer header fragment', () => {
    expect(scrubReason('sent Bearer abcdef0123456789')).not.toContain('abcdef0123456789');
  });

  it('strips URLs, which can carry credentials in the query string', () => {
    const out = scrubReason('POST https://gateway.internal/v1/chat?api_key=abc123def456 failed');
    expect(out).not.toContain('gateway.internal');
    expect(out).toContain('[url]');
  });

  it('caps length so a large body cannot be published wholesale', () => {
    expect(scrubReason('x'.repeat(5000)).length).toBeLessThanOrEqual(200);
  });

  it('leaves an ordinary reason readable', () => {
    expect(scrubReason('no LLM provider configured')).toBe('no LLM provider configured');
  });
});
