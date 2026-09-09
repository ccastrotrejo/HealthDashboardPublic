import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'vite';
import example from '../../config/athlete.example.json';
import { athleteConfigSchema } from '../../config/schema';
import { loadAthleteConfig } from './athlete-config';
import { athleteConfigPlugin, readDashboardArtifact } from './dashboard-assets';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'health-config-'));
  temporary.push(root);
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'private/data'), { recursive: true });
  writeFileSync(join(root, 'config/athlete.example.json'), JSON.stringify(example));
  return root;
}

describe('athlete configuration', () => {
  it('loads the fictional example only when private settings are absent', () => {
    const root = workspace();
    expect(loadAthleteConfig(root)).toEqual(example);
    const custom = { ...example, timezone: 'Europe/London' };
    writeFileSync(join(root, 'private/athlete.json'), JSON.stringify(custom));
    expect(loadAthleteConfig(root)).toEqual(custom);
    expect(loadAthleteConfig(root, true)).toEqual(example);
  });

  it.each(['{bad-json', JSON.stringify({ ...example, apiKey: 'DO-NOT-LOG' })])(
    'rejects invalid private settings rather than silently replacing them', (contents) => {
      const root = workspace();
      writeFileSync(join(root, 'private/athlete.json'), contents);
      expect(() => loadAthleteConfig(root)).toThrow(/configuration/);
      expect(() => loadAthleteConfig(root)).not.toThrow(/DO-NOT-LOG/);
    },
  );

  it('rejects unknown timezones, duplicate weekdays and overlapping phases', () => {
    expect(athleteConfigSchema.safeParse({ ...example, timezone: 'Invalid/Timezone' }).success).toBe(false);
    expect(athleteConfigSchema.safeParse({
      ...example, weeklySchedule: Array(7).fill(example.weeklySchedule[0]),
    }).success).toBe(false);
    expect(athleteConfigSchema.safeParse({ ...example, phases: [...example.phases, example.phases[0]] }).success).toBe(false);
  });

  it.each(['duplicate', 'out-of-range'] as const)('rejects %s weeks inside one otherwise covering phase', (kind) => {
    const phases = structuredClone(example.phases);
    phases[0]!.weeks.push(kind === 'duplicate' ? phases[0]!.weeks[0]! : example.PROGRAM_LENGTH_WEEKS + 1);
    const result = athleteConfigSchema.safeParse({ ...example, phases });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected invalid phase weeks');
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['phases', 0, 'weeks'], message: 'Phase weeks must be unique and inside the program' }),
    ]));
  });
});

describe('browser artifact boundary', () => {
  it('compiles the program with configuration data, not the Node filesystem loader', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [athleteConfigPlugin(true)],
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('../../src/lib/program.ts', import.meta.url)),
          formats: ['es'],
          fileName: 'program',
        },
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles.flatMap((bundle) => {
      if (!('output' in bundle)) throw new Error('Expected a browser bundle, not a watcher');
      return bundle.output.map((file) => file.type === 'chunk' ? file.code : '');
    }).join('\n');
    expect(code).toContain('Example location');
    expect(code).not.toMatch(/readFileSync|node:fs|loadAthleteConfig/);
  });

  it('exposes only named dashboard files, not raw records or configuration', () => {
    const root = workspace();
    writeFileSync(join(root, 'private/data/snapshot.json'), '{"pipelineVersion":"synthetic"}');
    writeFileSync(join(root, 'private/data/whoop-recoveries.json'), 'DO-NOT-SERVE');
    expect(readDashboardArtifact('snapshot.json', root)).toContain('synthetic');
    for (const path of ['whoop-recoveries.json', '../athlete.json', 'ai-history.jsonl', '../../.env.local']) {
      expect(readDashboardArtifact(path, root)).toBeNull();
    }
    expect(readDashboardArtifact('coach.json', root)).toBeNull();
  });

  it.each(['symlink', 'hardlink'] as const)('rejects an allowlisted artifact that is a %s', (kind) => {
    const root = workspace();
    const sensitive = join(root, '.env.local');
    writeFileSync(sensitive, 'DO-NOT-SERVE');
    const artifact = join(root, 'private/data/snapshot.json');
    if (kind === 'symlink') symlinkSync(sensitive, artifact);
    else linkSync(sensitive, artifact);
    expect(() => readDashboardArtifact('snapshot.json', root)).toThrow(/linked/);
  });

  it('rejects linked ancestor directories instead of serving their artifacts', () => {
    const root = workspace();
    rmSync(join(root, 'private/data'), { recursive: true });
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere/snapshot.json'), 'DO-NOT-SERVE');
    symlinkSync(join(root, 'elsewhere'), join(root, 'private/data'));
    expect(() => readDashboardArtifact('snapshot.json', root)).toThrow('linked source');
  });

  it('rejects directories at artifact paths without treating them as missing data', () => {
    const root = workspace();
    mkdirSync(join(root, 'private/data/snapshot.json'));
    expect(() => readDashboardArtifact('snapshot.json', root)).toThrow('non-regular file');
  });
});
