import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGitHubApi, GitHubRequestError, gitBlobSha, planPublicChanges,
  PR_BODY, PR_MARKER, SYNC_BRANCH, SYNC_EMAIL, SYNC_MESSAGE, SYNC_TITLE,
  synchronizePublicRepo, type GitHubApi,
} from './public-sync';

const BASE = '1'.repeat(40);
const BASE_TREE = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const NEXT_TREE = '4'.repeat(40);
const NEXT_COMMIT = '5'.repeat(40);
const OTHER = '6'.repeat(40);
const TARGET = 'example/public-template';
const PRIVATE = 'example/private-source';
const PREFIX = `/repos/${TARGET}`;
const snapshot = new Map([['src/app.ts', Buffer.from('export const value = 2;')]]);
const publicEntry = (path: string, bytes: Buffer) => ({
  path, mode: '100644', type: 'blob' as const, sha: gitBlobSha(bytes),
});
const ownedPull = (state: 'open' | 'closed' = 'open') => ({
  number: 7, state, body: PR_MARKER, head: { sha: HEAD }, merged_at: null,
});

function fixture(options: {
  sameAsBase?: boolean;
  branch?: boolean;
  sameAsHead?: boolean;
  olderHeadBase?: boolean;
  foreignBranch?: boolean;
  privateTarget?: boolean;
  archivedTarget?: boolean;
  truncated?: boolean;
  baseMoved?: boolean;
  missingBase?: boolean;
  pulls?: readonly ReturnType<typeof ownedPull>[];
  previousFiles?: readonly string[];
} = {}) {
  let baseReads = 0;
  const previousManifest = Buffer.from(JSON.stringify(options.previousFiles ?? []));
  const entries = [
    publicEntry('src/app.ts', options.sameAsBase ? snapshot.get('src/app.ts')! : Buffer.from('export const value = 1;')),
    publicEntry('LICENSE', Buffer.from('Public-only license')),
    ...(options.previousFiles ? [publicEntry('config/public-files.json', previousManifest)] : []),
  ];
  const request = vi.fn<GitHubApi['request']>(async (method, url) => {
    if (method === 'GET' && url === PREFIX) {
      return { full_name: TARGET, private: !!options.privateTarget, archived: !!options.archivedTarget, disabled: false, default_branch: 'main' };
    }
    if (method === 'GET' && url === `${PREFIX}/git/ref/heads/main`) {
      if (options.missingBase) throw new GitHubRequestError(404);
      return { ref: 'refs/heads/main', object: { sha: options.baseMoved && baseReads++ > 0 ? OTHER : BASE } };
    }
    if (method === 'GET' && url === `${PREFIX}/git/commits/${BASE}`) {
      return { sha: BASE, tree: { sha: BASE_TREE }, parents: [], message: 'Public commit', author: { email: 'public@example.invalid' }, committer: { email: 'public@example.invalid' } };
    }
    if (method === 'GET' && url === `${PREFIX}/git/trees/${BASE_TREE}?recursive=1`) {
      return { sha: BASE_TREE, truncated: !!options.truncated, tree: entries };
    }
    if (method === 'GET' && url === `${PREFIX}/git/blobs/${gitBlobSha(previousManifest)}`) {
      return { encoding: 'base64', content: previousManifest.toString('base64') };
    }
    if (method === 'GET' && url.includes('/git/matching-refs/')) {
      return options.branch ? [{ ref: `refs/heads/${SYNC_BRANCH}`, object: { sha: HEAD } }] : [];
    }
    if (method === 'GET' && url === `${PREFIX}/git/commits/${HEAD}`) {
      return { sha: HEAD, tree: { sha: options.sameAsHead ? NEXT_TREE : OTHER },
        parents: [{ sha: options.olderHeadBase ? OTHER : BASE }],
        message: options.foreignBranch ? 'Human edit' : SYNC_MESSAGE,
        author: { email: SYNC_EMAIL }, committer: { email: SYNC_EMAIL } };
    }
    if (method === 'GET' && url.startsWith(`${PREFIX}/pulls?`)) return options.pulls ?? [];
    if (method === 'POST' && url === `${PREFIX}/git/trees`) return { sha: NEXT_TREE };
    if (method === 'POST' && url === `${PREFIX}/git/commits`) return { sha: NEXT_COMMIT };
    if ((method === 'POST' && [ `${PREFIX}/git/refs`, `${PREFIX}/pulls` ].includes(url)) ||
        (method === 'PATCH' && (url.startsWith(`${PREFIX}/git/refs/`) || url === `${PREFIX}/pulls/7`))) return {};
    throw new Error(`Unexpected mocked GitHub call: ${method} ${url}`);
  });
  return { api: { request }, request, writes: () => request.mock.calls.filter(([method]) => method !== 'GET') };
}

