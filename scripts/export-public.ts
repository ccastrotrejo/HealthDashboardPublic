import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportPublicTemplate } from './lib/public-export.js';

try {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    throw new Error('Usage: pnpm export:public /absolute/path/to/new-directory');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const count = exportPublicTemplate(root, resolve(destination));
  console.log(`Exported ${count} reviewed source files. Publication checks passed.`);
  console.log('Detection is not a guarantee. Review the output before creating a NEW repository; never reuse private history.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Public export failed');
  process.exitCode = 1;
}
