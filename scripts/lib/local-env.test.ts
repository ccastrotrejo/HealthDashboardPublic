import {
  chmodSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalEnvWritable, updateEnvLocal } from './local-env.js';

const io = vi.hoisted(() => ({
  openSync: vi.fn<(path: string, flags: number, mode?: number) => number>(),
  writeSync: vi.fn<(fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => number>(),
  fsyncSync: vi.fn<(fd: number) => void>(),
  closeSync: vi.fn<(fd: number) => void>(),
  renameSync: vi.fn<(from: string, to: string) => void>(),
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  ...io,
}));
const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');

let root: string;
let envPath: string;

beforeEach(() => {
  io.openSync.mockReset().mockImplementation((...args) => realFs.openSync(...args));
  io.writeSync.mockReset().mockImplementation((...args) => realFs.writeSync(...args));
  io.fsyncSync.mockReset().mockImplementation(realFs.fsyncSync);
  io.closeSync.mockReset().mockImplementation(realFs.closeSync);
  io.renameSync.mockReset().mockImplementation(realFs.renameSync);
  mkdirSync('private', { recursive: true });
  root = mkdtempSync(resolve('private/env-test-'));
  envPath = resolve(root, '.env.local');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('local credential persistence', () => {
  it('accepts the shipped setup template and preserves its blank optional configuration', () => {
    writeFileSync(envPath, readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));
    updateEnvLocal('WHOOP_REFRESH_TOKEN', 'synthetic-refresh', root);
    expect(parseEnv(readFileSync(envPath, 'utf8'))).toMatchObject({
      WHOOP_REFRESH_TOKEN: 'synthetic-refresh',
      USER_TIMEZONE: '',
      GARMIN_TOKEN_JSON: '',
    });
  });

  it('creates a private env file without sending credentials to logs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updateEnvLocal('WHOOP_REFRESH_TOKEN', 'synthetic-token', root);
    expect(parseEnv(readFileSync(envPath, 'utf8'))).toEqual({ WHOOP_REFRESH_TOKEN: 'synthetic-token' });
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('replaces exported/spaced assignments and preserves unrelated values and comments', () => {
    writeFileSync(envPath, '# keep me\nexport WHOOP_REFRESH_TOKEN = old # old token\nSTRAVA_CLIENT_SECRET="unchanged"\n');
    chmodSync(envPath, 0o644);
    updateEnvLocal('WHOOP_REFRESH_TOKEN', 'new', root);
    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toBe('# keep me\nWHOOP_REFRESH_TOKEN=\'new\'\nSTRAVA_CLIENT_SECRET="unchanged"\n');
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(parseEnv(contents).STRAVA_CLIENT_SECRET).toBe('unchanged');
  });

  it('syncs and closes a private sibling before atomically replacing the original file', () => {
    const original = 'TOKEN=old\nKEEP=unchanged\n';
    const replacement = "TOKEN='new'\nKEEP=unchanged\n";
    writeFileSync(envPath, original);
    const originalInode = statSync(envPath).ino;
    let stagedFd: number | undefined;
    io.fsyncSync.mockImplementation((fd) => {
      stagedFd = fd;
      expect(fstatSync(fd).mode & 0o777).toBe(0o600);
      expect(readFileSync(envPath, 'utf8')).toBe(original);
      realFs.fsyncSync(fd);
    });
    io.renameSync.mockImplementation((from, to) => {
      expect(dirname(from)).toBe(root);
      expect(to).toBe(envPath);
      expect(io.openSync).toHaveBeenCalledWith(
        from, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600,
      );
      expect(statSync(from).mode & 0o777).toBe(0o600);
      expect(readFileSync(from, 'utf8')).toBe(replacement);
      expect(readFileSync(to, 'utf8')).toBe(original);
      expect(stagedFd).toBeDefined();
      expect(() => fstatSync(stagedFd!)).toThrow();
      realFs.renameSync(from, to);
    });

    updateEnvLocal('TOKEN', 'new', root);

    expect(io.fsyncSync).toHaveBeenCalledOnce();
    expect(io.renameSync).toHaveBeenCalledOnce();
    expect(readFileSync(envPath, 'utf8')).toBe(replacement);
    expect(statSync(envPath).ino).not.toBe(originalInode);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(['.env.local']);
  });

  it('finishes partial byte writes without truncating multibyte credentials', () => {
    writeFileSync(envPath, 'TOKEN=old\nKEEP=unchanged\n');
    io.writeSync.mockImplementation((fd, bytes, offset, length, position) =>
      realFs.writeSync(fd, bytes, offset, Math.min(length, 3), position));

    const credential = ['synthetic', '\u00f1', '\u{1f642}'].join('-');
    updateEnvLocal('TOKEN', credential, root);

    expect(io.writeSync.mock.calls.length).toBeGreaterThan(1);
    expect(readFileSync(envPath, 'utf8')).toBe(["TOKEN='", credential, "'\nKEEP=unchanged\n"].join(''));
    expect(readdirSync(root)).toEqual(['.env.local']);
  });

  it.each(['writeSync', 'fsyncSync', 'closeSync', 'renameSync'] as const)(
    'preserves original bytes and removes the owned temporary file on %s failure',
    (operation) => {
      const original = Buffer.from('# fixture\r\nTOKEN=old\r\nKEEP="unrelated synthetic credential"\r\n');
      const failure = new Error(`Synthetic ${operation} failure`);
      writeFileSync(envPath, original);
      chmodSync(envPath, 0o644);
      if (operation === 'writeSync') {
        io.writeSync.mockImplementationOnce((fd, bytes, offset, length, position) =>
          realFs.writeSync(fd, bytes, offset, Math.min(length, 3), position));
      }
      if (operation === 'closeSync') {
        io.closeSync.mockImplementationOnce((fd) => {
          realFs.closeSync(fd);
          throw failure;
        });
      } else {
        io[operation].mockImplementationOnce(() => { throw failure; });
      }

      expect(() => updateEnvLocal('TOKEN', 'replacement', root)).toThrow(failure);

      expect(readFileSync(envPath)).toEqual(original);
      expect(statSync(envPath).mode & 0o777).toBe(0o600);
      expect(readdirSync(root)).toEqual(['.env.local']);
    },
  );

  it('reports both a write failure and a cleanup failure while completing remaining cleanup', () => {
    const original = 'TOKEN=old\n';
    const writeFailure = new Error('Synthetic write failure');
    const closeFailure = new Error('Synthetic close failure');
    writeFileSync(envPath, original);
    io.writeSync.mockImplementationOnce(() => { throw writeFailure; });
    io.closeSync.mockImplementationOnce((fd) => {
      realFs.closeSync(fd);
      throw closeFailure;
    });

    let failure: unknown;
    try {
      updateEnvLocal('TOKEN', 'new', root);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([writeFailure, closeFailure]);
    expect(io.closeSync).toHaveBeenCalledTimes(2);
    expect(readFileSync(envPath, 'utf8')).toBe(original);
    expect(readdirSync(root)).toEqual(['.env.local']);
  });

  it('rejects a zero-progress write instead of looping or replacing the original', () => {
    const original = 'TOKEN=old\nKEEP=unchanged\n';
    writeFileSync(envPath, original);
    io.writeSync.mockReturnValueOnce(0);

    expect(() => updateEnvLocal('TOKEN', 'new', root)).toThrow('No progress writing .env.local');

    expect(io.writeSync).toHaveBeenCalledOnce();
    expect(io.fsyncSync).not.toHaveBeenCalled();
    expect(io.renameSync).not.toHaveBeenCalled();
    expect(readFileSync(envPath, 'utf8')).toBe(original);
    expect(readdirSync(root)).toEqual(['.env.local']);
  });

  it('does not overwrite or clean up a temporary path it did not create', () => {
    const original = 'TOKEN=old\n';
    writeFileSync(envPath, original);
    let collisionPath: string | undefined;
    io.openSync.mockImplementation((path, flags, mode) => {
      if (path !== envPath) {
        collisionPath = path;
        writeFileSync(path, 'unowned fixture');
      }
      return realFs.openSync(path, flags, mode);
    });

    expect(() => updateEnvLocal('TOKEN', 'new', root)).toThrow();

    expect(collisionPath).toBeDefined();
    expect(readFileSync(collisionPath!, 'utf8')).toBe('unowned fixture');
    expect(readFileSync(envPath, 'utf8')).toBe(original);
  });

  it.each(['replacement', 'edit', 'hardlink'])('refuses a destination %s during persistence', (change) => {
    const original = 'TOKEN=old\nKEEP=unchanged\n';
    const concurrent = 'TOKEN=concurrent\nKEEP=unchanged\n';
    const otherPath = resolve(root, 'other.env');
    writeFileSync(envPath, original);
    io.fsyncSync.mockImplementation((fd) => {
      realFs.fsyncSync(fd);
      if (change === 'hardlink') {
        linkSync(envPath, otherPath);
      } else {
        if (change === 'replacement') realFs.renameSync(envPath, otherPath);
        writeFileSync(envPath, concurrent);
      }
    });

    expect(() => updateEnvLocal('TOKEN', 'new', root)).toThrow('.env.local changed during credential persistence');

    expect(io.renameSync).not.toHaveBeenCalled();
    expect(readFileSync(envPath, 'utf8')).toBe(change === 'hardlink' ? original : concurrent);
    if (change !== 'edit') expect(readFileSync(otherPath, 'utf8')).toBe(original);
    expect(readdirSync(root)).toEqual(change === 'edit' ? ['.env.local'] : ['.env.local', 'other.env']);
  });

  it('appends missing credentials and retains multiline and Windows-style env values', () => {
    writeFileSync(envPath, '# fixture\r\nKEEP="first\r\nsecond"\r\nOTHER=unchanged');
    updateEnvLocal('GARMIN_TOKEN_JSON', 'c3ludGhldGlj', root);
    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toContain('# fixture\r\nKEEP="first\r\nsecond"\r\nOTHER=unchanged\n');
    expect(parseEnv(contents)).toMatchObject({ OTHER: 'unchanged', GARMIN_TOKEN_JSON: 'c3ludGhldGlj' });
  });

  it('replaces an entire multiline assignment rather than leaving trailing fragments', () => {
    writeFileSync(envPath, 'WHOOP_REFRESH_TOKEN="old\nvalue"\nKEEP=yes\n');
    updateEnvLocal('WHOOP_REFRESH_TOKEN', 'replacement', root);
    expect(parseEnv(readFileSync(envPath, 'utf8'))).toEqual({ WHOOP_REFRESH_TOKEN: 'replacement', KEEP: 'yes' });
  });

  it.each(['abc$&$$=+/==#', 'contains"quote', "contains'quote", 'a\\nb', ''])(
    'round-trips supported credential punctuation without replacement expansion',
    (value) => {
      updateEnvLocal('TOKEN', value, root);
      expect(parseEnv(readFileSync(envPath, 'utf8')).TOKEN).toBe(value);
    },
  );

  it.each([
    'WHOOP_REFRESH_TOKEN=old\nmalformed secret-value',
    'WHOOP_REFRESH_TOKEN=old\nWHOOP_REFRESH_TOKEN=duplicate',
    'WHOOP_REFRESH_TOKEN="unterminated',
    'WHOOP_REFRESH_TOKEN="old"unexpected',
    'WHOOP_REFRESH_TOKEN=old\0',
  ])('rejects malformed existing files without overwriting or exposing their contents', (contents) => {
    writeFileSync(envPath, contents);
    expect(() => updateEnvLocal('WHOOP_REFRESH_TOKEN', 'new', root)).toThrow(/\.env\.local/);
    expect(() => assertLocalEnvWritable(root)).toThrow(/\.env\.local/);
    expect(readFileSync(envPath, 'utf8')).toBe(contents);
  });

  it.each(['bad-name', 'NEW\nINJECTED', '1TOKEN'])('rejects invalid variable names before creating a file', (name) => {
    expect(() => updateEnvLocal(name, 'synthetic', root)).toThrow('Invalid environment variable name');
    expect(existsSync(envPath)).toBe(false);
  });

  it.each(['secret\nINJECTED=yes', 'secret\rINJECTED=yes', 'secret\0'])(
    'rejects unsafe credential values without exposing them',
    (value) => {
      expect(() => updateEnvLocal('TOKEN', value, root)).toThrow('Credential must be a single-line value');
      expect(existsSync(envPath)).toBe(false);
    },
  );

  it('preflights writability and fixes permissive modes before token rotation', () => {
    writeFileSync(envPath, 'TOKEN=old\n');
    chmodSync(envPath, 0o666);
    assertLocalEnvWritable(root);
    expect(readFileSync(envPath, 'utf8')).toBe('TOKEN=old\n');
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('creates a missing destination during preflight', () => {
    assertLocalEnvWritable(root);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(envPath, 'utf8')).toBe('');
  });

  it.each(['symlink', 'hardlink'])('refuses a %s destination', (kind) => {
    const target = resolve(root, 'other.env');
    writeFileSync(target, 'TOKEN=unchanged\n');
    if (kind === 'symlink') symlinkSync(target, envPath);
    else linkSync(target, envPath);
    expect(() => updateEnvLocal('TOKEN', 'new', root)).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('TOKEN=unchanged\n');
  });

  it('does not treat a directory or missing parent as an empty env file', () => {
    mkdirSync(envPath);
    expect(() => updateEnvLocal('TOKEN', 'new', root)).toThrow();
    expect(() => assertLocalEnvWritable(resolve(root, 'missing'))).toThrow();
  });
});
