# Session Notes — April 2026

Long Claude Code session that turned a string of production 500s into a substantially improved codebase. This file captures what changed, how, and what's still outstanding so a future session (or a new teammate) can pick up without re-excavating the history.

## What this project is

Multi-tenant SaaS CRM, migrated from a CodeIgniter PHP app at `/home/marios/Documents/Project/Crm` to a Next.js 14 + NestJS + Prisma + Postgres stack at `/home/marios/Documents/Project/saas-crm`. Live at https://www.appoinlycrm.net.

## Stack & layout

- **Monorepo**: pnpm workspace + Turbo.
- **API** (`apps/api`): NestJS + Prisma + Postgres. Row-level security via a `TenantInterceptor` that calls `set_config('app.current_organization_id', ...)` at the start of every tenant-scoped request. Every controller reads `@CurrentOrg()` for the org; `@CurrentUser()` for the user.
- **Web** (`apps/web`): Next.js 14 App Router. Admin at `(admin)/*`, client portal at `(portal)/*`, auth at `(auth)/*`, platform superadmin at `(platform)/*`.
- **Infra**: single VPS at `178.105.2.197`, Docker Compose at `/opt/saas-crm/docker-compose.yml`. nginx reverse-proxies on the host (not containerized). Postgres + Redis + MinIO + api + web are the five containers.

## Root causes we found (categorized)

Same bug class kept recurring. In order of frequency:

### 1. Prisma ↔ Service field drift
Service files wrote/read columns or relations that weren't in the schema. Manifests as `PrismaClientValidationError` → 500.

Examples caught: `contracts.service.ts` had a `creator` include that didn't exist. `estimates.service.ts` wrote `quantity/unitPrice/taxRate/total` — schema has `qty/rate/tax1/tax2` (no `total`). `credit-notes.service.ts` had the same + a `createdByUser` include and `'voided'` vs schema `'void'`. `leads.service.ts` wrote `LeadNote` with `note/addedById` — schema is `content/userId`. Payments selected `currency.code` — Currency had no `code` column. Contracts scalar fields `content/status/type/createdBy/signatureData/signedByName/signedByEmail` all missing from schema.

Canonical fix: either add the columns (we did for Contract + Currency.code + Payment.paymentMode relation) or rename in the service. For line items we used a `normalizeItems()` helper that accepts legacy DTO names and maps to schema-native names at Prisma boundary.

### 2. Frontend ↔ API contract mismatch
Service returns X, TypeScript interface on the page types Y. Runtime: `STATUS_STYLES[lead.status]` where `lead.status` is `{id, name, color}` not a string → `undefined.header` → whole component crashes.

Examples: leads kanban (`status` object), subscriptions (`frequency/amount` didn't exist), staff (`isActive` vs `active`), credit-notes (`subtotal/taxTotal` vs `subTotal/totalTax`), proposals (`totalValue` vs `total`, `assignedTo` didn't exist on model), goals (`status` not a field — derive from `achievedAt`), invoices/estimates detail + list + edit on line items (`quantity/unitPrice/taxRate` → `qty/rate/tax1`).

Fixed ~40 pages. Introduced `leadStatusKey(lead)` normalizer for the one case where we need both to coexist.

### 3. Permission string not in seed
Controller annotated `@Permissions('estimates.edit')` but `seed-org.ts` doesn't grant it to any default role → Staff/Manager/Sales get 403. Admin bypasses via `isAdmin`.

Missing: `estimates.edit/send`, `proposals.edit`, `invoices.send`, `tickets.assign`, whole `users.*` namespace. Fixed in seed + backfilled existing role rows via SQL.

### 4. Wrong Prisma accessor
Code had `this.prisma.client.X` treating the Client model delegate as a namespace. Broke `leads/web-form` (public endpoint!), task dependency checker, etc. Fixed to `this.prisma.X`.

### 5. Tenant scope missing
`findFirst({ where: { id } })` without `organizationId` constraint. Any cross-tenant UUID leak allows cross-org reads/mutations. Fixed in `tasks.checkCircular`, `todos.ownedTodo`.

### 6. Next.js `rewrites()` + build-time env
Rewrites run at build time in standalone mode — env vars read there get inlined. `API_URL` was runtime-only, so the fallback `http://localhost:3001` baked into the image. Fix: add `API_URL` as a Dockerfile `ARG` + docker-compose build arg. Also scoped the rewrite from `/api/:path*` to `/api/v1/:path*` so NextAuth's own `/api/auth/*` doesn't get swallowed.

