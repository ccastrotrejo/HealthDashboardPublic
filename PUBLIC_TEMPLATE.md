# Public template architecture

## Distribution model

Keep two separate repositories, with the private repository as the development
source of truth:

- **Public source:** the reusable dashboard, adapters, schemas, tests and
  fictional example configuration. No personal Git history.
- **Private development and installation:** the authoritative source plus an athlete's private settings,
  raw and derived health history, and scheduled synchronization. Provider
  credentials remain in Secrets or ignored environment files, not in Git.

This preserves the existing UI and analytics without introducing a hosted
multi-user service, account database, centralized OAuth app, or tenant isolation
claims. Each installation authorizes its own accounts.

## Separation implemented

The former hardcoded athlete/program module now exposes values from validated
configuration. Existing personalized settings live in `private/athlete.json`;
the template supplies a fictional `config/athlete.example.json`. Profile,
nutrition, recovery rules, goals, workouts and day-specific notes can be changed
without modifying UI components.

All pipeline files share the `private/data/` storage boundary. Browser URLs stay
unchanged. A Vite plugin emits an explicit list of dashboard artifacts and never
copies the raw storage directory. Both configuration and derived summaries are
still private deployment content, not anonymized public demo data.

Initial OAuth tokens are saved directly to local environment configuration.
Setup is repeatable and does not overwrite an existing installation. No vendor
call is made by setup, tests, builds, or the source export.

GitHub sync/AI jobs are gated to private repositories. New users can inspect and
develop in a public clone, but must use a private repository for automated
data-commit deployment.

## Export without leaking history

From the private development repository:

```bash
pnpm export:public /absolute/path/to/a-new-public-template-directory
pnpm audit:public /absolute/path/to/a-new-public-template-directory
```

The destination must not exist, and its parent must exist. The export copies
only files explicitly reviewed in `config/public-files.json`, including reviewed
uncommitted source changes, but never `.git`,
`private/`, `.env.local`, `public/data/`, `dist/`, `.impeccable/`, or personal
product/maintenance documents. Symlinks, hardlinks, non-text files and unreviewed
source additions are rejected. Scanning finishes before any output is created;
the exporter writes the same in-memory bytes it scanned.

The content gate blocks credential patterns, populated environment examples,
and matches against local private references: activity/account identifiers,
exercise timestamps, distinctive physiological measurements, profile text and
credentials from root `.env` and `.env.*` files (excluding `.env.example`).
Optional `private/publication-blocklist.json` holds
additional names, usernames, locations or phrases as a JSON string array. This
file is private and is never copied into the public template. Diagnostics give
only filenames, line numbers and categories, never matched values.

`config/public-scan-allowlist.json` contains exact file/rule/match hashes for
individually reviewed synthetic credential tests. It cannot suppress a match to
private reference data. Do not add blanket test-file exceptions or approve a
match without inspecting its origin. Changes to approved fixture strings require
a fresh review. New source files must be reviewed before adding their paths to
the manifest; there is no automatic approval command.

`audit:public` checks the actual output for extra files/directories, missing
files, links, source-byte differences and content matches. Run it immediately
before distribution, while the output is still source-only. PR checks also run
the export and audit commands without provider credentials.

This is defense in depth, not proof of anonymity. Unknown secret formats,
encoded/fragmented values, common measurements and personal facts absent from
the local references can escape detection. Cloud-only secrets are not fetched.
Retain independent human/security review and GitHub secret scanning.

Before publishing:

1. Inspect every exported file and search for names, contact details, locations,
   account IDs, activity links, secrets, health records and personal notes.
   Path allowlisting is not proof that arbitrary future source edits are safe.
2. In a disposable copy of the export run `pnpm install --frozen-lockfile`,
   `pnpm test`, `pnpm typecheck`, `pnpm run setup`, and `pnpm build`. Keep the
   publication copy free of the private files, dependencies and build output
   created by these commands, then run `pnpm audit:public` on that clean copy.
3. Choose a license and review third-party licensing before inviting reuse.
4. Initialize a **new Git repository in the exported directory** and make a
   fresh initial commit. Only then connect the new public remote.
5. Enable GitHub secret scanning/push protection. Never add the private
   repository as the public repository's history source.

The export command does not create a GitHub repository, change visibility,
commit, push, or publish anything. Do not use a fork/mirror of the original
personal repository as a substitute.

## Maintaining both versions

Develop and merge PRs in the private repository. The **Sync public template**
workflow exports the latest private default-branch snapshot, audits it, and
creates or updates one public PR on `automation/public-template-sync`.
Private commits are never pushed, mirrored or cherry-picked into the public
repository.

