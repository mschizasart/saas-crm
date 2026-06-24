/**
 * Seed default data for a single organization.
 *
 * Called from:
 *   - prisma/seed.ts (CLI) via `ORGANIZATION_ID=xxx pnpm seed`
 *   - AuthService.registerOrganization() right after org creation
 *
 * All operations are idempotent via upsert / findFirst+create.
 */
import { PrismaClient } from '@prisma/client';

export const ALL_PERMISSIONS = {
  clients: { view: true, create: true, edit: true, delete: true },
  leads: { view: true, create: true, edit: true, delete: true },
  invoices: { view: true, create: true, edit: true, delete: true, send: true },
  estimates: { view: true, create: true, edit: true, delete: true, send: true },
  proposals: { view: true, create: true, edit: true, delete: true },
  payments: { view: true, create: true, edit: true, delete: true },
  expenses: { view: true, create: true, edit: true, delete: true },
  projects: { view: true, create: true, edit: true, delete: true },
  tasks: { view: true, create: true, edit: true, delete: true },
  tickets: { view: true, create: true, edit: true, delete: true, assign: true },
  contracts: { view: true, create: true, edit: true, delete: true },
  users: { view: true, create: true, edit: true, delete: true },
  roles: { view: true, create: true, edit: true, delete: true },
  // `view` is the legacy canned-reports permission. Wave D2 (builder)
  // adds `create / edit / delete` so admins can manage saved report
  // definitions and dashboards.
  reports: { view: true, create: true, edit: true, delete: true },
  settings: { view: true, edit: true },
  // Sequences / cadences (migration 043) — multi-step follow-up flows.
  // 'view' read; 'create' new sequences; 'edit' steps/lifecycle;
  // 'delete' draft sequences; 'execute' enroll/unenroll recipients;
  // 'configure' reserved for future admin-only settings.
  sequences: {
    view: true,
    create: true,
    edit: true,
    delete: true,
    execute: true,
    configure: true,
  },
  // Opportunities (deal pipeline + weighted forecast — migration 027)
  opportunities: {
    view: true,
    create: true,
    edit: true,
    delete: true,
    configure: true,
  },
  // ── Wave D3: Custom Objects (migration 029) ──
  // 'custom-objects.*' gates the schema-config endpoints (define an
  // object, add/edit/delete fields). 'custom-records.*' gates the
  // tenant data layer (rows). Admins get both by default; non-admin
  // roles need explicit grants per object family.
  'custom-objects': { view: true, configure: true },
  'custom-records': { view: true, create: true, edit: true, delete: true },
  // ── Wave E2: Field history / audit trail (migration 031) ──
  // 'audit.view' gates all three read endpoints (per-entity timeline,
  // org-wide feed, by-user). There's no write permission — audit rows
  // are produced automatically by the Prisma extension and are not
  // mutable from any endpoint.
  audit: { view: true },
  // ── Wave E1: Approvals (migration 030) ──
  // 'view'      — read processes + requests + decisions.
  // 'configure' — create/edit/delete process definitions (settings page).
  // 'request'   — submit a new approval request, cancel your own.
  // 'decide'    — approve/reject a step (also gated by the step's
  //               approverUserId / approverRoleId eligibility check).
  approvals: { view: true, configure: true, request: true, decide: true },
  // ── Wave E3: Public REST API + Webhooks (migration 032) ──
  // 'api.manage' gates the public-API-key CRUD endpoints
  // (/settings/api-keys). 'webhooks.manage' gates the outbound webhook
  // CRUD + delivery-history endpoints (/settings/webhooks). Admin-only
  // by default; non-admin roles need explicit grants.
  api: { manage: true },
  webhooks: { manage: true },
  // ── Wave F3: Multi-currency + daily FX rates (migration 035) ──
  // 'fx.view'      — see stored rates + run convert().
  // 'fx.configure' — manual rate overrides + force ECB refresh.
  // Currencies list (GET /fx/currencies) is public — no perm needed.
  fx: { view: true, configure: true },
  // ── Wave F2: CPQ — Configure-Price-Quote (migration 034) ──
  // 'view'      — read quotes + bundles.
  // 'create'    — create new quotes (also gates duplicate).
  // 'edit'      — modify drafts + status transitions
  //               (mark-accepted / mark-rejected / convert-to-invoice).
  // 'delete'    — delete a draft quote.
  // 'send'      — send a quote to a client.
  // 'configure' — admin-only: manage Product Bundles
  //               (CRUD under /settings/product-bundles).
  quotes: {
    view: true,
    create: true,
    edit: true,
    delete: true,
    send: true,
    configure: true,
  },
  // ── Wave G2: Territories (migration 037) ──
  // 'view'      — list / read territories, members, assignments,
  //               hierarchy + reverse-lookup endpoints.
  // 'configure' — admin-only: create/update/delete territories,
  //               manage members + assignments. No separate
  //               create/edit/delete keys — territory management
  //               is a single concern owned by sales-ops admins.
  territories: { view: true, configure: true },
  // ── Wave G1: Hierarchical record sharing (migration 036) ──
  // Scopes list endpoints (leads, opportunities, ...) by ownership
  // along the org chart. Resource key is 'records.sharing'; actions
  // are the visibility levels:
  //   'team'      — sees records owned by self + direct reports.
  //   'hierarchy' — sees records owned by self + ALL transitive
  //                 reports (whole subtree).
  //   'all'       — sees everything (admin / super-grant). Equivalent
  //                 to the legacy behaviour before G1 shipped — no
  //                 scoping is applied.
  // Default grants: Admin gets all three; Sales gets 'team' (a sales
  // manager naturally sees their direct team's deals).
  'records.sharing': { team: true, hierarchy: true, all: true },
  // ── Wave G3: Chatter-style internal feed + @mentions (migration 038) ──
  // 'view'      — read the feed on any record + the "my mentions" inbox.
  // 'create'    — post notes & replies, @mention teammates.
  // 'edit_own'  — edit your OWN posts within a 5-min window; soft-delete
  //               your own posts at any time. The window is enforced
  //               server-side (FeedService.update); the UI hides the
  //               button as a UX courtesy only.
  // 'moderate'  — admin/ops can soft-delete ANYONE'S post (e.g. takedown
  //               inappropriate content). Admin-only by default; all
  //               other roles get view + create + edit_own only.
  feed: { view: true, create: true, edit_own: true, moderate: true },
  // ── Wave H1: Field Service — work orders + dispatch (migration 039) ──
  // 'view'      — read work orders + dispatch board.
  // 'create'    — create a new draft work order.
  // 'edit'      — modify non-terminal WOs + cancel them.
  // 'delete'    — delete a DRAFT WO (any other status: cancel instead).
  // 'schedule'  — assign technicians + windows (dispatch board write).
  // 'execute'   — start / complete a WO (the technician's permission;
  //               the service also requires the caller to be the
  //               assigned tech OR hold `manage`).
  // 'manage'    — dispatcher override: start/complete on a tech's
  //               behalf (admin / lead dispatcher). Admin-only by default.
  'field-service': {
    view: true,
    create: true,
    edit: true,
    delete: true,
    schedule: true,
    execute: true,
    manage: true,
  },
  // ── Wave H3: Bulk API + CSV import (migration 041) ──
  // 'view'         — list past bulk-operation runs + read details
  //                  (drives the "Bulk Imports" admin page).
  // 'clients'      — bulk-create / bulk-update / bulk-delete clients,
  //                  plus CSV import.
  // 'leads'        — same surface for leads.
  // 'opportunities'— same surface for opportunities.
  // 'tasks'        — same surface for tasks.
  // Admin gets the whole namespace. Sales gets view + leads +
  // opportunities (the entities a non-admin sales rep typically owns
  // the bulk lifecycle for). Staff has no bulk grants by default.
  bulk: {
    view: true,
    clients: true,
    leads: true,
    opportunities: true,
    tasks: true,
  },
};