### 7. nginx route config
`/socket.io/` was proxied to the web container (:3000) but the NestJS WebSocket gateway lives on the api container (:3001). Added an explicit `location /socket.io/` block with websocket upgrade headers.

### 8. Tenant interceptor not wired up
`TenantInterceptor` was defined but never registered via `APP_INTERCEPTOR` → `@CurrentOrg()` returned `undefined` on every tenant-scoped request → `org.id` throws → every list/detail endpoint 500s. Registered globally in `app.module.ts`.

### 9. Prisma `SET LOCAL` with parameter
`prisma.service.ts` used `$executeRaw\`SET LOCAL app.current_organization_id = ${id}\`` — Postgres doesn't accept parameter placeholders in `SET LOCAL`. Replaced with `SELECT set_config('app.current_organization_id', ${id}, true)` which is parameterized and equivalent to `SET LOCAL`.

## What we built / added

### API
- Leads: DTO transform (status/source names → FK IDs, `budget` → `value`, drop stray `position`)
- Apply-credit-note-to-invoice, bill-expenses-to-invoice, invoice merge, bulk PDF export
- Batch payments endpoint + refund flow
- Subscription billing scheduler (generates invoices, advances nextInvoiceAt)
- Milestone `status` column + kanban persistence
- `PATCH /estimates/:id/status` + `PATCH /proposals/:id/status`
- User-level permission overrides (new table + RBAC guard union)
- Portal contact register, statement date range, email-change flow (all gated on new columns)
- Receipt PDF, credit-note PDF
- Credit-notes accessible to portal contacts, calendar filtered by contact's clientId, announcements `audience=portal` synonym + history
- Expense categories CRUD
- Recurring invoices management (stop, generate-now)
- Project notes endpoints

### DB migrations applied (all additive, nullable where applicable)
- `users.pendingEmail / pendingEmailToken / pendingEmailExpires`
- `client_subscriptions.interval / intervalCount / nextInvoiceAt`
- `payments.refundedAt / refundedAmount / refundReason`
- `milestones.status`
- `expense_categories.color`
- `credit_notes.appliedTotal`
- `user_permission_overrides` table (new, +2 indexes)
- `contracts.content / type / status / createdBy / signatureData / signedByName / signedByEmail`
- `currencies.code` (backfilled from `name` where it looked like an ISO code)

### Web
- `lib/api.ts` — `apiFetch()` with single-flight 401 refresh + redirect to `/login?next=…`
- 13 shared components under `components/ui/`: Button, Card (+ Header/Body/Footer), Badge, StatusBadge, FormField (+ `inputClass`), PasswordInput, Spinner, TableSkeleton, EmptyState, ErrorBanner, PageHeader, DataTable, `useModalA11y` hook
- 5 layout wrappers under `components/layouts/`: ListPageLayout (with `fullHeight` prop for kanbans), DetailPageLayout, FormPageLayout, ComplexFormPageLayout (for invoice/estimate builders), SettingsPageLayout (+ SettingsSection)
- `lib/ui-tokens.ts` — typography / containerWidth / spacing / statusColors tokens
- Theme hook + no-flash inline script + sidebar theme toggle (3-state: light/dark/system)
- Dark mode: shared components + layouts + admin chrome + mechanical sweep across 147 files (~2,621 dark variants)
- Modal a11y: focus trap, ESC-to-close, `role="dialog"`, `aria-modal`, scroll lock, focus restore. Applied to 9 modals.
- Responsive: tablet column hiding on 11 list pages (`hidden lg:table-cell`), mobile card views for tickets/leads/projects, fixed nested `grid-cols-2` in invoices/new, 44px hamburger hit target
- New portal pages: forgot-password, reset-password, register (flags: uses org-signup endpoint; dedicated contact-register API exists but no UI yet), profile, statement, announcements, payments, credit-notes list+detail, calendar
- Public pages: privacy-policy, terms-of-service, consent
- Frontend field renames (many): `company_name → company`, `is_active → active`, `vatNumber → vat`, `quantity → qty`, `unitPrice → rate`, `taxRate → tax1`, `subtotal → subTotal`, `taxTotal → totalTax`, `totalValue → total`, `isActive → active`, `twoFactorEnabled → twoFaEnabled`, `frequency → interval + intervalCount`, etc.

