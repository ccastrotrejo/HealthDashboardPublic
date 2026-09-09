import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditPublicTemplate, exportPublicTemplate, isPublicSource, readPublicSnapshot } from './public-export';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('public source boundary', () => {
  it.each([
    '.git/config', '.env.local', 'private/athlete.json', 'private/data/snapshot.json',
    'public/data/snapshot.json', 'dist/assets/app.js', 'PRODUCT.md', 'MAINTENANCE.md',
    '.impeccable/design.json', 'scripts/.auth-whoop.tmp', 'scripts/fixture.json',
    'src/../private/data.json', 'src/.private.ts',
  ])('excludes %s', (path) => expect(isPublicSource(path)).toBe(false));

  it.each(['src/App.tsx', 'scripts/auth.ts', 'scripts/tsconfig.json', 'config/athlete.example.json', '.github/workflows/daily-sync.yml'])(
    'includes reusable source %s', (path) => expect(isPublicSource(path)).toBe(true),
  );

  function sourceRepo() {
    const parent = mkdtempSync(join(tmpdir(), 'health-public-export-'));
    temporary.push(parent);
    const root = join(parent, 'source');
    mkdirSync(root);
    execFileSync('git', ['init', '--quiet', root]);
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'private'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'config/athlete.example.json'), '{}');
    writeFileSync(join(root, '.env.example'), 'EXAMPLE_TOKEN=\n');
    writeFileSync(join(root, 'config/public-scan-allowlist.json'), '[]');
    writeFileSync(join(root, 'config/public-files.json'), JSON.stringify([
      '.env.example', 'package.json', 'config/athlete.example.json',
      'config/public-files.json', 'config/public-scan-allowlist.json', 'src/app.ts',
    ]));
    writeFileSync(join(root, 'private/athlete.json'), '{"secret":"DO-NOT-COPY"}');
    writeFileSync(join(root, '.env.local'), 'TOKEN=DO-NOT-COPY');
    writeFileSync(join(root, 'src/app.ts'), 'export const app = true;');
    execFileSync('git', ['add', '.'], { cwd: root });
    return { root, destination: join(parent, 'export') };
  }

  it('exports current source without private files or history, even when tracked', () => {
    const { root, destination } = sourceRepo();
    expect(exportPublicTemplate(root, destination)).toBe(6);
    expect(auditPublicTemplate(root, destination)).toBe(6);
    expect(readFileSync(join(destination, 'src/app.ts'), 'utf8')).toContain('app = true');
    for (const path of ['private', '.env.local', '.git']) expect(existsSync(join(destination, path))).toBe(false);
    expect(() => exportPublicTemplate(root, destination)).toThrow('must not already exist');
  });

  it('refuses symlinks to private files before creating the export', () => {
    const { root, destination } = sourceRepo();
    symlinkSync('../private/athlete.json', join(root, 'src/linked.ts'));
    const manifest: string[] = JSON.parse(readFileSync(join(root, 'config/public-files.json'), 'utf8'));
    writeFileSync(join(root, 'config/public-files.json'), JSON.stringify([...manifest, 'src/linked.ts']));
    expect(() => exportPublicTemplate(root, destination)).toThrow('linked source');
    expect(existsSync(destination)).toBe(false);
  });

  it('blocks unreviewed untracked source instead of exporting it automatically', () => {
    const { root, destination } = sourceRepo();
    writeFileSync(join(root, 'src/notes.ts'), 'export const notes = true;');
    expect(() => exportPublicTemplate(root, destination)).toThrow('Unreviewed source file');
    expect(existsSync(destination)).toBe(false);
  });

  it('reads an isolated publisher artifact without Git and rejects runtime dependencies in it', () => {
    const { root, destination } = sourceRepo();
    exportPublicTemplate(root, destination);
    expect(readPublicSnapshot(destination).size).toBe(6);
    expect(existsSync(join(destination, '.git'))).toBe(false);
    mkdirSync(join(destination, 'node_modules'));
    expect(() => readPublicSnapshot(destination)).toThrow('Unexpected export directory');
  });

  it('rejects hardlinked approved files', () => {
    const { root, destination } = sourceRepo();
    linkSync(join(root, 'src/app.ts'), join(root, 'private/app-copy.ts'));
    expect(() => exportPublicTemplate(root, destination)).toThrow('linked or non-regular file');
    expect(existsSync(destination)).toBe(false);
  });

  it('blocks populated environment examples without logging their values', () => {
    const { root, destination } = sourceRepo();
    writeFileSync(join(root, '.env.example'), 'EXAMPLE_TOKEN=synthetic-private-value\n');
    expect(() => exportPublicTemplate(root, destination)).toThrow('populated-or-invalid-env-example');
    expect(() => exportPublicTemplate(root, destination)).not.toThrow('synthetic-private-value');
    expect(existsSync(destination)).toBe(false);
  });

  it('rejects an extra directory or modified bytes in an existing export', () => {
    const { root, destination } = sourceRepo();
    exportPublicTemplate(root, destination);
    mkdirSync(join(destination, '.git'));
    expect(() => auditPublicTemplate(root, destination)).toThrow('Unexpected export directory');
    rmSync(join(destination, '.git'), { recursive: true });
    writeFileSync(join(destination, 'src/app.ts'), 'Changed after export');
    expect(() => auditPublicTemplate(root, destination)).toThrow('Unexpected or changed export file');
  });
});
