import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPublicTemplate } from './lib/public-export.js';

try {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) throw new Error('Usage: pnpm audit:public /path/to/export');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const count = auditPublicTemplate(root, resolve(destination));
  console.log(`Publication checks passed for ${count} files: manifest, byte parity, file boundaries and content rules.`);
  console.log('Private-reference coverage depends on local private/ and environment files. Manual review remains required.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Publication audit failed');
  process.exitCode = 1;
}