export async function seedOrganization(
  prisma: PrismaClient,
  organizationId: string,
) {
  // ─── Roles ───────────────────────────────────────────────
  const roles = [
    { name: 'Admin', permissions: ALL_PERMISSIONS },
    {
      name: 'Staff',
      permissions: {
        clients: { view: true },
        invoices: { view: true, send: true },
        projects: { view: true },
        tickets: { view: true, create: true, edit: true, assign: true },
        leads: { view: true },
        estimates: { view: true, create: true, edit: true, delete: true, send: true },
        proposals: { view: true, create: true, edit: true, delete: true },
        users: { view: true },
        // Wave G3 — everyone collaborates on the record feed; only
        // admins get the moderate flag (to take down inappropriate
        // posts).
        feed: { view: true, create: true, edit_own: true },
        // Sequences — staff can see cadences but not build/run them.
        sequences: { view: true },
      },
    },
    {
      name: 'Sales',
      permissions: {
        leads: { view: true, create: true, edit: true, delete: true },
        clients: { view: true, create: true, edit: true, delete: true },
        invoices: { view: true, create: true, edit: true, delete: true, send: true },
        estimates: { view: true, create: true, edit: true, delete: true, send: true },
        proposals: { view: true, create: true, edit: true, delete: true },
        // Opportunities — sales reps own deals but don't reconfigure the pipeline
        opportunities: { view: true, create: true, edit: true, delete: true },
        // CPQ — sales reps create + send quotes but don't manage Product Bundles
        // (which is admin-curated catalog work).
        quotes: { view: true, create: true, edit: true, delete: true, send: true },
        users: { view: true },
        // Wave G1 — sales managers see their direct team's records.
        // Hierarchy + all are admin-only; Sales gets 'team' so a
        // first-line manager naturally sees their reports' leads /
        // opportunities without seeing the whole org's pipeline.
        'records.sharing': { team: true },
        // Wave G3 — sales reps post freely on record feeds + @mention
        // teammates. Moderation stays admin-only.
        feed: { view: true, create: true, edit_own: true },
        // Wave H3 — sales reps can bulk-manage their own pipeline
        // (leads + opps). No clients / tasks bulk by default — those
        // are admin or ops concerns.
        bulk: { view: true, leads: true, opportunities: true },
        // Sequences — sales reps build cadences and enroll their pipeline,
        // but don't get delete (draft cleanup is an admin concern).
        sequences: { view: true, create: true, execute: true },
      },
    },
  ];
  for (const r of roles) {
    await prisma.role.upsert({
      where: {
        organizationId_name: { organizationId, name: r.name },
      },
      update: { permissions: r.permissions },
      create: {
        organizationId,
        name: r.name,
        permissions: r.permissions,
      },
    });
  }

  // ─── Currencies ──────────────────────────────────────────
  const currencies = [
    { name: 'USD', symbol: '$', isDefault: true },
    { name: 'EUR', symbol: '€', isDefault: false },
    { name: 'GBP', symbol: '£', isDefault: false },
    { name: 'JPY', symbol: '¥', isDefault: false },
  ];
  for (const c of currencies) {
    const existing = await prisma.currency.findFirst({
      where: { organizationId, name: c.name },
    });
    if (!existing) {
      await prisma.currency.create({
        data: { organizationId, ...c },
      });
    }
  }

  // ─── Taxes ───────────────────────────────────────────────
  const taxes = [
    { name: 'VAT 20%', rate: 20 },
    { name: 'VAT 10%', rate: 10 },
    { name: 'No Tax', rate: 0 },
  ];
  for (const t of taxes) {
    const existing = await prisma.tax.findFirst({
      where: { organizationId, name: t.name },
    });
    if (!existing) {
      await prisma.tax.create({
        data: { organizationId, name: t.name, rate: t.rate },
      });
    }
  }

  // ─── Payment Modes ───────────────────────────────────────
  const paymentModes = [
    { name: 'Bank Transfer', gatewayClass: 'manual' },
    { name: 'Stripe', gatewayClass: 'stripe' },
    { name: 'PayPal', gatewayClass: 'paypal' },
    { name: 'Cash', gatewayClass: 'manual' },
  ];
  for (const pm of paymentModes) {
    const existing = await prisma.paymentMode.findFirst({
      where: { organizationId, name: pm.name },
    });
    if (!existing) {
      await prisma.paymentMode.create({
        data: { organizationId, ...pm },
      });
    }
  }

  // ─── Ticket Departments ──────────────────────────────────
  for (const name of ['Support', 'Billing', 'Sales']) {
    const existing = await prisma.department.findFirst({
      where: { organizationId, name },
    });
    if (!existing) {
      await prisma.department.create({ data: { organizationId, name } });
    }
  }

  // ─── Expense Categories ──────────────────────────────────
  for (const name of ['Office', 'Travel', 'Software', 'Marketing', 'Meals']) {
    const existing = await prisma.expenseCategory.findFirst({
      where: { organizationId, name },
    });
    if (!existing) {
      await prisma.expenseCategory.create({
        data: { organizationId, name },
      });
    }
  }

  // ─── Lead Statuses ───────────────────────────────────────
  const statuses = [
    { name: 'New', color: '#3b82f6', position: 1 },
    { name: 'Contacted', color: '#8b5cf6', position: 2 },
    { name: 'Qualified', color: '#06b6d4', position: 3 },
    { name: 'Proposal', color: '#eab308', position: 4 },
    { name: 'Negotiation', color: '#f97316', position: 5 },
    { name: 'Won', color: '#10b981', position: 6 },
    { name: 'Lost', color: '#ef4444', position: 7 },
  ];
  for (const s of statuses) {
    const existing = await prisma.leadStatus.findFirst({
      where: { organizationId, name: s.name },
    });
    if (!existing) {
      await prisma.leadStatus.create({
        data: {
          organizationId,
          name: s.name,
          color: s.color,
          position: s.position,
          isDefault: s.name === 'New',
        },
      });
    }
  }

  // ─── Lead Sources ────────────────────────────────────────
  for (const name of [
    'Website',
    'Referral',
    'Cold Call',
    'Email',
    'Social Media',
  ]) {
    const existing = await prisma.leadSource.findFirst({
      where: { organizationId, name },
    });
    if (!existing) {
      await prisma.leadSource.create({ data: { organizationId, name } });
    }
  }

  // ─── Opportunity Stages (default pipeline) ──────────────
  // Canonical Salesforce-style 6-stage pipeline. The whole block is
  // skipped if ANY stage already exists for the org, so we don't add
  // ours alongside a customised pipeline the user has already tailored.
  // Migration 027 ships an idempotent backfill for prod-side parity.
  const existingStageCount = await prisma.opportunityStage.count({
    where: { organizationId },
  });
  if (existingStageCount === 0) {
    const stages = [
      { name: 'Prospecting', order: 1, probability: 20, isWon: false, isLost: false },
      { name: 'Qualified',   order: 2, probability: 40, isWon: false, isLost: false },
      { name: 'Proposal',    order: 3, probability: 60, isWon: false, isLost: false },
      { name: 'Negotiation', order: 4, probability: 80, isWon: false, isLost: false },
      { name: 'Closed Won',  order: 5, probability: 100, isWon: true,  isLost: false },
      { name: 'Closed Lost', order: 6, probability: 0,   isWon: false, isLost: true  },
    ];
    for (const s of stages) {
      await prisma.opportunityStage.create({
        data: {
          organizationId,
          name: s.name,
          order: s.order,
          probability: s.probability,
          isWon: s.isWon,
          isLost: s.isLost,
        },
      });
    }
  }

  return { seeded: true, organizationId };
}
