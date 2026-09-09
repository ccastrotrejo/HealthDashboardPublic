import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parsePublicManifest } from './public-export.js';

export const SYNC_BRANCH = 'automation/public-template-sync';
export const SYNC_TITLE = 'chore: Sync public template';
export const SYNC_MESSAGE = `${SYNC_TITLE}\n\nManaged public-source snapshot.`;
export const SYNC_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
export const PR_MARKER = '<!-- health-dashboard-public-sync:v1 -->';
export const PR_BODY = `${PR_MARKER}
Updates the managed public template files from an audited source-only snapshot.

- Only explicitly reviewed source files are synchronized.
- Public-only files outside the managed manifest are preserved.
- No source-repository history, commit messages, PR metadata or authorship is copied.

Review this PR before merging. This workflow does not enable automatic merging.
`;

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const gitRef = z.object({ ref: z.string(), object: z.object({ sha }) });
const commit = z.object({
  sha, tree: z.object({ sha }), message: z.string(),
  parents: z.array(z.object({ sha })),
  author: z.object({ email: z.string() }), committer: z.object({ email: z.string() }),
});
const repository = z.object({
  full_name: z.string(), private: z.boolean(), archived: z.boolean(),
  disabled: z.boolean(), default_branch: z.string().min(1),
});
const tree = z.object({
  sha, truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.enum(['blob', 'tree', 'commit']), sha })),
});
const pullRequest = z.object({
  number: z.number().int().positive(), state: z.enum(['open', 'closed']),
  body: z.string().nullable(), head: z.object({ sha }),
  merged_at: z.string().nullable(),
});

function isManagedCommit(value: z.infer<typeof commit>): boolean {
  return value.message.trim() === SYNC_MESSAGE &&
    value.author.email === SYNC_EMAIL && value.committer.email === SYNC_EMAIL;
}

export interface GitHubApi {
  request(method: 'GET' | 'POST' | 'PATCH', endpoint: string, body?: unknown): Promise<unknown>;
}

export class GitHubRequestError extends Error {
  constructor(readonly status: number) {
    super(`GitHub API request failed with HTTP ${status}`);
  }
}