The workflow runs after a PR is merged into the private default branch, or by
manual dispatch from that default branch. It does not run for a closed,
unmerged PR, data-bot pushes, or public-repository events. Runs are serialized;
queued merges are coalesced by always exporting the latest default branch.
There are no fragile path filters: an identical public snapshot is a no-op.

The prepare job has no destination credentials. It exports and audits using the
private reference data, then hands off only the audited source artifact. The
publisher is a separate job with **no private checkout and no source Contents
permission**. Its execution copy contains only public source and dependencies;
the source-only artifact remains untouched and is checked again before use.

The publisher uses GitHub's Git Data API, starting from the public default
branch's tree. It updates reviewed files and removes only files listed in the
previous public ownership manifest that have since been removed. Public-only
files such as `LICENSE` are preserved. The public commit parents belong only
to the public repository; commit authorship, message and PR description are
generic and contain no private SHA, PR title, body, author or source URL.

An existing sync branch must carry the workflow's managed commit identity and
message, and an open PR must carry its marker. Ref updates are fast-forward
only, so a concurrent branch edit is rejected rather than overwritten. The
workflow never enables auto-merge. If the latest snapshot already matches the
public default branch, an obsolete open sync PR is closed. A deliberately
closed, unmerged PR is not reopened for the same snapshot and public base.

Make public contributions in public PRs as usual, then port their reviewed
code changes into the private source before the next sync. Direct edits to
managed public files are not a second source of truth and can be replaced by a
later sync PR. Do not edit the automation branch by hand.

### Enable synchronization (disabled by default)

First initialize the destination public repository from a reviewed source-only
export with **fresh history**. An empty repository has no PR base and is
rejected; the workflow will not silently bootstrap or change repo visibility.

Configure these settings in the **private** repository:

| Setting | Value |
|---|---|
| Repository variable `PUBLIC_SYNC_REPOSITORY` | Destination `owner/repository` |
| Repository variable `PUBLIC_SYNC_ENABLED` | `true`, only when ready to publish |
| Environment `public-sync` | Add required reviewers and restrict deployment branches to the default branch |
| Environment secret `PUBLIC_SYNC_TOKEN` | Fine-grained PAT scoped **only to the public destination** |

Setting the destination does not enable publication. Keep `PUBLIC_SYNC_ENABLED`
set to `false` until the public repository has its initial source-only commit,
the environment protections are in place, and `PUBLIC_SYNC_TOKEN` is configured.
Do not hardcode a destination or enable publishing by default in the shared
workflow; other installations must opt in with their own repository settings.

The token needs **Contents: read/write**, **Pull requests: read/write**, and
**Workflows: read/write**, because the managed source includes workflow files.
Use an expiry and rotate it; do not reuse the private repo's `GH_PAT` or a
wearable-provider token. A GitHub App installation token with the same
destination-only permissions can replace the PAT if you provision it in the
publisher job later. The built-in source `GITHUB_TOKEN` cannot write to a
separate repository.

GitHub attributes the public PR to the token owner or GitHub App bot. Generic
commit metadata does not make that account anonymous; use an App bot if you
want a service identity instead of a personal account as the public PR author.

Until enablement and destination are set, all sync jobs are skipped. The
environment reviewer can inspect the private run before granting the publisher
access to its token. GitHub environment protections must be configured in
repository settings; naming an environment in YAML does not create a reviewer
requirement.

Run **Sync public template** manually once, inspect its public PR, and merge it
only after review. Later qualifying private merges update the same open PR.
If publication fails after updating the branch, rerunning can create the missing
PR without duplicating the snapshot commit. A public-base race, token expiry,
unmanaged branch edit or privacy finding fails the run; resolve the cause and
rerun from the default branch. Disable `PUBLIC_SYNC_ENABLED` to stop publishing.

### Private PR privacy audit

Every opened, updated, reopened or ready-for-review PR runs the independent
**Public export privacy audit** job in `PR checks`, without vendor or public
write credentials. It does not depend on unit tests or the build succeeding.
The merge workflow repeats the export and audit against the current default
branch before publication.

Mark **Public export privacy audit** as a required check on the private default
branch. Require review for changes to the file manifest, scan exceptions,
privacy scanner and synchronization workflow. The workflow does not modify
branch protection automatically.

The current private repository may still contain personal data in **older
commits**. That is intentional preservation, not a claim of sanitized history.
Keep it private. An authenticated website does not protect public Git contents.

## Remaining product boundaries

This is a developer-oriented self-hosted template, not one-click managed hosting.
Users still need provider developer apps, local credentials and a private
deployment. Garmin's unofficial login may not work for every account.

The training engine retains the original weekly sport assignments; configuration
replaces personal values but does not turn it into an arbitrary scheduling
engine. Provider permission limits, unsupported metrics, and empty histories
continue to be handled by the existing dashboard. Real provider authorization
requires the account owner's consent and cannot be demonstrated by synthetic
tests.
