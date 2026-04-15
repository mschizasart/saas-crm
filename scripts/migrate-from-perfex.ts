/**
 * ETL Migration Script: Perfex CRM (MySQL) → SaaS CRM (PostgreSQL)
 *
 * Usage:
 *   MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD=pass MYSQL_DATABASE=perfex \
 *   ORG_SLUG=mycompany \
 *   DATABASE_URL="postgresql://crm:pass@localhost:5432/saascrm" \
 *   ts-node scripts/migrate-from-perfex.ts [--dry-run]
 *
 * Notes:
 *   • PHP serialize() blobs → JSON via `php-serialize`
 *   • phpass password hashes are preserved; passwordFormat='phpass' triggers
 *     a password-reset flow on first login (see AuthService.validateUser).
 *   • Each table is re-runnable via upsert using (organizationId, legacyId).
 */
import { PrismaClient } from '@prisma/client';
import * as mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PhpSerialize = require('php-serialize');

const DRY_RUN = process.argv.includes('--dry-run');

type IdMap = Record<string, Record<string | number, string>>;

const idMap: IdMap = {
  staff: {},
  roles: {},
  clients: {},
  contacts: {},
  currencies: {},
  taxes: {},
  payment_modes: {},
  lead_statuses: {},
  lead_sources: {},
  leads: {},
  invoices: {},
  projects: {},
  tasks: {},
  tickets: {},
  contracts: {},
  estimates: {},
  proposals: {},
  expenses: {},
  expense_categories: {},
  kb_groups: {},
  departments: {},
};