afterEach(() => vi.unstubAllGlobals());

describe('public snapshot ownership', () => {
  it('preserves public-only files and skips identical source bytes', () => {
    expect(planPublicChanges(snapshot, ['src/app.ts'], [
      publicEntry('src/app.ts', snapshot.get('src/app.ts')!), publicEntry('LICENSE', Buffer.from('License')),
    ])).toEqual([]);
  });

  it('adds reviewed files and deletes only previously managed paths', () => {
    const changes = planPublicChanges(snapshot, ['src/removed.ts'], [
      publicEntry('src/removed.ts', Buffer.from('old')), publicEntry('LICENSE', Buffer.from('License')),
    ]);
    expect(changes).toEqual([
      { path: 'src/app.ts', mode: '100644', type: 'blob', content: 'export const value = 2;' },
      { path: 'src/removed.ts', mode: '100644', type: 'blob', sha: null },
    ]);
  });
});

describe('rolling public synchronization', () => {
  it('does not write when a private-only merge leaves the public snapshot unchanged', async () => {
    const f = fixture({ sameAsBase: true });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('unchanged');
    expect(f.writes()).toEqual([]);
  });

  it('creates a PR from public parents with generic metadata and no private provenance', async () => {
    const f = fixture();
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('created');
    expect(f.request).toHaveBeenCalledWith('POST', `${PREFIX}/git/commits`, {
      message: SYNC_MESSAGE, tree: NEXT_TREE, parents: [BASE],
      author: { name: 'github-actions[bot]', email: SYNC_EMAIL },
      committer: { name: 'github-actions[bot]', email: SYNC_EMAIL },
    });
    expect(f.request).toHaveBeenCalledWith('POST', `${PREFIX}/pulls`, {
      title: SYNC_TITLE, body: PR_BODY, head: SYNC_BRANCH, base: 'main', maintainer_can_modify: false,
    });
    expect(JSON.stringify(f.writes())).not.toContain(PRIVATE);
  });

  it('updates the same PR without force-pushing and keeps the public base in its ancestry', async () => {
    const f = fixture({ branch: true, pulls: [ownedPull()] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('updated');
    expect(f.request).toHaveBeenCalledWith('PATCH', `${PREFIX}/git/refs/heads/${encodeURIComponent(SYNC_BRANCH)}`, {
      sha: NEXT_COMMIT, force: false,
    });
    expect(f.request).toHaveBeenCalledWith('POST', `${PREFIX}/git/commits`, expect.objectContaining({ parents: [HEAD, BASE] }));
    expect(f.writes().filter(([, url]) => url === `${PREFIX}/pulls`)).toEqual([]);
  });

  it('leaves an already-current rolling PR untouched', async () => {
    const f = fixture({ branch: true, sameAsHead: true, pulls: [ownedPull()] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('unchanged');
    expect(f.writes().every(([, url]) => url.endsWith('/git/trees'))).toBe(true);
  });

  it('integrates an advanced public base even when the desired tree matches the existing branch', async () => {
    const f = fixture({ branch: true, sameAsHead: true, olderHeadBase: true, pulls: [ownedPull()] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('updated');
    expect(f.request).toHaveBeenCalledWith('POST', `${PREFIX}/git/commits`, expect.objectContaining({ parents: [HEAD, BASE] }));
  });

  it('closes an obsolete PR if the public default branch already matches the latest snapshot', async () => {
    const f = fixture({ branch: true, sameAsBase: true, pulls: [ownedPull()] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('closed');
    expect(f.writes()).toEqual([['PATCH', `${PREFIX}/pulls/7`, { state: 'closed' }]]);
  });

  it('respects a closed PR until a different public snapshot exists', async () => {
    const f = fixture({ branch: true, sameAsHead: true, pulls: [ownedPull('closed')] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('unchanged');
    expect(f.writes().some(([, url]) => url === `${PREFIX}/pulls`)).toBe(false);
  });

  it('respects a rejected snapshot even after the maintainer deletes its branch', async () => {
    const f = fixture({ sameAsHead: true, pulls: [ownedPull('closed')] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('unchanged');
    expect(f.writes().every(([, url]) => url.endsWith('/git/trees'))).toBe(true);
  });

  it('creates a new proposal after a rejected snapshot changes', async () => {
    const f = fixture({ pulls: [ownedPull('closed')] });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('created');
    expect(f.request).toHaveBeenCalledWith('POST', `${PREFIX}/pulls`, expect.objectContaining({ head: SYNC_BRANCH }));
  });

  it('recovers when a previous run created the branch but failed before creating its PR', async () => {
    const f = fixture({ branch: true, sameAsHead: true });
    expect(await synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).toBe('created');
    expect(f.writes().filter(([, url]) => url === `${PREFIX}/pulls`)).toHaveLength(1);
  });

  it.each([
    [{ privateTarget: true }, 'writable public repository'],
    [{ archivedTarget: true }, 'writable public repository'],
    [{ branch: true, foreignBranch: true }, 'unmanaged commit'],
    [{ truncated: true }, 'truncated'],
    [{ missingBase: true }, 'Initialize the public repository'],
    [{ previousFiles: ['../../private/data.json'] }, 'Invalid public file manifest'],
    [{ branch: true, pulls: [{ ...ownedPull(), body: 'Human PR' }] }, 'not managed'],
  ] as const)('fails closed for invalid target or branch state %#', async (options, message) => {
    const f = fixture(options);
    await expect(synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).rejects.toThrow(message);
    expect(f.writes()).toEqual([]);
  });

  it('refuses to update refs when the public base moves during preparation', async () => {
    const f = fixture({ baseMoved: true });
    await expect(synchronizePublicRepo(f.api, TARGET, PRIVATE, snapshot)).rejects.toThrow('changed during sync');
    expect(f.writes().some(([, url]) => url.includes('/git/refs') || url.endsWith('/pulls'))).toBe(false);
  });

  it('rejects the private source as its own destination before making requests', async () => {
    const f = fixture();
    await expect(synchronizePublicRepo(f.api, PRIVATE, PRIVATE, snapshot)).rejects.toThrow('different public destination');
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe('GitHub transport', () => {
  it('disables redirects and does not include response bodies in errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('sensitive response body', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createGitHubApi(['synthetic', 'public', 'credential'].join('-'));
    await expect(api.request('GET', PREFIX)).rejects.toThrow('HTTP 403');
    expect(fetchMock).toHaveBeenCalledWith(`https://api.github.com${PREFIX}`, expect.objectContaining({
      redirect: 'error', method: 'GET',
    }));
    await expect(api.request('GET', PREFIX)).rejects.not.toThrow('sensitive response body');
  });
});

describe('private-first workflow wiring', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/sync-public.yml', import.meta.url)), 'utf8');
  const checks = readFileSync(fileURLToPath(new URL('../../.github/workflows/pr-checks.yml', import.meta.url)), 'utf8');

  it('requires explicit enablement and a merged default-branch PR or a default-branch manual dispatch', () => {
    expect(workflow).toContain('types: [closed]');
    expect(workflow).toContain("vars.PUBLIC_SYNC_ENABLED == 'true'");
    expect(workflow).toContain('github.event.pull_request.merged == true');
    expect(workflow).toContain('github.event.pull_request.base.ref == github.event.repository.default_branch');
    expect(workflow).toContain("github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('publishes only an audited artifact in a job with no private checkout or checkout permission', () => {
    const [prepare, publish] = workflow.split('\n  publish:');
    expect(prepare).toContain('pnpm export:public');
    expect(prepare).toContain('pnpm audit:public');
    expect(prepare).not.toContain('PUBLIC_SYNC_TOKEN');
    expect(publish).not.toContain('uses: actions/checkout');
    expect(publish).toContain('contents: none');
    expect(publish).toContain('environment: public-sync');
    expect(publish).toContain('PUBLIC_SOURCE_DIR: ${{ github.workspace }}/public-source');
    expect(publish).toContain('working-directory: public-sync-runtime');
    expect(publish).toContain('package_json_file: public-sync-runtime/package.json');
  });

  it('runs an independent privacy audit on every opened, updated and reopened PR', () => {
    expect(checks).toContain('types: [opened, synchronize, reopened, ready_for_review]');
    const privacyJob = checks.split('\n  privacy-audit:')[1];
    expect(privacyJob).toContain('pnpm export:public');
    expect(privacyJob).toContain('pnpm audit:public');
    expect(privacyJob).not.toContain('needs:');
    expect(privacyJob).not.toContain('secrets.');
    expect(checks).not.toContain('paths:');
    expect(checks).not.toContain('paths-ignore:');
  });
});
