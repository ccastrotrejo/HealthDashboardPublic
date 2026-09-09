import { randomUUID } from 'node:crypto';
import {
  fchmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
  fsyncSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

interface Assignment {
  name: string;
  start: number;
  end: number;
}

/** Validate before editing: Node's permissive env parser otherwise drops malformed lines. */
function assignments(content: string): Assignment[] {
  if (content.includes('\0')) throw new Error('Invalid NUL character in .env.local');
  const result: Assignment[] = [];
  const names = new Set<string>();
  let offset = 0;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const start = offset;
    offset += rawLine.length + 1;
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/.exec(line);
    if (!match || names.has(match[1]!)) {
      throw new Error(`Invalid or duplicate .env.local assignment at line ${i + 1}`);
    }
    const name = match[1]!;
    const value = match[2]!;
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let remaining = value.slice(1);
      while (!remaining.includes(quote)) {
        if (++i >= lines.length) throw new Error('Unterminated quoted value in .env.local');
        remaining = lines[i]!;
        offset += remaining.length + 1;
      }
      const suffix = remaining.slice(remaining.indexOf(quote) + 1);
      if (!/^[ \t\r]*(?:#.*)?$/.test(suffix)) {
        throw new Error(`Invalid quoted value in .env.local at line ${i + 1}`);
      }
    }
    names.add(name);
    result.push({ name, start, end: Math.min(offset, content.length) });
  }
  return result;
}

function serialize(name: string, value: string): string {
  if (!ENV_KEY.test(name)) throw new Error('Invalid environment variable name');
  if (/[\r\n\0]/.test(value)) throw new Error('Credential must be a single-line value');
  const candidates = [
    ...(!value.includes("'") ? [`'${value}'`] : []),
    ...(!value.includes('"') ? [`"${value}"`] : []),
    ...(!/^['"`]/.test(value) ? [value] : []),
  ];
  for (const candidate of candidates) {
    const line = `${name}=${candidate}`;
    if (parseEnv(line)[name] === value) {
      assignments(line);
      return line;
    }
  }
  throw new Error('Credential cannot be represented safely in .env.local');
}

function openLocalEnv(root: string): number {
  const path = resolve(root, '.env.local');
  try {
    return openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  }
}

function readLocalEnv(fd: number): string {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('.env.local must be a regular file without hard links');
  const content = readFileSync(fd, 'utf8');
  assignments(content);
  return content;
}

/** Fail before OAuth refresh invalidates the stored token if its destination is unsafe. */
export function assertLocalEnvWritable(root = ROOT): void {
  const fd = openLocalEnv(root);
  try {
    readLocalEnv(fd);
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
}

/** Persist a credential without printing it or touching unrelated environment values. */
export function updateEnvLocal(name: string, value: string, root = ROOT): void {
  const line = serialize(name, value);
  const fd = openLocalEnv(root);
  let temporaryFd: number | undefined;
  let temporaryPath: string | undefined;
  const errors: unknown[] = [];
  try {
    const content = readLocalEnv(fd);
    const assignment = assignments(content).find((item) => item.name === name);
    const next = assignment
      ? content.slice(0, assignment.start) + line + '\n' + content.slice(assignment.end)
      : content + (content && !content.endsWith('\n') ? '\n' : '') + line + '\n';
    fchmodSync(fd, 0o600);
    const original = fstatSync(fd);
    const bytes = Buffer.from(next, 'utf8');
    const path = resolve(root, '.env.local');
    const candidate = resolve(root, `.env.local.${randomUUID()}.tmp`);
    temporaryFd = openSync(
      candidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    temporaryPath = candidate;
    fchmodSync(temporaryFd, 0o600);
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(temporaryFd, bytes, written, bytes.length - written, written);
      if (count === 0) throw new Error('No progress writing .env.local');
      written += count;
    }
    fsyncSync(temporaryFd);
    const completedFd = temporaryFd;
    temporaryFd = undefined;
    closeSync(completedFd);

    // Detect replacement or edits before rename; Node has no conditional atomic rename.
    const current = lstatSync(path);
    if (!current.isFile() || current.nlink !== 1
      || current.dev !== original.dev || current.ino !== original.ino
      || current.size !== original.size || current.mtimeMs !== original.mtimeMs
      || current.ctimeMs !== original.ctimeMs) {
      throw new Error('.env.local changed during credential persistence');
    }
    renameSync(temporaryPath, path);
    temporaryPath = undefined;
  } catch (error) {
    errors.push(error);
  } finally {
    for (const descriptor of [temporaryFd, fd]) {
      if (descriptor === undefined) continue;
      try {
        closeSync(descriptor);
      } catch (error) {
        errors.push(error);
      }
    }
    if (temporaryPath !== undefined) {
      try {
        unlinkSync(temporaryPath);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Failed to persist .env.local and clean up resources');
}
