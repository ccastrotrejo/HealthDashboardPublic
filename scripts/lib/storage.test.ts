import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, dataPath } from './storage.js';

describe('private pipeline storage', () => {
  it('anchors artifacts to the repository instead of the shell working directory', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    expect(isAbsolute(DATA_DIR)).toBe(true);
    expect(resolve(DATA_DIR)).toBe(resolve(root, 'private/data'));
    expect(dataPath('snapshot.json')).toBe(resolve(root, 'private/data/snapshot.json'));
    expect(dataPath('ai-history.jsonl')).toBe(resolve(root, 'private/data/ai-history.jsonl'));
  });

  it.each(['', '../athlete.json', '/snapshot.json', 'nested/file.json', '..', '.env.local', 'data\\file.json', 'x\0.json'])(
    'rejects a path that is not a pipeline artifact filename',
    (name) => expect(() => dataPath(name)).toThrow('Invalid data artifact filename'),
  );
});
