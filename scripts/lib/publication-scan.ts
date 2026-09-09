import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { readRegularFile } from './files.js';
import { ANOMALY_IDS } from '../../src/lib/types.js';

export interface PublicationFinding {
  file: string;
  line: number;
  rule: string;
  fingerprint?: string;
}

export interface ScanException {
  file: string;
  rule: string;
  sha256: string;
  reason: string;
}

export interface PrivateReferences {
  tokens: Map<string, string>;
  phrases: Set<string>;
}

const SECRET_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['private-key', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g],
  ['provider-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g],
  ['url-credentials', /https?:\/\/[^/\s'":]+:[^/\s'"@]+@[^/\s'"]+/g],
  ['credential-literal', /(?<![\w-])(?:password|passwd|token|secret|access_?token|refresh_?token|api_?key|client_?secret|gh_pat|dashboard_pass)\s*['"]?\s*[:=]\s*['"][^'"\r\n]{8,}['"]/gi],
  ['home-path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\/[^\s'"`]+/g],
];

export function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Invalid publication configuration or private reference JSON');
  }
}

/** Exceptions apply only to individually reviewed synthetic pattern matches, never private references. */
export function loadScanExceptions(root: string): ScanException[] {
  const value = readJson(join(root, 'config/public-scan-allowlist.json'));
  if (!Array.isArray(value)) throw new Error('Invalid publication scan allowlist');
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' ||
        !('file' in entry) || typeof entry.file !== 'string' || !entry.file.endsWith('.test.ts') ||
        !('rule' in entry) || typeof entry.rule !== 'string' ||
        !SECRET_PATTERNS.some(([rule]) => rule === entry.rule) ||
        !('sha256' in entry) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !('reason' in entry) || typeof entry.reason !== 'string' || entry.reason.length < 12) {
      throw new Error('Invalid publication scan exception');
    }
    return { file: entry.file, rule: entry.rule, sha256: entry.sha256, reason: entry.reason };
  });
}

/** Read local reference material only; no private values are returned in diagnostics. */
export function loadPrivateReferences(root: string): PrivateReferences {
  const references: PrivateReferences = { tokens: new Map(), phrases: new Set() };
  function collect(value: unknown, key = '', path = ''): void {
    if (Array.isArray(value)) {
      for (const item of value) collect(item, key, path);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) collect(item, name, `${path}/${name}`);
    } else if (typeof value === 'number') {
      if (/(?:^id$|_id$|Id$)/.test(key) && value >= 1000000) {
        references.tokens.set(String(value), 'private-identifier');
      }
      if (/hrv|heart.?rate|skin.?temp|respirat|spo2|asleep/i.test(key) && /\.\d{4,}/.test(String(value))) {
        references.tokens.set(String(value), 'private-health-measurement');
      }
    } else if (typeof value === 'string') {
      // Only this derived field uses public enum labels, not provider identifiers.
      const isAnomalyLabel = path === 'data/snapshot.json/daily/anomalies/id' &&
        ANOMALY_IDS.some((id) => id === value);
      if (/(?:^id$|_id$|Id$)/.test(key) && value.length >= 8 && !isAnomalyLabel) {
        references.tokens.set(value, 'private-identifier');
      }
      if (/^(?:start|end|start_date|start_date_local)$/.test(key) && /^\d{4}-\d\d-\d\dT/.test(value)) {
        const instant = new Date(value);
        if (Number.isFinite(instant.getTime())) {
          references.tokens.set(instant.toISOString(), 'private-activity-time');
        }
      }
      if (/^(?:name|location|job|email|notes)$/i.test(key) && value.trim().length >= 20) {
        references.phrases.add(value.toLowerCase());
      }
    }
  }
  const privateDir = join(root, 'private');
  if (existsSync(privateDir)) {
    if (!lstatSync(privateDir).isDirectory()) throw new Error('Private reference directory must not be a symlink');
    function visit(directory: string, relativeDirectory = ''): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error('Private reference files must not be symlinks');
        if (entry.isDirectory()) visit(path, relativePath);
        else if (entry.isFile() && entry.name.endsWith('.json')) collect(readJson(path), '', relativePath);
      }
    }
    visit(privateDir);
    const blocklist = join(privateDir, 'publication-blocklist.json');
    if (existsSync(blocklist)) {
      const values = readJson(blocklist);
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.length < 4)) {
        throw new Error('Private publication blocklist must contain strings of at least four characters');
      }
      for (const value of values) references.phrases.add(value.toLowerCase());
    }
  }
  const environmentFiles = readdirSync(root).filter((name) =>
    name === '.env' || (name.startsWith('.env.') && name !== '.env.example'));
  for (const name of environmentFiles) {
    const environment = parseEnv(readRegularFile(root, name).toString('utf8'));
    for (const [key, value] of Object.entries(environment)) {
      if (typeof value === 'string' && value.length >= 8 && /token|secret|password|pass$|api_key|pat$|webhook/i.test(key)) {
        references.phrases.add(value.toLowerCase());
      }
    }
  }
  return references;
}

/** Detect known private references and credential patterns without returning matched values. */
export function scanPublicFiles(
  files: ReadonlyMap<string, Buffer>,
  references: PrivateReferences,
  exceptions: ScanException[],
): PublicationFinding[] {
  const findings: PublicationFinding[] = [];
  for (const [file, bytes] of files) {
    const text = bytes.toString('utf8');
    if (text.includes('\0') || !Buffer.from(text).equals(bytes)) {
      findings.push({ file, line: 1, rule: 'non-text-file' });
      continue;
    }
    const add = (rule: string, offset: number, fingerprint?: string) => {
      const line = text.slice(0, offset).split('\n').length;
      if (!findings.some((entry) => entry.file === file && entry.line === line && entry.rule === rule && entry.fingerprint === fingerprint)) {
        findings.push({ file, line, rule, ...(fingerprint ? { fingerprint } : {}) });
      }
    };
    for (const [rule, pattern] of SECRET_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const allowed = exceptions.some((entry) =>
          entry.file === file && entry.rule === rule && entry.sha256 === digest(match[0]));
        if (!allowed) add(rule, match.index, digest(match[0]));
      }
    }
    if (file === '.env.example') {
      for (const line of text.split('\n').entries()) {
        const [index, value] = line;
        if (/^\s*(?:#|$)/.test(value)) continue;
        if (!/^[A-Z][A-Z0-9_]*=\s*$/.test(value)) {
          findings.push({ file, line: index + 1, rule: 'populated-or-invalid-env-example' });
        }
      }
    }
    for (const match of text.matchAll(/[A-Za-z0-9_-]{8,}|-?\d[\d_]*\.\d{4,}/g)) {
      const rule = references.tokens.get(match[0]) ?? references.tokens.get(match[0].replaceAll('_', ''));
      if (rule) add(rule, match.index);
    }
    for (const match of text.matchAll(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/g)) {
      const date = new Date(match[0]);
      if (Number.isFinite(date.getTime()) && references.tokens.has(date.toISOString())) {
        add('private-activity-time', match.index);
      }
    }
    const lower = text.toLowerCase();
    for (const phrase of references.phrases) {
      const index = lower.indexOf(phrase);
      if (index !== -1) add('private-text-or-credential', index);
    }
  }
  return findings;
}
