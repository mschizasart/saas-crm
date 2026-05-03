# saas-crm test infrastructure

Top-level home for everything *not* owned by an individual app:

- **smoke** — HTTP probes against a running API/web
- **security** — `pnpm audit`, secret scan, auth/tenant isolation, SQLi, XSS, headers
- **contract** — OpenAPI snapshot diff, response-shape validation
- **migration** — forward / idempotency / data-integrity for `apps/api/prisma/manual-migrations/*.sql`
- **performance** — autocannon API load, web TTI fetch, EXPLAIN spot-checks
- **runner** — unified CLI + HTML dashboard generator
- **dashboard** — static HTML report (rebuilt every run)

Unit / integration / component / E2E tests live in their respective workspace
packages (`apps/api`, `apps/web`). The runner shells out to those and aggregates
results.

## Quick start

```bash
# install
pnpm install

# run everything (API + web should be up; suites that can't reach them skip cleanly)
pnpm test:all

# single category
pnpm test:smoke
pnpm test:security
pnpm test:contract
pnpm test:migration
pnpm test:performance

# watch mode — re-runs the relevant subset on file changes
pnpm test:watch

# open the last HTML report
pnpm test:dashboard
```

## Targets

By default everything points at **local dev**:

| Var               | Default                         | Notes                              |
| ----------------- | ------------------------------- | ---------------------------------- |
| `API_URL`         | `http://localhost:3001`         | Used by smoke/security/contract.   |
| `WEB_URL`         | `http://localhost:3000`         | Used by smoke + performance.       |
| `SMOKE_BASE_URL`  | falls back to `API_URL`         | Override for non-prod dev environments. |
| `SMOKE_TOKEN`     | empty                           | Bearer token for authed probes. Tests requiring it skip cleanly when absent. |
| `TEST_DATABASE_URL` | `postgresql://crm:CrmPass2024!@localhost:5433/crm_test` | Used by migration + perf DB checks. |
| `TEST_JWT_SECRET` | falls back to `JWT_SECRET`      | Used by tenant-isolation auth test to forge tokens. |

**Production is hard-blocked.** `smoke/config.ts` refuses any URL containing
`appoinlycrm.net` (or other prod hostnames) unless you also set
`SMOKE_ALLOW_PROD=1`. None of the suites run against prod by default — this is
local-dev tooling.

## Test database

The migration suites need an isolated Postgres. Two paths:

**(a) one-off container**
```bash
docker run --rm -d --name pg-test -p 5433:5432 \
  -e POSTGRES_USER=crm -e POSTGRES_PASSWORD=CrmPass2024! \
  -e POSTGRES_DB=crm_test postgres:16-alpine
```

**(b) reuse the existing dev postgres**
```bash
psql "$DATABASE_URL" -c 'CREATE DATABASE crm_test'
export TEST_DATABASE_URL=postgresql://crm:crmpassword@localhost:5432/crm_test
```

Each test creates a unique schema and drops it on exit, so the database is
re-usable across runs.

## How the dashboard is built

1. Each suite runs with a JSON reporter (`vitest --reporter=json --outputFile=…`,
   `jest --json --outputFile=…`, `playwright --reporter=json`, or our custom
   autocannon JSON for performance).
2. `runner/parsers.ts` normalises every flavour into a unified
   `{suite, file, name, status, duration, error?}` shape.
3. `runner/dashboard.ts` injects the aggregated payload into
   `dashboard/template.html` (a single string-replace) and writes
   `dashboard/report.html`.

The dashboard has tabs for every category, expandable suite cards, per-test
pass/fail with error stacks, a coverage row (read from
`apps/{api,web}/coverage/coverage-summary.json` if present), and the git commit
hash + last-run timestamp.

The "Rerun" buttons on each suite card are disabled by default — they're
wired for a future `runner serve --port 5050` mode that wasn't built in v1.

## Watch mode mapping

| File pattern                                         | Suites triggered             |
| ---------------------------------------------------- | ---------------------------- |
| `apps/api/src/**/*.ts`                               | unit + integration + contract |
| `apps/web/components/**/*.{ts,tsx}`                  | component                    |
| `apps/web/app/**/*.{ts,tsx}`                         | component + smoke            |
| `apps/api/prisma/manual-migrations/**/*.sql`         | migration                    |
| `test/smoke/**/*.ts`                                 | smoke                        |
| `test/security/**/*.ts`                              | security                     |
| `test/contract/**/*.ts`                              | contract                     |

Debounce is 500ms so saving a batch of files only triggers one run.

## Conventions

- Use **TypeScript with `tsx`** — no compile step.
- Use **Vitest** for the suites we own (smoke, security, contract, migration).
- Use **`commander`** for the CLI.
- Use **`chokidar`** for the watcher.
- Use **`autocannon`** for HTTP perf.
- Test files end in `.test.ts`. Anything else (config, helpers) is ignored.
- All paths in code are absolute or relative to the repo root — no
  `~/...` or relative-to-home paths.

## Updating the OpenAPI snapshot

```bash
UPDATE_SNAPSHOTS=1 pnpm test:contract
```

This rewrites `test/contract/__snapshots__/openapi.json`. Commit the diff
alongside the API change that caused it.
