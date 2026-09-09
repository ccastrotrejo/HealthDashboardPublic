import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = fileURLToPath(new URL('../../private/data/', import.meta.url));

/** Resolve a pipeline artifact inside private storage, independent of the working directory. */
export function dataPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error('Invalid data artifact filename');
  }
  return resolve(DATA_DIR, name);
}
