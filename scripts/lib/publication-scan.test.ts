import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest, loadPrivateReferences, scanPublicFiles, type PrivateReferences } from './publication-scan';
import { ANOMALY_IDS } from '../../src/lib/types';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const empty: PrivateReferences = { tokens: new Map(), phrases: new Set() };
const file = 'src/example.ts';
const files = (text: string) => new Map([[file, Buffer.from(text)]]);

describe('publication content checks', () => {
  it('blocks a provider-shaped token without including it in diagnostic values', () => {
    const credential = ['gh', 'p_', 'X'.repeat(36)].join('');
    const findings = scanPublicFiles(files(credential), empty, []);
    expect(findings[0]).toMatchObject({ file, line: 1, rule: 'provider-token' });
    expect(JSON.stringify(findings)).not.toContain(credential);
  });

  it('limits synthetic exceptions to the exact reviewed file, rule and match digest', () => {
    const credential = ['gh', 'p_', 'Y'.repeat(36)].join('');
    const exception = { file, rule: 'provider-token', sha256: digest(credential), reason: 'Synthetic token regression fixture' };
    expect(scanPublicFiles(files(credential), empty, [exception])).toEqual([]);
    expect(scanPublicFiles(files(credential + 'z'), empty, [exception])).not.toEqual([]);
    expect(scanPublicFiles(new Map([['src/other.ts', Buffer.from(credential)]]), empty, [exception])).not.toEqual([]);
    const references = { ...empty, phrases: new Set([credential.toLowerCase()]) };
    expect(scanPublicFiles(files(credential), references, [exception])[0]?.rule).toBe('private-text-or-credential');
  });

  it('recognizes private activity IDs with numeric separators and precise health observations', () => {
    const references: PrivateReferences = {
      tokens: new Map([['987654321', 'private-identifier'], ['62.12345', 'private-health-measurement']]),
      phrases: new Set(),
    };
    const findings = scanPublicFiles(files('987_654_321\n62.12345'), references, []);
    expect(findings.map(({ line, rule }) => ({ line, rule }))).toEqual([
      { line: 1, rule: 'private-identifier' }, { line: 2, rule: 'private-health-measurement' },
    ]);
  });

  it('normalizes timestamps and blocks profile fragments supplied in a private blocklist', () => {
    const references: PrivateReferences = {
      tokens: new Map([['2021-03-04T12:34:56.000Z', 'private-activity-time']]),
      phrases: new Set(['synthetic private identity']),
    };
    const findings = scanPublicFiles(files('2021-03-04T12:34:56Z\nSynthetic Private Identity'), references, []);
    expect(findings.map(({ rule }) => rule)).toEqual(['private-activity-time', 'private-text-or-credential']);
  });

  it('reads only local private references and credential files', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-references-'));
    temporary.push(root);
    mkdirSync(join(root, 'private'));
    writeFileSync(join(root, 'private/records.json'), JSON.stringify({
      id: 987654321, hrv_rmssd_milli: 62.12345, start: '2021-03-04T12:34:56Z',
      profile: { location: 'A fictional private location' },
    }));
    writeFileSync(join(root, 'private/publication-blocklist.json'), JSON.stringify(['Synthetic identity']));
    const credential = ['private', 'test', 'credential'].join('-');
    writeFileSync(join(root, '.env.local'), `EXAMPLE_TOKEN=${credential}\n`);
    const references = loadPrivateReferences(root);
    expect(references.tokens.get('987654321')).toBe('private-identifier');
    expect(references.tokens.get('62.12345')).toBe('private-health-measurement');
    expect(references.tokens.get('2021-03-04T12:34:56.000Z')).toBe('private-activity-time');
    expect(references.phrases.has('synthetic identity')).toBe(true);
    expect(references.phrases.has(credential)).toBe(true);
  });

  it('distinguishes derived anomaly labels from private identifiers without skipping their records', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-anomalies-'));
    temporary.push(root);
    mkdirSync(join(root, 'private/data'), { recursive: true });
    writeFileSync(join(root, 'private/data/snapshot.json'), JSON.stringify({
      daily: { anomalies: [
        ...ANOMALY_IDS.map((id) => ({ id })),
        { id: 'unknown-private-id', account_id: 'synthetic-account-id',
          start: '2021-03-04T12:34:56Z', notes: 'A fictional private anomaly note' },
      ] },
    }));
    const references = loadPrivateReferences(root);
    for (const id of ANOMALY_IDS) expect(references.tokens.has(id)).toBe(false);
    expect(references.tokens.get('unknown-private-id')).toBe('private-identifier');
    expect(references.tokens.get('synthetic-account-id')).toBe('private-identifier');
    expect(references.tokens.get('2021-03-04T12:34:56.000Z')).toBe('private-activity-time');
    expect(references.phrases.has('a fictional private anomaly note')).toBe(true);

    writeFileSync(join(root, 'private/data/records.json'), JSON.stringify({
      daily: { anomalies: ANOMALY_IDS.map((id) => ({ id })) },
    }));
    const rawReferences = loadPrivateReferences(root);
    for (const id of ANOMALY_IDS) expect(rawReferences.tokens.get(id)).toBe('private-identifier');
    writeFileSync(join(root, 'private/publication-blocklist.json'), JSON.stringify([ANOMALY_IDS[0]]));
    expect(scanPublicFiles(files(ANOMALY_IDS[0]), loadPrivateReferences(root), []))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'private-text-or-credential' })]));
  });

  it('matches credentials from every root environment variant except the public example', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-environments-'));
    temporary.push(root);
    for (const name of ['.env', '.env.local', '.env.production', '.env.staging', '.env.test.local']) {
      const credential = ['synthetic', name, 'credential'].join('-');
      writeFileSync(join(root, name), `EXAMPLE_TOKEN=${credential}\n`);
    }
    const exampleValue = ['public', 'example', 'not-reference'].join('-');
    writeFileSync(join(root, '.env.example'), `EXAMPLE_TOKEN=${exampleValue}\n`);
    const references = loadPrivateReferences(root);
    for (const name of ['.env', '.env.local', '.env.production', '.env.staging', '.env.test.local']) {
      const credential = ['synthetic', name, 'credential'].join('-');
      const findings = scanPublicFiles(files(credential), references, []);
      expect(findings[0]).toMatchObject({ file, rule: 'private-text-or-credential' });
      expect(JSON.stringify(findings)).not.toContain(credential);
    }
    expect(references.phrases.has(exampleValue)).toBe(false);
  });

  it.each(['symlink', 'hardlink'] as const)('rejects %s environment references', (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'publication-env-links-'));
    temporary.push(root);
    writeFileSync(join(root, 'reference.txt'), 'EXAMPLE_TOKEN=synthetic-value\n');
    const target = join(root, '.env.production');
    if (kind === 'symlink') symlinkSync(join(root, 'reference.txt'), target);
    else linkSync(join(root, 'reference.txt'), target);
    expect(() => loadPrivateReferences(root)).toThrow(/linked/);
  });

  it('rejects non-text content and populated examples without returning their content', () => {
    const inputs = new Map([
      ['src/blob.ts', Buffer.from([0, 255, 1])],
      ['.env.example', Buffer.from('EXAMPLE_TOKEN=synthetic-value\n')],
    ]);
    expect(scanPublicFiles(inputs, empty, []).map(({ rule }) => rule)).toEqual([
      'non-text-file', 'populated-or-invalid-env-example',
    ]);
  });
});
