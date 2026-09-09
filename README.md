# Health Dashboard

A self-hosted health and training dashboard for Whoop, Strava, and optional
Garmin Connect. One installation belongs to one person. The reusable source
can be public; your connected installation, data, and deployment must be private.

The dashboard retains four workspaces: **Today**, **Review**, **Training**, and
**Races**. It includes recovery and sleep trends, training-load analysis,
interactive correlations, activity history, cycling power targets, configurable
training and nutrition references, race planning, and optional AI summaries.

The browser reads generated JSON from its own origin. Provider credentials and
API calls stay in local scripts or private GitHub Actions jobs, not in React.
The example athlete is fictional; it is not a recommended training plan.

## Appearance

Use **Liquid Glass** in the header to enable optional frosted panels, reflective
edges, and a softly tinted backdrop. It works independently of **Light**, **Dark**,
and **System** mode; both preferences are saved locally and synchronized across
tabs. The original appearance remains the default.

The glass treatment uses CSS, not WebGL or Three.js. Charts, metric colors, and
the training decision retain their existing meaning. There is no ambient motion,
and surfaces become opaque when backdrop filtering is unsupported or the system
requests reduced transparency, increased contrast, or forced colors.

## Optional 3D views

Each visualization starts with a readable 2D alternative. The **3D view** toggle loads
Three.js only when requested; color mode and the Liquid Glass surface toggle
remain independent of these views.

- **Today → Recovery lens:** a glass accent mirrors the reported recovery score,
  without introducing another score or recommendation. Missing scores stay missing.
- **Races → Race countdown:** the ring fills over the final 90 calendar days before
  an upcoming event. It measures elapsed time, not training completion or readiness.
- **Training → Weekly plan → Training week:** the miniature follows the selected
  agenda day. Heights encode planned intensity in ordinal steps, not measured load
  or completed workouts; the original session buttons and details remain available.
- **Review → Route & elevation:** import a local GPX file with elevation to explore
  its geometry. Files and coordinates stay in browser memory: nothing is uploaded,
  saved in browser storage, or added to the sync pipeline. Clear the route or leave
  the Review tab to discard it. The plan view, elevation profile and selected-point
  values remain available without WebGL.

GPX file reading, XML parsing, route construction, and projection run in a local
Web Worker, not on the UI thread. Replacing or clearing an import cancels its worker;
leaving Review also discards it. The worker is released after success or failure.

3D views render only on changes, resize, or becoming visible; there is no continuous
animation or automatic camera movement. Training and route views have keyboard-
accessible camera controls. Resolution is capped, resources are released on unmount,
and unavailable/lost WebGL contexts fall back to the 2D view with an explanation.
No external textures, map tiles, or 3D services are used.

The 3D views share a glass studio treatment with local procedural lighting,
in-scene numeric readouts for the rings, and a compact desktop camera dock.
The route grid is a visual reference, not terrain or a map.

## Run locally

