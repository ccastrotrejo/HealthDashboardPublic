/**
 * Minimal chat client for the AI dashboard sections.
 *
 * Provider resolution (first match wins):
 *   1. LLM_PROVIDER=copilot-cli — the GitHub Copilot CLI as a subprocess. Inference bills to the
 *      Copilot seat that owns the token, so there is no separate vendor or API key.
 *   2. LLM_API_KEY (+ optional LLM_BASE_URL, LLM_MODEL) — OpenAI, Groq, OpenRouter, local, etc.
 *   3. OPENAI_API_KEY — api.openai.com
 *
 * GitHub Models (`https://models.github.ai/inference`, reached with the built-in GITHUB_TOKEN and
 * `permissions: models: read`) was the free default until it was
 * [retired on 2026-07-30](https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/).
 * That endpoint now returns HTTP 410, so the branch is gone rather than left to fail every run.
 *
 * Returns null when no provider is configured, so callers fall back to a
 * deterministic template rather than failing the whole workflow.
 *
 * Beyond provider resolution this module owns everything that makes an
 * unattended daily LLM call survivable: an output-token ceiling so a runaway
 * completion can't truncate mid-JSON, retry with backoff so a single 429
 * doesn't cost a day's analysis, schema-validated replies, and usage accounting
 * so cost becomes visible the moment a paid key is configured.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { z } from 'zod';
import { describeIssues, stripNulls, toPromptSchema, toResponseFormat } from './schemas.js';

const execFileAsync = promisify(execFile);

interface Provider {
  name: string;
  /** `http` speaks OpenAI chat/completions; `copilot-cli` shells out to an agent. */
  kind: 'http' | 'copilot-cli';
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Per-task knobs. Analysis wants determinism; prose wants a little warmth. */
export interface ChatOptions {
  /** Sampling temperature. Defaults to 0.2 — these are analytical tasks. */
  temperature?: number;
  /** Hard ceiling on completion length. Defaults to 2000. */
  maxTokens?: number;
  /** Deterministic sampling hint, where the provider honours it. */
  seed?: number;
  /**
   * Task key used to look up a model override, e.g. `LLM_MODEL_MONTHLY_PATTERNS`.
   * Lets month-long pattern detection use a stronger model than the job writing
   * a fifteen-word headline.
   */
  task?: string;
  /** How many times to retry a failed call. Defaults to 2 (3 attempts total). */
  retries?: number;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult<T> {
  data: T;
  usage: LlmUsage | null;
  model: string;
}

/** Env var name for a per-task model override: `monthly-patterns` → `LLM_MODEL_MONTHLY_PATTERNS`. */
function taskModelEnv(task: string): string {
  return `LLM_MODEL_${task.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
}

function resolveProvider(task?: string): Provider | null {
  const override = task ? process.env[taskModelEnv(task)] : undefined;
  const pick = (fallback: string) => override || process.env.LLM_MODEL || fallback;

  if (process.env.LLM_PROVIDER === 'copilot-cli') {
    return {
      name: 'copilot-cli',
      kind: 'copilot-cli',
      baseUrl: '',
      // The CLI reads COPILOT_GITHUB_TOKEN itself; nothing is sent from here.
      apiKey: '',
      model: pick('gpt-5-mini'),
    };
  }
  if (process.env.LLM_API_KEY) {
    return {
      name: 'custom',
      kind: 'http',
      baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.LLM_API_KEY,
      model: pick('gpt-4o-mini'),
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      kind: 'http',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      model: pick('gpt-4o-mini'),
    };
  }
  return null;
}

export function llmAvailable(): boolean {
  return resolveProvider() !== null;
}

/** Short tag persisted into the JSON `model` field so the UI shows provenance. */
export function providerLabel(task?: string): string {
  const p = resolveProvider(task);
  if (!p) return 'template';
  return p.kind === 'copilot-cli' ? `llm:copilot/${p.model}` : `llm:${p.model}`;
}

/** Retryable: transient transport + server-side conditions. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* Copilot CLI provider                                                       */
/* -------------------------------------------------------------------------- */

/** An agent round-trip is ~30-70s on this payload, against ~2s for a raw completion. */
const COPILOT_TIMEOUT_MS = Number(process.env.COPILOT_TIMEOUT_MS) || 180_000;

/**
 * Environment the CLI subprocess is allowed to see.
 *
 * The CLI is an agent with real shell and file tools, not a completions endpoint. `--deny-tool`
 * below is the primary control and it was verified to work — but this list is the one that does
 * not depend on the CLI's permission model at all, so it holds even if a flag is renamed or a
 * future version changes precedence.
 *
 * It matters here because the generate job runs with `contents: write` and pushes to main, and
 * COPILOT_GITHUB_TOKEN is that same Actions token. Anything reachable from the child could act
 * with those rights. Note the reusable workflow already declines `secrets: inherit`, so the
 * vendor OAuth material and GH_PAT are not in the parent process either.
 */
const COPILOT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'COPILOT_GITHUB_TOKEN',
];

function copilotEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null);
  for (const key of COPILOT_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/**
 * The CLI has no `response_format`, so the object is sliced out defensively: the agent
 * occasionally narrates ("Running…") before emitting it, and sometimes fences it.
 */
function extractJson(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    // Length only, never content: this becomes `fallbackReason`, which is committed to main and
    // rendered in the browser, and the reply is built from the athlete's health data.
    throw new Error(`Copilot CLI returned no JSON object (${trimmed.length} chars)`);
  }
  return trimmed.slice(start, end + 1);
}

async function runCopilot(p: Provider, prompt: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'copilot',
      [
        '-p', prompt,
        '--model', p.model,
        '--no-ask-user', // never block waiting for input in CI
        '--disable-builtin-mcps', // no github-mcp-server, so no GitHub API tools
        '--deny-tool', 'shell', // takes precedence over any allow; verified to block execution
        '--deny-tool', 'write', // the reply is read from stdout, so nothing needs writing
        '-s', // stdout is only the agent response
      ],
      {
        encoding: 'utf8',
        timeout: COPILOT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: copilotEnv(),
      },
    );
    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    if (err.code === 'ENOENT') {
      throw new Error('copilot CLI not found on PATH — run `npm install -g @github/copilot`');
    }
    if (err.killed) throw new Error(`copilot CLI timed out after ${COPILOT_TIMEOUT_MS}ms`);
    // stderr can echo the prompt, which carries health data. Report the shape, not the text.
    throw new Error(`copilot CLI failed (exit ${err.code ?? 'unknown'})`);
  }
}

/**
 * `chatSchema` for the CLI. No decoder-level schema exists here, so the contract is stated in the
 * prompt using the FULL schema (see `toPromptSchema`) and enforced by zod on the way out.
 *
 * Retries only on a parse or schema failure, and only once: each attempt costs an AI credit and
 * ~40s, so repeating a call that produced an unusable reply is worth it while repeating one that
 * failed to launch is not.
 */
async function copilotChatSchema<T>(
  p: Provider,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  retries: number,
): Promise<ChatResult<T>> {
  const base = [
    system,
    '',
    user,
    '',
    'The JSON object must match this JSON Schema EXACTLY, including every maxItems, minItems, ' +
      `maxLength and enum constraint:\n${JSON.stringify(toPromptSchema(schema))}`,
    '',
    // maxLength is the constraint this path misses most. Without a decoder there is nothing but
    // the model's own restraint holding a 500-character field to 500 characters, and the weekly
    // review has three of them.
    'Length limits matter most: for every string field with a maxLength, stay under it. If an ' +
      'analysis does not fit, tighten the prose — never drop a field or truncate mid-sentence.',
    '',
    'Respond with ONLY the raw JSON object. No markdown fences, no commentary.',
  ].join('\n');

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Feed the previous rejection back instead of resending the request verbatim. A retry with
    // an identical prompt is only a resample, which is close to useless for a deterministic
    // violation like length: the first live failure of this path retried an over-long
    // `fitnessNarrative` and came back with that field over AND `nextWeekFocus` over as well.
    const prompt = lastError
      ? `${base}\n\nYour previous reply was rejected: ${lastError.message}\n` +
        'Return the corrected JSON object, fixing exactly that and changing nothing else.'
      : base;

    const stdout = await runCopilot(p, prompt);

    let raw: unknown;
    try {
      raw = JSON.parse(extractJson(stdout));
    } catch {
      // Shape, never content. `extractJson` already reports a length only, but a raw
      // `JSON.parse` message can carry a fragment of the reply — and the reply is built from the
      // athlete's health data, while this string becomes `fallbackReason`, which is committed to
      // main and rendered into a title attribute in the browser.
      lastError = new Error(`Copilot CLI reply was not valid JSON (${stdout.length} chars)`);
      if (attempt < retries) {
        console.warn(`[llm] ${lastError.message} — retry ${attempt + 1}/${retries}`);
      }
      continue;
    }

    const parsed = schema.safeParse(stripNulls(raw));
    if (parsed.success) {
      // The CLI reports no token usage, so cost stays invisible here by design.
      return { data: parsed.data, usage: null, model: p.model };
    }

    lastError = new Error(`schema rejected reply — ${describeIssues(parsed.error)}`);
    if (attempt < retries) {
      console.warn(`[llm] ${lastError.message} — retry ${attempt + 1}/${retries}`);
    }
  }
  throw lastError ?? new Error('copilot CLI returned no parseable JSON');
}

/**
 * Call chat/completions and validate the reply against `schema`.
 *
 * Throws on any unrecoverable failure so the caller can fall back to its
 * deterministic template. A schema failure counts as a failure: silently
 * writing a malformed artifact is exactly what this module exists to prevent.
 */
export async function chatSchema<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  schemaName: string,
  opts: ChatOptions = {},
): Promise<ChatResult<T>> {
  const p = resolveProvider(opts.task);
  if (!p) throw new Error('no LLM provider configured');

  const retries = opts.retries ?? 2;

  if (p.kind === 'copilot-cli') {
    // The CLI carries the whole prompt as one argv entry and has no documented input ceiling
    // distinct from the model's, so the 8000-token free-tier warning below does not apply.
    //
    // Retries get the full budget here rather than being capped at one. The cap made sense while
    // a retry was a blind resample worth little; now that the rejection is fed back, each attempt
    // is a targeted correction and is worth the credit and the ~40s.
    return copilotChatSchema(p, system, user, schema, retries);
  }

  const approxTokens = Math.ceil((system.length + user.length) / 4);
  if (approxTokens > 7000) {
    console.warn(
      `[llm] prompt is ~${approxTokens} tokens, close to the 8000-token input limit on the free tier`,
    );
  }

  // Providers that don't implement `json_schema` reject the request outright,
  // so a rejection drops us back to plain JSON mode rather than failing the run.
  let useStrictSchema = true;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 250);

    try {
      const body: Record<string, unknown> = {
        model: p.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 2000,
        response_format: useStrictSchema
          ? toResponseFormat(schemaName, schema)
          : { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (opts.seed != null) body.seed = opts.seed;

      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify(body),
        // Same rule the Whoop and Strava clients follow (SECURITY.md → API
        // clients): a hostile redirect must not be able to replay the
        // Authorization header to another host. Matters more here than there,
        // because LLM_BASE_URL is configurable and may point at a self-hosted
        // gateway.
        redirect: 'error',
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        // The body is read to classify the failure, and is deliberately never
        // put into the Error. This message becomes `fallbackReason`, which is
        // written into private/data/*.json, committed to a private repo by the workflow,
        // and rendered into a title attribute in the browser. A provider's 401
        // body routinely echoes the submitted key — OpenAI returns "Incorrect
        // API key provided: sk-…", and self-hosted gateways reachable via
        // LLM_BASE_URL often echo it in full. SECURITY.md already requires the
        // vendor clients to report status only; this holds the same line.
        const text = await res.text().catch(() => '');
        // A 400 naming response_format means the provider can't do strict
        // schemas — switch modes and retry immediately rather than burning the
        // run on a capability mismatch.
        if (res.status === 400 && useStrictSchema && /response_format|json_schema/i.test(text)) {
          console.warn('[llm] provider rejected json_schema — retrying with json_object');
          useStrictSchema = false;
          continue;
        }
        // 413 means the prompt exceeded the provider's input limit. The body is
        // deliberately not echoed (SECURITY.md), so without the size here the
        // failure is opaque — which is exactly how it presented the first time.
        // Sizes are our own request metrics, not provider output.
        const detail =
          res.status === 413
            ? ` — prompt was ~${Math.ceil((system.length + user.length) / 4)} tokens (${system.length + user.length} chars); reduce PROMPT_TOKEN_BUDGET`
            : '';
        const err = new Error(`LLM ${p.name} returned HTTP ${res.status}${detail}`);
        if (attempt < retries && isRetryable(res.status)) {
          lastError = err;
          console.warn(`[llm] ${err.message} — retry ${attempt + 1}/${retries}`);
          continue;
        }
        throw err;
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      const content = choice?.message?.content;
      if (!content) throw new Error('LLM returned empty content');
      if (choice.finish_reason === 'length') {
        throw new Error('LLM reply hit the token ceiling and was truncated');
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        // Length only. The completion is model output built from a prompt that
        // contains the athlete's health data, and this string is published.
        throw new Error(`LLM returned non-JSON (${content.length} chars)`);
      }

      const parsed = schema.safeParse(stripNulls(raw));
      if (!parsed.success) {
        const err = new Error(`schema rejected reply — ${describeIssues(parsed.error)}`);
        if (attempt < retries) {
          lastError = err;
          console.warn(`[llm] ${err.message} — retry ${attempt + 1}/${retries}`);
          continue;
        }
        throw err;
      }

      const usage = json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : null;
      if (usage) {
        console.log(
          `[llm] ${p.model} · ${usage.promptTokens} in / ${usage.completionTokens} out tokens`,
        );
      }

      return { data: parsed.data, usage, model: p.model };
    } catch (e) {
      const err = e as Error;
      // AbortSignal.timeout surfaces as TimeoutError — worth one more attempt.
      if (attempt < retries && /timeout|fetch failed|network|aborted/i.test(err.message)) {
        lastError = err;
        console.warn(`[llm] ${err.message} — retry ${attempt + 1}/${retries}`);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('LLM call failed after retries');
}
