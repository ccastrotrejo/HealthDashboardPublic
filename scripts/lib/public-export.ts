import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { readRegularFile } from './files.js';
import { loadPrivateReferences, loadScanExceptions, scanPublicFiles } from './publication-scan.js';

const ROOT_FILES = new Set([
  '.env.example', '.gitignore', 'README.md', 'SECURITY.md', 'COACH.md', 'PUBLIC_TEMPLATE.md',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'index.html', 'middleware.ts',
  'middleware.test.ts', 'postcss.config.js', 'tsconfig.json', 'tsconfig.node.json',
  'vite.config.ts', 'vitest.config.ts', 'vercel.json',
  'config/athlete.example.json', 'config/schema.ts', '.github/dependabot.yml',
  'scripts/tsconfig.json',
  'config/public-files.json', 'config/public-scan-allowlist.json',
]);

/** Deliberately excludes all data, local configuration, design notes and Git metadata. */
export function isPublicSource(path: string): boolean {
  if (path.includes('\\') || path.split('/').some((part) => part === '..' || part.startsWith('.'))) {
    return ROOT_FILES.has(path) || /^\.github\/workflows\/[\w-]+\.yml$/.test(path);
  }
  return ROOT_FILES.has(path) ||
    /^(src|scripts|utils)\/[\w/.-]+\.(ts|tsx|css|js)$/.test(path);
}

export function readPublicManifest(root: string): string[] {
  return parsePublicManifest(readRegularFile(root, 'config/public-files.json').toString('utf8'));
}

/** Validate both local and previously published ownership manifests. */
export function parsePublicManifest(content: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Invalid public file manifest JSON');
  }
  if (!Array.isArray(manifest) || manifest.some((path) => typeof path !== 'string' || !isPublicSource(path)) ||
      new Set(manifest).size !== manifest.length ||
      !['package.json', 'config/athlete.example.json', 'config/public-files.json', 'config/public-scan-allowlist.json'].every((path) => manifest.includes(path))) {
    throw new Error('Invalid public file manifest');
  }
  return manifest;
}

function sourceFiles(root: string): Map<string, Buffer> {
  const manifest = readPublicManifest(root);
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter((path) => path && isPublicSource(path));
  for (const path of files) {
    if (!manifest.includes(path) && existsSync(resolve(root, path))) {
      throw new Error(`Unreviewed source file; update the manifest only after review: ${path}`);
    }
  }
  return new Map(manifest.map((path) => [path, readRegularFile(root, path)]));
}

function assertPublishable(root: string, files: Map<string, Buffer>): void {
  const findings = scanPublicFiles(files, loadPrivateReferences(root), loadScanExceptions(root));
  if (findings.length) {
    throw new Error('Publication blocked:\n' + findings.map(({ file, line, rule }) => `${file}:${line} [${rule}]`).join('\n'));
  }
}

/** Copy only reviewed, scanned bytes. Validation completes before creating the output. */
export function exportPublicTemplate(root: string, destination: string): number {
  root = realpathSync(root);
  destination = resolve(destination);
  if (existsSync(destination)) throw new Error('Export destination must not already exist');
  const parent = realpathSync(dirname(destination));
  destination = resolve(parent, relative(dirname(destination), destination));
  if (destination === root || root.startsWith(destination + '/')) {
    throw new Error('Export destination must not contain the source repository');
  }
  const files = sourceFiles(root);
  assertPublishable(root, files);
  mkdirSync(destination);
  for (const [path, bytes] of files) {
    const target = resolve(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  return files.size;
}

/** Read an isolated source-only artifact without a Git checkout or private reference files. */
export function readPublicSnapshot(destination: string): Map<string, Buffer> {
  destination = realpathSync(destination);
  const expected = new Set(readPublicManifest(destination));
  const actual = new Map<string, Buffer>();
  function visit(directory: string): void {
    for (const entry of readdirSync(resolve(destination, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Publication refuses linked file: ${path}`);
      if (entry.isDirectory()) {
        if (![...expected].some((file) => file.startsWith(path + '/'))) {
          throw new Error(`Unexpected export directory: ${path}`);
        }
        visit(path);
      } else {
        const bytes = readRegularFile(destination, path);
        if (!expected.has(path)) throw new Error(`Unexpected export file: ${path}`);
        actual.set(path, bytes);
      }
    }
  }
  visit('');
  if (actual.size !== expected.size) throw new Error('Export is missing approved source files');
  assertPublishable(destination, actual);
  return actual;
}

/** Audit the actual export against the private source and its local reference data. */
export function auditPublicTemplate(root: string, destination: string): number {
  root = realpathSync(root);
  const expected = sourceFiles(root);
  const actual = readPublicSnapshot(destination);
  if (actual.size !== expected.size) throw new Error('Export manifest differs from current source');
  for (const [path, bytes] of actual) {
    if (!expected.get(path)?.equals(bytes)) throw new Error(`Unexpected or changed export file: ${path}`);
  }
  assertPublishable(root, actual);
  return actual.size;
}