Requires Node 24+ and pnpm (the exact version is in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Setup never overwrites existing files. It creates an ignored `.env.local`,
`private/athlete.json`, and empty dashboard data. The first screen has no
connected health history; it does not pretend a sync has occurred.

Before connecting accounts, edit `private/athlete.json` with your own timezone,
profile, program start, weekly schedule, power/heart-rate estimates, goals and
nutrition guidance. All fields are defined and validated in `config/schema.ts`.
Use an IANA timezone such as `Europe/London`. Invalid configuration stops the
build or script instead of silently substituting another athlete.

The example program follows a fixed weekly layout: Monday swim, Tuesday/Thursday
strength, Wednesday mobility, Friday key bike, Saturday endurance bike, Sunday
rest/optional run. The existing training engine still uses these day assignments.
Changing the example into a different kind of scheduling engine is not part of
the template split.

## Connect your accounts

Each person registers their own developer apps and authorizes their own accounts.
This is not a shared OAuth service or a hosted "Sign in with" application.
Only configure the providers you want to use.

| Provider | One-time preparation | Connect locally |
|---|---|---|
| Whoop | Create an app at <https://developer-dashboard.whoop.com>. Set redirect URI to `http://127.0.0.1:8765/callback`. Put `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` in `.env.local`. | `pnpm auth whoop` |
| Strava | Create an app at <https://www.strava.com/settings/api>. Set callback domain to `127.0.0.1`. Put `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` in `.env.local`. | `pnpm auth strava` |
| Garmin | Optional unofficial integration. Set `GARMIN_EMAIL` and `GARMIN_PASSWORD` in `.env.local` for the initial login. | `pnpm auth garmin` |

Whoop/Strava open a local browser authorization flow. Granted tokens are saved
directly into `.env.local` with restricted file permissions, without printing
them. Garmin stores an encoded OAuth token bundle as `GARMIN_TOKEN_JSON`;
base64 is an encoding, **not encryption**. After a successful token-based sync,
remove the Garmin email/password if no longer needed.

Garmin's consumer integration is unofficial and can be rate-limited or blocked
by its login/MFA requirements. Do not disable account MFA just to use this
optional integration; use Whoop/Strava if your Garmin account cannot connect
safely. Provider developer-app policies may impose additional restrictions.

```bash
pnpm sync
pnpm dev
```

Local sync persists rotated refresh tokens back into `.env.local`. That file
must remain writable. Never prefix a credential with `VITE_`, paste it into
athlete configuration, or add it to a Git commit.

`pnpm sync:dry` disables data-file writes, not provider requests. Rotated
credentials must still be preflighted and saved, locally or in Actions Secrets,
because a provider can invalidate the old token during the request.

## Private deployment and scheduled sync

Read [SECURITY.md](./SECURITY.md) first. The automated storage design commits
health data to a **private installation repository**. Public forks can build
and run locally, but data-writing workflows refuse to run in public repositories.

1. Create a new **private** repository from the public source (not a public
   fork for storing your health data). Keep its visibility private permanently.
2. Add only your provider's client ID, client secret and refresh token to
   GitHub Actions Secrets; for Garmin use `GARMIN_TOKEN_JSON`.
3. For Whoop/Strava token write-back, set `GH_PAT` to a fine-grained token scoped
   to that private repo with Secrets read/write access. Check the Secrets API
   preflight before relying on scheduled sync.
4. In that private repository only, explicitly track the configuration and data:
   `git add -f private/athlete.json private/data/`. They are ignored by default
   to protect people working in public clones. Keep `.env.local` untracked.
5. Deploy the **private installation** to Vercel. Configure `DASHBOARD_USER`
   and a strong `DASHBOARD_PASS` in every deployed environment. The middleware
   fails closed when either is missing and gates HTML, JavaScript, and JSON.
6. Run **Daily sync** manually, then enable scheduled workflows as desired.
   **Run all** chains sync and AI tasks. Review AI privacy below before enabling
   any AI workflow. CI uses the timezone in `private/athlete.json`; an explicit
   `USER_TIMEZONE` can override script date calculations locally.

Vercel rebuilds from private data commits. Raw vendor histories and local logs
are **not** copied into `dist/`; only the dashboard's named derived artifacts
are emitted under `dist/data/`. Those derived artifacts and the configured
training content are still sensitive and require the authentication wall.
Do not publish `dist/` to GitHub Pages or an unprotected static host.

The Vite development server is loopback-only by default and does not implement
production authentication. Do not expose it through a tunnel or `--host`.

## Daily use

```bash
pnpm log lift             # record a strength session
pnpm log bike             # record prescribed versus actual cycling work
pnpm log rpe              # record session effort
pnpm log show             # inspect local logs
RECOMPUTE=1 pnpm sync     # regenerate analytics without fetching providers
```

Logs, race calendars, histories, and AI output live under `private/data/`.
The frontend continues to use `/data/*.json`; storage paths are not browser URLs.

## Optional AI guidance

Without an LLM provider, local generators use deterministic templates.
Set the appropriate variables from `.env.example` only after deciding which
provider may receive your health information. GitHub Actions AI workflows use
Copilot CLI and require a compatible subscription/token configuration.
Prompts include sensitive metrics and training context; review the provider's
retention and training settings before enabling them.

```bash
pnpm ai insights
pnpm ai all
pnpm ai insights --print-prompt   # prints sensitive health context locally
```

See [COACH.md](./COACH.md) for the manual coach workflow. AI output is
schema-validated, but that does not make it medical advice.

## Architecture and public distribution

| Layer | Location | Distribution |
|---|---|---|
| React UI and domain rules | `src/`, `utils/` | Public reusable source |
| Provider adapters, analytics, local OAuth | `scripts/` | Public reusable source |
| Config schema and fictional example | `config/` | Public reusable source |
| Athlete settings | `private/athlete.json` | Local/private installation only |
| Vendor history, logs, artifacts | `private/data/` | Local/private installation only |
| Credentials | `.env.local` / Actions Secrets | Never committed |
| Rendered dashboard artifacts | `dist/data/` | Authenticated deployment only |

Node resolves `#athlete-config` through the validated filesystem loader. Vite
resolves that same import to validated configuration data, without bundling the
Node filesystem/provider layer. Tests use the fictional configuration and
synthetic health fixtures, independent of an installation's private data.

**Never change a personal repository's visibility or push its existing history
to a public remote.** Use the source-only export described in
[PUBLIC_TEMPLATE.md](./PUBLIC_TEMPLATE.md).

Development stays in the private repository. The optional **Sync public
template** workflow creates or updates one reviewed public PR after private PRs
merge, using only audited export files and public Git history. It is disabled
until the destination and destination-scoped token are configured. See
[Maintaining both versions](./PUBLIC_TEMPLATE.md#maintaining-both-versions).

## Development

React 19, Vite, TypeScript, Tailwind, Recharts/selective D3, Zod, and Vitest.

```bash
pnpm test
pnpm typecheck
pnpm build
```

Every opened, updated, reopened or ready-for-review PR also runs the independent
**Public export privacy audit** job, even when tests or the build fail.
PR checks run without provider credentials. Do not use real athlete records in
fixtures, screenshots, example configuration, or documentation. There is no
telemetry or shared multi-user backend.
