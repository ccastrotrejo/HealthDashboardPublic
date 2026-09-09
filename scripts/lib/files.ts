import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Read one unlinked regular file inside the canonical root, without following file or ancestor links. */
export function readRegularFile(root: string, path: string): Buffer {
  root = realpathSync(root);
  const source = resolve(root, path);
  const rel = relative(root, source);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing a file outside the root: ${path}`);
  const before = lstatSync(source);
  if (before.isSymbolicLink() || realpathSync(source) !== source) {
    throw new Error(`Refusing linked source: ${path}`);
  }
  if (!before.isFile() || before.nlink !== 1) throw new Error(`Refusing linked or non-regular file: ${path}`);
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) {
      throw new Error(`File changed or became linked while opening: ${path}`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
