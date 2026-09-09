# Security and privacy

## Public code is not public health data

The application is a single-person, self-hosted dashboard. A source-only
template may be public. An installation that commits health records must use
a **private repository** and an authenticated deployment.

`private/` and `.env.local` are ignored by default. Ignoring a file does not
remove it from Git history or untrack previously committed files. The private
installation deliberately tracks `private/data/` for automated deployment;
that repository must never be made public.

Export into a new directory with `pnpm export:public /path/to/new-directory`.
The exporter copies an explicitly reviewed source manifest, rejects symlinks and hardlinks,
and omits Git metadata, private data, generated builds, environment files,
personal product/maintenance notes, and design-session artifacts. It scans
credentials and local private-data references before copying. `pnpm audit:public`
also checks the actual export for unexpected content and source differences.
Exact-match exceptions cover reviewed synthetic credential tests only, never
private-reference matches. It is **not a universal secret scanner**: source code
can still contain an unrecognized or encoded secret. Review the exported content
and enable GitHub secret scanning/push
protection before publishing. See [PUBLIC_TEMPLATE.md](./PUBLIC_TEMPLATE.md).

## Data boundaries

- Provider API calls, local OAuth exchanges and refresh tokens stay in Node.
  No provider credentials are intentionally exposed to React.
- The validated athlete configuration contains training/profile information,
  not credentials. It is included in a personalized build and must be treated
  as sensitive, just like derived health summaries.
- Vite emits only the named dashboard artifacts from `private/data/`, rejecting
  symlinks, hardlinks and non-regular files before reading them. Raw
  provider JSON, workout logs, feedback history, and token files are not
  deployment assets.
- Vite denies direct filesystem access to `private/`. The development server
  is not an authenticated production server; keep it on loopback.
- The Vercel middleware gates **all** routes, including JSON and JS assets.
  Missing credentials return 503. Basic authentication requires HTTPS.
- Other static hosts do not automatically run Vercel middleware. Do not
  deploy personalized assets to an unprotected host or public Pages site.
- A public repository cannot run the bundled data-writing sync or AI jobs.
  These are repository-visibility guards, not a substitute for access controls
  on a private deployment.

  ## Private-to-public synchronization

  The optional sync workflow is disabled until explicitly configured. It exports
  and audits in a read-only private job, then publishes from an isolated job
  without the private checkout. Only public-source artifacts cross that boundary.
  Destination credentials are scoped to the public repository and are available
  only to the publishing step, not the private export or PR audit jobs.

  The publisher creates generic snapshot commits using public parents; it never
  copies private history or PR metadata. Public PRs require review rather than
  automatic merging. Configure the `public-sync` environment's required reviewers
  and require the independent **Public export privacy audit** check on private
  PRs. Review changes to the scanner, manifests and workflow code as carefully as
  credential-handling changes. See `PUBLIC_TEMPLATE.md` for configuration and the
  public token owner's visible GitHub identity.

## Account credentials

Use separate provider apps for each installation and read-only OAuth scopes.
Whoop uses state plus PKCE; Strava uses state. Callbacks bind only to
`127.0.0.1`. Initial and rotated tokens are saved to the ignored `.env.local`
with owner-only permissions, never printed by the auth helper.

Credential updates are written to an exclusive owner-only sibling file, synced
and closed, then atomically renamed over the validated destination. Partial
writes and sync/rename failures leave existing credential contents intact.

Local secret files are still plaintext. Use full-disk encryption and protect
backups. Filesystem modes have different enforcement on Windows.

CI stores credentials in Actions Secrets. Refresh-token rotation preflights the
GitHub Secrets API before consuming the previous token and persists its
replacement before making further vendor calls. Restrict `GH_PAT` to the
installation repository and the permissions needed by the Secrets API.
Do not expose provider credentials to pull-request workflows.

Data dry runs retain these preflight and token-persistence requirements in CI
as well as locally; disabling dashboard writes must not strand a rotated token.

Garmin Connect uses an unofficial consumer integration. Its token bundle is
base64-encoded, not encrypted. Retain account MFA; omit Garmin if its login
requirements conflict with your account protections.

## AI and notifications

AI prompts and optional escalation webhooks contain health information.
These integrations are not required for local data visualization. Only
configure a destination/provider you trust and consent to share that data with.
Review retention, training opt-outs, billing, and regional requirements.

Model inputs are sanitized and outputs schema-validated. Model-generated
content is rendered as text, not HTML. These controls reduce technical risks;
they do not establish medical accuracy. Do not use readiness or AI guidance
to override symptoms or advice from a qualified professional.

## Operational checklist

1. Keep the data-bearing installation repository private permanently.
2. Enable secret scanning, push protection, dependency updates, and account MFA.
3. Protect every deployment environment and preview with strong credentials.
4. Review access to Actions, deployment logs, artifacts, and backups.
5. Never upload personal screenshots, JSON, prompts, or build outputs to public
   issues or PRs. Use synthetic examples.
6. Review dependency changes and periodically revoke unused authorizations.

If a token leaks, revoke it at the provider immediately, rotate downstream
credentials, and inspect account activity. If it was committed, removing the
latest file is insufficient: coordinate a history cleanup and replace affected
clones. Treat previously published health records as disclosed even after removal.

## Reporting

Use a private GitHub security advisory where available. Do not post credentials
or real health records in a public issue.
