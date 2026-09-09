import { readPublicSnapshot } from './lib/public-export.js';
import { createGitHubApi, synchronizePublicRepo } from './lib/public-sync.js';

async function main(): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.PUBLIC_SYNC_ENABLED !== 'true') {
    throw new Error('Public synchronization is disabled; configure and run the private GitHub workflow');
  }
  const root = process.env.PUBLIC_SOURCE_DIR;
  if (!root) throw new Error('Missing source-only artifact directory');
  const snapshot = readPublicSnapshot(root);
  const result = await synchronizePublicRepo(
    createGitHubApi(process.env.GH_TOKEN ?? ''),
    process.env.PUBLIC_SYNC_REPOSITORY ?? '',
    process.env.PRIVATE_SOURCE_REPOSITORY ?? '',
    snapshot,
  );
  console.log(`Public template synchronization: ${result}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Public synchronization failed');
  process.exitCode = 1;
});
