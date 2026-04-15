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
  invoices: { view: true, create: true, edit: true, delete: true },
  estimates: { view: true, create: true, edit: true, delete: true },
  proposals: { view: true, create: true, edit: true, delete: true },
  payments: { view: true, create: true, edit: true, delete: true },
  expenses: { view: true, create: true, edit: true, delete: true },
  projects: { view: true, create: true, edit: true, delete: true },
  tasks: { view: true, create: true, edit: true, delete: true },
  tickets: { view: true, create: true, edit: true, delete: true },
  contracts: { view: true, create: true, edit: true, delete: true },
  reports: { view: true },
  settings: { view: true, edit: true },
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
        invoices: { view: true },
        projects: { view: true },
        tickets: { view: true, create: true, edit: true },
        leads: { view: true },
      },
    },
    {
      name: 'Sales',
      permissions: {
        leads: { view: true, create: true, edit: true, delete: true },
        clients: { view: true, create: true, edit: true, delete: true },
        invoices: { view: true, create: true, edit: true, delete: true },
        estimates: { view: true, create: true, edit: true, delete: true },
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

  return { seeded: true, organizationId };
}
