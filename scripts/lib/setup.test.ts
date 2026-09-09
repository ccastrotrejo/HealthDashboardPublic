import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupLocal } from './setup.js';

let root: string;
const example = '{"timezone":"UTC","synthetic":true}\n';

beforeEach(() => {
  mkdirSync('private', { recursive: true });
  root = mkdtempSync(resolve('private/setup-test-'));
  mkdirSync(resolve(root, 'config'));
  writeFileSync(resolve(root, '.env.example'), '# example\nWHOOP_CLIENT_ID=\n');
  writeFileSync(resolve(root, 'config/athlete.example.json'), example);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('local setup', () => {
  it('creates private configuration, an empty race calendar, and an honestly unsynced snapshot', () => {
    expect(setupLocal(root)).toEqual([
      '.env.local', 'private/athlete.json', 'private/data/races.json', 'private/data/snapshot.json',
    ]);
    expect(readFileSync(resolve(root, '.env.local'), 'utf8')).toBe('# example\nWHOOP_CLIENT_ID=\n');
    expect(readFileSync(resolve(root, 'private/athlete.json'), 'utf8')).toBe(example);
    expect(JSON.parse(readFileSync(resolve(root, 'private/data/races.json'), 'utf8'))).toEqual({ races: [] });
    expect(JSON.parse(readFileSync(resolve(root, 'private/data/snapshot.json'), 'utf8'))).toEqual({
      syncedAt: '1970-01-01T00:00:00.000Z',
      pipelineVersion: 'not-synced',
      counts: { recoveries: 0, sleeps: 0, workouts: 0, cycles: 0, activities: 0, garminDays: 0 },
      daily: null,
      weekly: null,
      longTerm: null,
      cycling: null,
      garmin: null,
      sources: {},
    });
    for (const file of ['.env.local', 'private/athlete.json', 'private/data/races.json', 'private/data/snapshot.json']) {
      expect(statSync(resolve(root, file)).mode & 0o777).toBe(0o600);
    }
  });

  it('never overwrites existing credentials, preferences, race history, or synced data', () => {
    setupLocal(root);
    const files = ['.env.local', 'private/athlete.json', 'private/data/races.json', 'private/data/snapshot.json'];
    for (const file of files) writeFileSync(resolve(root, file), 'preserve existing input verbatim');
    expect(setupLocal(root)).toEqual([]);
    for (const file of files) {
      expect(readFileSync(resolve(root, file), 'utf8')).toBe('preserve existing input verbatim');
    }
  });

  it('fills only missing files after a partially completed setup', () => {
    writeFileSync(resolve(root, '.env.local'), 'WHOOP_CLIENT_SECRET=synthetic\n');
    expect(setupLocal(root)).toEqual(['private/athlete.json', 'private/data/races.json', 'private/data/snapshot.json']);
    expect(readFileSync(resolve(root, '.env.local'), 'utf8')).toBe('WHOOP_CLIENT_SECRET=synthetic\n');
  });
});