function mapId(table: string, oldId: number | string): string {
  const key = String(oldId);
  if (!idMap[table][key]) {
    idMap[table][key] = randomUUID();
  }
  return idMap[table][key];
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function tryUnserialize(v: any): any {
  if (!v || typeof v !== 'string') return v;
  try {
    return PhpSerialize.unserialize(v);
  } catch {
    return v;
  }
}

async function main() {
  console.log('🚀 Perfex → SaaS CRM migration');
  console.log('━'.repeat(60));
  if (DRY_RUN) console.log('🔍 DRY RUN — no writes will be performed');

  const prisma = new PrismaClient();
  const mysqlConn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'perfex',
    dateStrings: false,
    timezone: 'Z',
  });

  const slug = (process.env.ORG_SLUG || 'migrated').toLowerCase();
  let org = await prisma.organization.findUnique({ where: { slug } });
  if (!org && !DRY_RUN) {
    org = await prisma.organization.create({
      data: { name: process.env.ORG_NAME || slug, slug, subscriptionStatus: 'active' },
    });
    console.log(`✅ Created org ${org.slug} (${org.id})`);
  } else if (org) {
    console.log(`ℹ️  Using existing org ${org.slug} (${org.id})`);
  } else {
    org = { id: '<dry-run-org-id>', slug, name: slug } as any;
  }
  const orgId = org!.id;

  const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
    try {
      const [rows] = await mysqlConn.query(sql, params);
      return rows as T[];
    } catch (err: any) {
      console.warn(`  ⚠ query failed: ${err.message}`);
      return [];
    }
  };

  async function upsert(
    label: string,
    rows: any[],
    handler: (r: any) => Promise<void>,
  ) {
    console.log(`\n→ ${label}: ${rows.length} rows`);
    if (DRY_RUN) return;
    let ok = 0;
    for (const r of rows) {
      try {
        await handler(r);
        ok++;
      } catch (err: any) {
        console.warn(`  ⚠ ${label} row failed: ${err.message}`);
      }
    }
    console.log(`  ✓ ${ok}/${rows.length}`);
  }

  // ─── 1. tbloptions → organization.settings ──────────────
  const options = await q('SELECT name, value FROM tbloptions');
  const settings: Record<string, any> = {};
  for (const o of options) settings[o.name] = tryUnserialize(o.value);
  if (!DRY_RUN) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { settings },
    });
  }
  console.log(`→ tbloptions: ${options.length} options merged into settings`);

  // ─── 2. tblroles → roles ────────────────────────────────
  const roles = await q('SELECT * FROM tblroles');
  await upsert('tblroles → roles', roles, async (r) => {
    const id = mapId('roles', r.roleid);
    const perms = tryUnserialize(r.permissions) || {};
    await prisma.role.upsert({
      where: { id },
      update: { name: r.name, permissions: perms },
      create: { id, organizationId: orgId, name: r.name, permissions: perms },
    });
  });

  // ─── 3. tblstaff → users (type=staff) ───────────────────
  const staff = await q('SELECT * FROM tblstaff');
  await upsert('tblstaff → users', staff, async (s) => {
    const id = mapId('staff', s.staffid);
    const data = {
      organizationId: orgId,
      email: s.email,
      password: s.password, // phpass
      passwordFormat: 'phpass',
      firstName: s.firstname || 'Unknown',
      lastName: s.lastname || '',
      type: 'staff',
      isAdmin: s.admin === 1,
      active: s.active === 1,
      phone: s.phonenumber || null,
      roleId: s.role ? idMap.roles[String(s.role)] || null : null,
      lastLogin: toDate(s.last_login),
      lastIp: s.last_ip || null,
    };
    await prisma.user.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 4. tblcurrencies → currencies ──────────────────────
  const currencies = await q('SELECT * FROM tblcurrencies');
  await upsert('tblcurrencies', currencies, async (c) => {
    const id = mapId('currencies', c.id);
    await prisma.currency.upsert({
      where: { id },
      update: {
        name: c.name,
        symbol: c.symbol,
        isDefault: c.isdefault === 1,
      },
      create: {
        id,
        organizationId: orgId,
        name: c.name,
        symbol: c.symbol,
        isDefault: c.isdefault === 1,
      },
    });
  });

  // ─── 5. tbltaxes → taxes ────────────────────────────────
  const taxes = await q('SELECT * FROM tbltaxes');
  await upsert('tbltaxes', taxes, async (t) => {
    const id = mapId('taxes', t.id);
    await prisma.tax.upsert({
      where: { id },
      update: { name: t.name, rate: t.taxrate },
      create: { id, organizationId: orgId, name: t.name, rate: t.taxrate },
    });
  });

  // ─── 6. tblpayment_modes → payment_modes ────────────────
  const paymentModes = await q('SELECT * FROM tblpayment_modes');
  await upsert('tblpayment_modes', paymentModes, async (pm) => {
    const id = mapId('payment_modes', pm.id);
    await prisma.paymentMode.upsert({
      where: { id },
      update: { name: pm.name, description: pm.description, active: pm.active === 1 },
      create: {
        id,
        organizationId: orgId,
        name: pm.name,
        description: pm.description,
        active: pm.active === 1,
      },
    });
  });

  // ─── 7. tblclients → clients ────────────────────────────
  const clients = await q('SELECT * FROM tblclients');
  await upsert('tblclients', clients, async (c) => {
    const id = mapId('clients', c.userid);
    const data = {
      organizationId: orgId,
      company: c.company || 'Unnamed',
      address: c.address || null,
      city: c.city || null,
      state: c.state || null,
      zipCode: c.zip || null,
      country: c.country ? String(c.country) : null,
      phone: c.phonenumber || null,
      website: c.website || null,
      vat: c.vat || null,
      active: c.active === 1,
    };
    await prisma.client.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 8. tblcontacts → users (type=contact) ──────────────
  const contacts = await q('SELECT * FROM tblcontacts');
  await upsert('tblcontacts', contacts, async (c) => {
    const id = mapId('contacts', c.id);
    const clientId = idMap.clients[String(c.userid)];
    if (!clientId) return;
    const data = {
      organizationId: orgId,
      email: c.email,
      password: c.password,
      passwordFormat: 'phpass',
      firstName: c.firstname || 'Unknown',
      lastName: c.lastname || '',
      type: 'contact',
      clientId,
      isPrimary: c.is_primary === 1,
      active: c.active === 1,
      phone: c.phonenumber || null,
      jobTitle: c.title || null,
    };
    await prisma.user.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 9. Lead statuses / sources / leads ─────────────────
  const leadStatuses = await q('SELECT * FROM tblleads_status');
  await upsert('tblleads_status', leadStatuses, async (r) => {
    const id = mapId('lead_statuses', r.id);
    await prisma.leadStatus.upsert({
      where: { id },
      update: { name: r.name, color: r.color || '#6b7280', position: r.statusorder || 0 },
      create: {
        id,
        organizationId: orgId,
        name: r.name,
        color: r.color || '#6b7280',
        position: r.statusorder || 0,
      },
    });
  });

  const leadSources = await q('SELECT * FROM tblleads_source');
  await upsert('tblleads_source', leadSources, async (r) => {
    const id = mapId('lead_sources', r.id);
    await prisma.leadSource.upsert({
      where: { id },
      update: { name: r.name },
      create: { id, organizationId: orgId, name: r.name },
    });
  });

  const leads = await q('SELECT * FROM tblleads');
  await upsert('tblleads', leads, async (l) => {
    const id = mapId('leads', l.id);
    const data = {
      organizationId: orgId,
      statusId: l.status ? idMap.lead_statuses[String(l.status)] || null : null,
      sourceId: l.source ? idMap.lead_sources[String(l.source)] || null : null,
      assignedTo: l.assigned ? idMap.staff[String(l.assigned)] || null : null,
      name: l.name || 'Unknown',
      company: l.company || null,
      email: l.email || null,
      phone: l.phonenumber || null,
      description: l.description || null,
      lastContact: toDate(l.lastcontact),
    };
    await prisma.lead.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 10. Invoices + items ───────────────────────────────
  const invoices = await q('SELECT * FROM tblinvoices');
  await upsert('tblinvoices', invoices, async (i) => {
    const id = mapId('invoices', i.id);
    const clientId = i.clientid ? idMap.clients[String(i.clientid)] || null : null;
    const data = {
      organizationId: orgId,
      clientId,
      number: i.prefix ? `${i.prefix}${i.number}` : String(i.number || id),
      status:
        ['draft', 'unpaid', 'paid', 'partial', 'overdue', 'cancelled'][i.status - 1] || 'draft',
      date: toDate(i.date) || new Date(),
      dueDate: toDate(i.duedate),
      subTotal: i.subtotal || 0,
      discount: i.discount_total || 0,
      adjustment: i.adjustment || 0,
      total: i.total || 0,
      totalTax: i.total_tax || 0,
      clientNote: i.clientnote || null,
      adminNote: i.adminnote || null,
      terms: i.terms || null,
    };
    await prisma.invoice.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  const invoiceItems = await q(
    "SELECT * FROM tblitemable WHERE rel_type='invoice'",
  );
  await upsert('tblitemable → invoice_items', invoiceItems, async (it) => {
    const invoiceId = idMap.invoices[String(it.rel_id)];
    if (!invoiceId) return;
    await prisma.invoiceItem.create({
      data: {
        invoiceId,
        description: it.description || '',
        longDesc: it.long_description || null,
        qty: it.qty || 1,
        rate: it.rate || 0,
        unit: it.unit || null,
        order: it.item_order || 0,
      },
    });
  });

  // ─── 11. Payments ───────────────────────────────────────
  const payments = await q('SELECT * FROM tblinvoicepaymentrecords');
  await upsert('tblinvoicepaymentrecords', payments, async (p) => {
    const invoiceId = idMap.invoices[String(p.invoiceid)];
    if (!invoiceId) return;
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        invoiceId,
        amount: p.amount || 0,
        paymentDate: toDate(p.date) || new Date(),
        transactionId: p.transactionid || null,
        note: p.note || null,
      },
    });
  });

  // ─── 12. Projects + tasks ───────────────────────────────
  const projects = await q('SELECT * FROM tblprojects');
  await upsert('tblprojects', projects, async (p) => {
    const id = mapId('projects', p.id);
    const clientId = p.clientid ? idMap.clients[String(p.clientid)] || null : null;
    const data = {
      organizationId: orgId,
      clientId,
      name: p.name || 'Untitled',
      description: p.description || null,
      startDate: toDate(p.start_date),
      deadline: toDate(p.deadline),
      progress: p.progress || 0,
    };
    await prisma.project.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  const tasks = await q('SELECT * FROM tbltasks');
  await upsert('tbltasks', tasks, async (t) => {
    const id = mapId('tasks', t.id);
    const projectId =
      t.rel_type === 'project' ? idMap.projects[String(t.rel_id)] || null : null;
    const data = {
      organizationId: orgId,
      projectId,
      name: t.name || 'Untitled',
      description: t.description || null,
      startDate: toDate(t.startdate),
      dueDate: toDate(t.duedate),
      priority:
        ['low', 'medium', 'high', 'urgent'][(t.priority || 2) - 1] || 'medium',
    };
    await prisma.task.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 13. Tickets + replies ──────────────────────────────
  const tickets = await q('SELECT * FROM tbltickets');
  await upsert('tbltickets', tickets, async (t) => {
    const id = mapId('tickets', t.ticketid);
    const data = {
      organizationId: orgId,
      clientId: t.userid ? idMap.clients[String(t.userid)] || null : null,
      assignedTo: t.assigned ? idMap.staff[String(t.assigned)] || null : null,
      subject: t.subject || '(no subject)',
      message: t.message || null,
      status: 'open',
      priority: 'medium',
    };
    await prisma.ticket.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  const ticketReplies = await q('SELECT * FROM tblticket_replies');
  await upsert('tblticket_replies', ticketReplies, async (r) => {
    const ticketId = idMap.tickets[String(r.ticketid)];
    if (!ticketId) return;
    await prisma.ticketReply.create({
      data: {
        ticketId,
        message: r.message || '',
        createdAt: toDate(r.date) || new Date(),
      },
    });
  });

  // ─── 14. Contracts ──────────────────────────────────────
  const contracts = await q('SELECT * FROM tblcontracts');
  await upsert('tblcontracts', contracts, async (c) => {
    const id = mapId('contracts', c.id);
    const clientId = c.client ? idMap.clients[String(c.client)] || null : null;
    const data = {
      organizationId: orgId,
      clientId,
      subject: c.subject || 'Contract',
      value: c.contract_value || 0,
      description: c.description || null,
      startDate: toDate(c.datestart),
      endDate: toDate(c.dateend),
      signed: !!c.signed,
    };
    await prisma.contract.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 15. Estimates ──────────────────────────────────────
  const estimates = await q('SELECT * FROM tblestimates');
  await upsert('tblestimates', estimates, async (e) => {
    const id = mapId('estimates', e.id);
    const data = {
      organizationId: orgId,
      clientId: e.clientid ? idMap.clients[String(e.clientid)] || null : null,
      number: e.prefix ? `${e.prefix}${e.number}` : String(e.number || id),
      status: 'draft',
      date: toDate(e.date) || new Date(),
      expiryDate: toDate(e.expirydate),
      subTotal: e.subtotal || 0,
      total: e.total || 0,
      totalTax: e.total_tax || 0,
    };
    await prisma.estimate.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 16. Proposals ──────────────────────────────────────
  const proposals = await q('SELECT * FROM tblproposals');
  await upsert('tblproposals', proposals, async (p) => {
    const id = mapId('proposals', p.id);
    const data = {
      organizationId: orgId,
      clientId:
        p.rel_type === 'customer' && p.rel_id
          ? idMap.clients[String(p.rel_id)] || null
          : null,
      subject: p.subject || 'Proposal',
      content: p.content || null,
      status: 'draft',
      total: p.total || 0,
      dateCreated: toDate(p.date) || new Date(),
    };
    await prisma.proposal.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 17. Expenses + categories ──────────────────────────
  const expCats = await q('SELECT * FROM tblexpenses_categories');
  await upsert('tblexpenses_categories', expCats, async (ec) => {
    const id = mapId('expense_categories', ec.id);
    await prisma.expenseCategory.upsert({
      where: { id },
      update: { name: ec.name, description: ec.description },
      create: {
        id,
        organizationId: orgId,
        name: ec.name,
        description: ec.description,
      },
    });
  });

  const expenses = await q('SELECT * FROM tblexpenses');
  await upsert('tblexpenses', expenses, async (e) => {
    const id = mapId('expenses', e.id);
    const data = {
      organizationId: orgId,
      categoryId: e.category
        ? idMap.expense_categories[String(e.category)] || null
        : null,
      clientId: e.clientid ? idMap.clients[String(e.clientid)] || null : null,
      projectId: e.project_id ? idMap.projects[String(e.project_id)] || null : null,
      name: e.expense_name || e.note || 'Expense',
      amount: e.amount || 0,
      date: toDate(e.date) || new Date(),
      note: e.note || null,
      reference: e.reference_no || null,
    };
    await prisma.expense.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
  });

  // ─── 18. Knowledge base ─────────────────────────────────
  const kbGroups = await q('SELECT * FROM tblkb_groups');
  await upsert('tblkb_groups', kbGroups, async (g) => {
    const id = mapId('kb_groups', g.groupid);
    const slug = (g.group_slug || g.name || id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    await prisma.knowledgeBaseGroup.upsert({
      where: { id },
      update: { name: g.name, slug },
      create: { id, organizationId: orgId, name: g.name, slug },
    });
  });

  const kbArticles = await q('SELECT * FROM tblknowledge_base');
  await upsert('tblknowledge_base', kbArticles, async (a) => {
    const groupId = idMap.kb_groups[String(a.articlegroup)];
    if (!groupId) return;
    const slug = (a.slug || a.subject || 'article')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    await prisma.knowledgeBaseArticle.create({
      data: {
        organizationId: orgId,
        groupId,
        title: a.subject || 'Untitled',
        slug,
        content: a.description || null,
        active: a.active === 1,
      },
    });
  });

  console.log('\n━'.repeat(60));
  console.log('✅ Migration complete');
  if (DRY_RUN) console.log('   (DRY RUN — nothing written)');

  await mysqlConn.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