### Pages refactored into shared components & layouts
- 37 admin list pages use the shared components (Button/Card/Badge/etc.)
- 27 wrapped in `ListPageLayout`
- 13 detail pages in `DetailPageLayout`
- 12 simple forms in `FormPageLayout`
- 5 complex forms (invoice/estimate/credit-note new + edit) in `ComplexFormPageLayout`
- 21 settings pages in `SettingsPageLayout`

### Infra
- `docker-compose.yml`: added `API_URL` build arg + runtime env so web container can talk to `api:3001`
- `apps/web/Dockerfile`: `ARG API_URL` + `ENV API_URL=$API_URL`
- `apps/web/next.config.mjs` + `.ts`: rewrites scoped to `/api/v1/*` only (was `/api/:path*`, swallowed NextAuth)
- nginx `/socket.io/` → `:3001` with ws upgrade headers

## E2E test suite (new, 131 tests, zero existing before)

At `apps/web/e2e/`:
- `auth.spec.ts` — staff login lands on `/dashboard`
- `clients.spec.ts` — list renders, create → appears in list
- `leads.spec.ts` — kanban renders without crash (this was a real prod bug), create → appears in New column
- `invoices.spec.ts` — list renders, create with line item → appears on detail
- `portal.spec.ts` — portal login + portal dashboard (skipped if no portal creds)
- `settings.spec.ts` — Company tab renders, Email tab switches + SMTP field appears
- `dashboard-visual.spec.ts` — full-page screenshot regression with dynamic content masked
- `admin-smoke.spec.ts` — 88 admin routes, one test each, asserts "no console error" and "no visible error banner"
- `api-smoke.spec.ts` — 32 GET endpoints return 2xx

Helpers:
- `fixtures.ts` — `loggedInPage` fixture that does UI login OR token injection via `E2E_TOKEN` env
- Noise filter in admin-smoke excludes known harmless async errors (RSC prefetch fallbacks, socket.io connection, NextAuth session 404s)

CI: `.github/workflows/e2e-prod.yml` runs on push to `main`/`master` + manual dispatch. Needs repo secrets `E2E_EMAIL` + `E2E_PASSWORD` (and optional `E2E_PORTAL_EMAIL` / `E2E_PORTAL_PASSWORD`).

Local run:
```bash
cd apps/web
E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e               # local dev via webServer
E2E_BASE_URL=https://www.appoinlycrm.net \
E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e:prod          # against prod
pnpm e2e:ui                                            # interactive step-through
```

Token-injection mode for CI without exposing passwords: sign a JWT on the server with the JWT_SECRET, set `E2E_TOKEN=<jwt>`, run; the fixture skips the UI login and seeds `localStorage`. See the `SSH_ASKPASS` one-off in Bash history for signing example.

## Current state (end of session)

- 120/120 smoke tests green against prod
- 242 files committed in `a6fa4a0` on `origin/master`
- Rebased cleanly on top of upstream commit `2425262` (Fix TenantInterceptor)

## Open items — YOUR action required

### Security (do these immediately)
1. **Rotate the GitHub PAT.** The old token (starting `gho_RCIXt…`) was in your local git config and got exposed during this session. Revoke at https://github.com/settings/tokens. Generate a new one scoped to just this repo, or switch to SSH auth: `git remote set-url origin git@github.com:mschizasart/saas-crm.git`.
2. **Rotate the root SSH password** on `178.105.2.197`. It was pasted in chat. Consider disabling password auth entirely and switching to SSH keys.

### CI setup
3. Set GitHub repo secrets: `E2E_EMAIL`, `E2E_PASSWORD`. (Optional: `E2E_PORTAL_EMAIL`, `E2E_PORTAL_PASSWORD`.) Once set, the e2e workflow runs on every push.

### Visual baseline
4. On first local run of `pnpm e2e`, Playwright creates `e2e/__screenshots__/dashboard.png` as the baseline. Commit that file. Subsequent runs catch visual regressions against it.

## Deferred features / known limitations

