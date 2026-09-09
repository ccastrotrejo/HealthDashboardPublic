import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from './types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EMPTY_SNAPSHOT: Snapshot = {
  // Setup has never completed a provider sync; do not imply fresh health data.
  syncedAt: '1970-01-01T00:00:00.000Z',
  pipelineVersion: 'not-synced',
  counts: { recoveries: 0, sleeps: 0, workouts: 0, cycles: 0, activities: 0, garminDays: 0 },
  daily: null,
  weekly: null,
  longTerm: null,
  cycling: null,
  garmin: null,
  sources: {},
};

function createIfMissing(path: string, content: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Bootstrap local configuration and private inputs without overwriting existing data. */
export function setupLocal(root = ROOT): string[] {
  const env = readFileSync(resolve(root, '.env.example'), 'utf8');
  const athlete = readFileSync(resolve(root, 'config/athlete.example.json'), 'utf8');
  mkdirSync(resolve(root, 'private/data'), { recursive: true, mode: 0o700 });
  const created: string[] = [];
  for (const [name, content] of [
    ['.env.local', env],
    ['private/athlete.json', athlete],
    ['private/data/races.json', '{\n  "races": []\n}\n'],
    ['private/data/snapshot.json', JSON.stringify(EMPTY_SNAPSHOT, null, 2) + '\n'],
  ] as const) {
    if (createIfMissing(resolve(root, name), content)) created.push(name);
  }
  return created;
}