/** Never follow redirects or include response bodies, tokens or private context in errors. */
export function createGitHubApi(token: string): GitHubApi {
  if (!token) throw new Error('Configure the public-repository sync token');
  return {
    async request(method, endpoint, body) {
      if (!endpoint.startsWith('/repos/')) throw new Error('Unsupported GitHub API endpoint');
      const response = await fetch(`https://api.github.com${endpoint}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new GitHubRequestError(response.status);
      return response.json();
    },
  };
}

export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

interface PublicTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export type TreeChange =
  | { path: string; mode: '100644'; type: 'blob'; content: string }
  | { path: string; mode: '100644'; type: 'blob'; sha: null };

/** Remove only formerly managed files; never mirror-delete public-only content. */
export function planPublicChanges(
  snapshot: ReadonlyMap<string, Buffer>,
  previousManifest: readonly string[],
  publicTree: readonly PublicTreeEntry[],
): TreeChange[] {
  const previous = new Map(publicTree.map((entry) => [entry.path, entry]));
  const changes: TreeChange[] = [];
  for (const [path, bytes] of snapshot) {
    const entry = previous.get(path);
    if (entry?.sha !== gitBlobSha(bytes) || entry.mode !== '100644' || entry.type !== 'blob') {
      changes.push({ path, mode: '100644', type: 'blob', content: bytes.toString('utf8') });
    }
  }
  for (const path of previousManifest) {
    if (!snapshot.has(path) && previous.has(path)) changes.push({ path, mode: '100644', type: 'blob', sha: null });
  }
  return changes;
}

/** Work only in the public repository's object graph; all parent commits are public commits. */
export async function synchronizePublicRepo(
  api: GitHubApi,
  target: string,
  sourceRepository: string,
  snapshot: ReadonlyMap<string, Buffer>,
): Promise<'created' | 'updated' | 'unchanged' | 'closed'> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(target) ||
      !sourceRepository || target.toLowerCase() === sourceRepository.toLowerCase()) {
    throw new Error('Configure a different public destination as owner/repository');
  }
  const endpoint = `/repos/${target}`;
  const repo = repository.parse(await api.request('GET', endpoint));
  if (repo.private || repo.archived || repo.disabled || repo.full_name.toLowerCase() !== target.toLowerCase() ||
      repo.default_branch === SYNC_BRANCH) {
    throw new Error('Destination must be a writable public repository with a separate default branch');
  }
  const baseEndpoint = `${endpoint}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`;
  let baseRef: z.infer<typeof gitRef>;
  try {
    baseRef = gitRef.parse(await api.request('GET', baseEndpoint));
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) {
      throw new Error('Initialize the public repository with fresh public-source history before enabling sync');
    }
    throw error;
  }
  const base = commit.parse(await api.request('GET', `${endpoint}/git/commits/${baseRef.object.sha}`));
  const current = tree.parse(await api.request('GET', `${endpoint}/git/trees/${base.tree.sha}?recursive=1`));
  if (current.truncated) throw new Error('Public repository tree is truncated; refusing a partial synchronization');
  let previousManifest: string[] = [];
  const manifest = current.tree.find((entry) => entry.path === 'config/public-files.json');
  if (manifest) {
    if (manifest.type !== 'blob' || manifest.mode !== '100644') throw new Error('Invalid published ownership manifest');
    const blob = z.object({ content: z.string(), encoding: z.literal('base64') })
      .parse(await api.request('GET', `${endpoint}/git/blobs/${manifest.sha}`));
    const bytes = Buffer.from(blob.content, 'base64');
    if (gitBlobSha(bytes) !== manifest.sha) throw new Error('Published ownership manifest checksum mismatch');
    previousManifest = parsePublicManifest(bytes.toString('utf8'));
  }

  const refs = z.array(gitRef).parse(await api.request('GET',
    `${endpoint}/git/matching-refs/heads/${encodeURIComponent(SYNC_BRANCH)}`));
  const branchRef = refs.find((entry) => entry.ref === `refs/heads/${SYNC_BRANCH}`);
  const head = branchRef
    ? commit.parse(await api.request('GET', `${endpoint}/git/commits/${branchRef.object.sha}`))
    : null;
  if (head && !isManagedCommit(head)) {
    throw new Error('The sync branch contains an unmanaged commit; refusing to overwrite it');
  }
  const query = new URLSearchParams({
    state: 'all', head: `${target.split('/')[0]}:${SYNC_BRANCH}`,
    base: repo.default_branch, sort: 'created', direction: 'desc', per_page: '100',
  });
  const pulls = z.array(pullRequest).parse(await api.request('GET', `${endpoint}/pulls?${query}`));
  const open = pulls.find((pr) => pr.state === 'open');
  if (open && (!open.body?.includes(PR_MARKER) || open.head.sha !== head?.sha)) {
    throw new Error('The open sync PR is not managed by this workflow or its head changed; refusing to update it');
  }
  const changes = planPublicChanges(snapshot, previousManifest, current.tree);
  if (!changes.length) {
    if (open) {
      await api.request('PATCH', `${endpoint}/pulls/${open.number}`, { state: 'closed' });
      return 'closed';
    }
    return 'unchanged';
  }
  const nextTree = z.object({ sha }).parse(await api.request('POST', `${endpoint}/git/trees`, {
    base_tree: base.tree.sha, tree: changes,
  }));
  // A closed PR still records its rejected snapshot after its branch is deleted.
  // Do not recreate that same proposal on a private-only merge or retry.
  const rejected = !open && pulls.find((pr) => pr.state === 'closed' && !pr.merged_at && pr.body?.includes(PR_MARKER));
  if (rejected) {
    const rejectedCommit = head?.sha === rejected.head.sha ? head
      : commit.parse(await api.request('GET', `${endpoint}/git/commits/${rejected.head.sha}`));
    if (isManagedCommit(rejectedCommit) && rejectedCommit.tree.sha === nextTree.sha &&
        rejectedCommit.parents.some((parent) => parent.sha === base.sha)) return 'unchanged';
  }
  const alreadyCurrent = head?.tree.sha === nextTree.sha && head.parents.some((parent) => parent.sha === base.sha);
  if (!alreadyCurrent) {
    const parents = [...new Set([...(head ? [head.sha] : []), base.sha])];
    const identity = { name: 'github-actions[bot]', email: SYNC_EMAIL };
    const next = z.object({ sha }).parse(await api.request('POST', `${endpoint}/git/commits`, {
      message: SYNC_MESSAGE, tree: nextTree.sha, parents, author: identity, committer: identity,
    }));
    const latestBase = gitRef.parse(await api.request('GET', baseEndpoint));
    if (latestBase.object.sha !== base.sha) throw new Error('Public default branch changed during sync; rerun the workflow');
    if (head) {
      // Fast-forward only is the optimistic concurrency guard: a concurrent human
      // commit is not a parent of this snapshot, so GitHub rejects the update.
      await api.request('PATCH', `${endpoint}/git/refs/heads/${encodeURIComponent(SYNC_BRANCH)}`, {
        sha: next.sha, force: false,
      });
    } else {
      await api.request('POST', `${endpoint}/git/refs`, { ref: `refs/heads/${SYNC_BRANCH}`, sha: next.sha });
    }
  }
  if (open) return alreadyCurrent ? 'unchanged' : 'updated';
  await api.request('POST', `${endpoint}/pulls`, {
    title: SYNC_TITLE, body: PR_BODY, head: SYNC_BRANCH, base: repo.default_branch,
    maintainer_can_modify: false,
  });
  return 'created';
}