- **Portal register** currently creates a new SaaS org, not a contact under an existing org. A dedicated `POST /auth/portal/register` endpoint was added on the API but has no matching UI flow that collects `organizationSlug`.
- **Profile email is read-only** on the portal. Change flow is built (`POST /users/me/email-change` + `POST /users/confirm-email`) but needs UI wire-up.
- **Subscription scheduler** generates invoices correctly but there's no dunning/proration/retry logic. Failed invoice generation just logs and skips.
- **Milestones kanban** drag-drop column resolution was augmented with a schema `status` field but `in_progress` cards remain dependent on client-side derivation for the transitional window.
- **PHP → SaaS parity gaps**: ~14 feature areas fully missing, ~20 partial. Notable: 7 additional payment gateways (only Stripe/PayPal/Mollie present), SMTP/OAuth settings UI, bulk PDF (built!) + invoice merge (built!) + batch payments (built!) + refund (built!), per-user permission overrides UI (built!). Reports: Knowledge Base / Payment Modes reports missing. Consent / privacy / terms public pages stubbed, no settings-driven content yet. Localization: 4 languages vs 29 in PHP.
- **`apps/web/e2e/` and `.github/workflows/` were local-only** until the final commit pushed them. CI won't see them on any earlier branch.

## Gotchas worth remembering

### rsync pollution
If you ever run `rsync -az src1/ src2/ src3/ target:/x/` with multiple source paths, rsync dumps the CONTENTS of all three sources into `target/` — creating duplicates. Happened during this session; took a pre-commit cleanup pass to remove the orphaned files before `git add`. Always use single-source rsyncs or explicit `--relative`.

### Docker build args vs runtime env
Anything Next.js `next.config.mjs` reads via `process.env.X` gets inlined at build time in standalone mode. If you change that env var at runtime it won't take effect until you rebuild. Either set it as a Docker build arg or restructure the code to read env inside a request handler (runtime).

### docker-compose has two API_URL sources
Build arg AND runtime env. Both defaults are the same. Keep them in sync or remove one.

### Branch name
Default branch on this repo is `master`, not `main`. The e2e workflow triggers on both but other tooling should match.

### Postgres has two Prisma-compatible ways to set session variables
- `SET LOCAL name = value` — cannot be parameterized
- `SELECT set_config('name', value, true)` — parameterized, scoped to current transaction (same semantic as SET LOCAL)

Use the second. Don't use the first with Prisma `$executeRaw\`SET LOCAL name = ${x}\`` — it's a syntax error.

## Custom Claude agents installed

At `~/.claude/agents/`:

- `tester` — writes + runs tests
- `debugger` — root-cause bugs, reproduce → isolate → fix
- `deployer` — docker/prisma/nginx/ssh deploys; knows our prod layout
- `security-auditor` — auth / input / crypto / PII review (runs on opus)
- `ui-reviewer` — visual / a11y / responsive review; knows our design system
- `code-reviewer` — correctness / design / readability
- `performance` — N+1, bundle bloat, DB indexes

Either name them explicitly or let Claude auto-select based on the `description` field.

## Useful paths & commands

```bash
# Live prod smoke
cd apps/web
E2E_BASE_URL=https://www.appoinlycrm.net \
E2E_EMAIL=mschizas@fletcher.com.cy \
E2E_PASSWORD='...' \
pnpm e2e:prod

# Rebuild a single service on prod (from VPS /opt/saas-crm)
docker compose build api && docker compose up -d api

# Sign a test JWT on prod for API probing (no browser needed)
docker compose exec -T api node -e "const jwt=require('/app/node_modules/.pnpm/jsonwebtoken@9.0.3/node_modules/jsonwebtoken'); process.stdout.write(jwt.sign({sub:'USER_UUID',orgId:'ORG_UUID',type:'staff',aud:'staff',isAdmin:true},'JWT_SECRET_FROM_ENV',{expiresIn:'30m'}));"

# Check prod DB tables / migrations
docker compose exec -T postgres psql -U crm -d crm -c "\\dt"
```

## JWT_SECRET reminder

Prod JWT secret lives in `/opt/saas-crm/.env` as `JWT_SECRET=…`. **Never commit this.** Currently: `jwt-secret-appoinlycrm-2026-super-long-32chars-hetzner` — good length, but consider rotating alongside the other credentials.

## One-line session summary

Started with a production 500 on `/clients`, ended with 120 green smoke tests, a shared-component design system, dark mode, an e2e CI pipeline, 9 DB migrations, and a substantially hardened codebase.
