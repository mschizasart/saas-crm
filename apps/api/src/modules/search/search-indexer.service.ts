import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * SearchIndexerService — keeps `search_index` (migration 012) in sync with
 * the 8 indexable entity types: lead, client, invoice, estimate, proposal,
 * contract, ticket, product.
 *
 * Maintenance strategy:
 *
 *   1. Listens to existing domain events on the in-process EventEmitter2 bus
 *      (the same bus AutomationsService uses). On *.created / *.updated /
 *      *.status_changed → upsert. On *.deleted → delete.
 *
 *   2. For events that don't exist today (most entities never emit a
 *      generic `*.updated` and product has no events at all), the gap is
 *      noted in the comments below — those entities will fall behind on
 *      edits until the corresponding services start emitting. The Rebuild
 *      Search Index job (admin endpoint) is the safety net.
 *
 *   3. On application bootstrap, kicks off a one-shot reindex for any org
 *      that has at least one Client but zero search_index rows — covers the
 *      first deploy after running migration 012. Non-blocking: the work
 *      runs through the BullMQ `general` queue.
 *
 * Event coverage (audit, May 2026):
 *   ├─ lead     ✓ created  ✗ updated  ✗ deleted   (only status_changed/converted are emitted)
 *   ├─ client   ✓ created  ✗ updated  ✓ deleted
 *   ├─ invoice  ✓ created  ✓ status_changed  ✓ deleted   (no generic updated)
 *   ├─ estimate ✓ created  ✓ status_changed  ✓ deleted
 *   ├─ proposal ✓ created  ✓ status_changed  ✓ deleted
 *   ├─ contract ✓ created  ✗ updated  ✗ deleted   (signed/renewed only)
 *   ├─ ticket   ✓ created  ✓ status_changed  ✓ deleted
 *   └─ product  ✗ NONE     — products emit no events; rely on reindex.
 *
 * For now, every emitted event triggers an `upsertById` which re-reads the
 * row from Postgres and rebuilds the index entry. That keeps the indexer
 * free of stale-payload pitfalls (e.g. a rename that arrived in a payload
 * we don't fully shape).
 */
@Injectable()
export class SearchIndexerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('general') private readonly generalQueue: Queue,
  ) {}

  // ─── Bootstrap backfill ───────────────────────────────────────────────────

  async onApplicationBootstrap() {
    // Fire-and-forget; never block app startup.
    void this.scheduleStaleOrgReindexes().catch((err) => {
      this.logger.warn(
        `Bootstrap reindex scan failed: ${(err as Error).message}`,
      );
    });
  }

  /**
   * For every org that has at least one Client but no search_index rows,
   * enqueue a reindex job. Used at boot after migration 012 lands; cheap
   * to run on every boot afterwards because the WHERE NOT EXISTS hits a
   * single index lookup per org.
   */
  private async scheduleStaleOrgReindexes() {
    const rows: Array<{ organizationId: string }> = await this.prisma
      .$queryRaw`
      SELECT DISTINCT c."organizationId" AS "organizationId"
      FROM "clients" c
      WHERE NOT EXISTS (
        SELECT 1 FROM "search_index" s
        WHERE s."organizationId" = c."organizationId"
        LIMIT 1
      )
    `;

    if (rows.length === 0) return;

    for (const r of rows) {
      try {
        await this.generalQueue.add(
          'search-reindex-org',
          { orgId: r.organizationId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
            // De-dupe — only one reindex per org in flight.
            jobId: `search-reindex:${r.organizationId}`,
          },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue search-reindex for ${r.organizationId}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Enqueued search-reindex for ${rows.length} stale org(s)`,
    );
  }

  /** Public helper used by the controller's POST /search/reindex. */
  async enqueueReindex(orgId: string) {
    await this.generalQueue.add(
      'search-reindex-org',
      { orgId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
        jobId: `search-reindex:${orgId}`,
      },
    );
  }

  // ─── Public CRUD on the index ─────────────────────────────────────────────

  async upsert(
    orgId: string,
    entityType: string,
    entityId: string,
    payload: { title: string; subtitle?: string; body?: string; url: string },
  ) {
    if (!orgId || !entityType || !entityId) return;
    const title = (payload.title ?? '').trim() || '(untitled)';
    try {
      // RLS is enforced via `tenant_isolation` policy (migration 012);
      // every write must run inside withOrganization so the txn-scoped
      // app.current_organization_id GUC is set.
      await this.prisma.withOrganization(orgId, async (tx) => {
        await tx.searchIndex.upsert({
          where: {
            organizationId_entityType_entityId: {
              organizationId: orgId,
              entityType,
              entityId,
            },
          },
          create: {
            organizationId: orgId,
            entityType,
            entityId,
            title,
            subtitle: payload.subtitle ?? null,
            body: payload.body ?? null,
            url: payload.url,
          },
          update: {
            title,
            subtitle: payload.subtitle ?? null,
            body: payload.body ?? null,
            url: payload.url,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `search_index upsert failed (${entityType}:${entityId}): ${(err as Error).message}`,
      );
    }
  }

  async delete(orgId: string, entityType: string, entityId: string) {
    try {
      await this.prisma.withOrganization(orgId, async (tx) => {
        await tx.searchIndex.deleteMany({
          where: { organizationId: orgId, entityType, entityId },
        });
      });
    } catch (err) {
      this.logger.warn(
        `search_index delete failed (${entityType}:${entityId}): ${(err as Error).message}`,
      );
    }
  }

  // ─── Reindex one org from scratch ────────────────────────────────────────
  /**
   * Wipes the org's slice of `search_index` and rebuilds it by streaming
   * every record across the 8 entity types in batches of 500. Designed to
   * be called from the BullMQ `search-reindex-org` job (set up in
   * search-reindex.processor.ts).
   *
   * Every loader runs inside its own `withOrganization` txn so RLS lets
   * us read the source rows. Each per-row upsert runs in its own RLS-
   * scoped txn (via `this.upsert`) — slightly chattier than batching,
   * but reindex is rare and this keeps the failure blast radius small.
   */
  async reindexAll(orgId: string): Promise<{ total: number }> {
    const BATCH = 500;
    let total = 0;
    this.logger.log(`reindexAll start: org=${orgId}`);

    // Drop existing rows for this org so we don't keep stale entries that
    // referred to records the user later deleted. RLS-scoped.
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.searchIndex.deleteMany({
        where: { organizationId: orgId },
      });
    });

    // ── Clients ─────────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.client.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            company: true,
            phone: true,
            vat: true,
            city: true,
            country: true,
            website: true,
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        await this.upsert(orgId, 'client', r.id, {
          title: r.company,
          subtitle: ['Client', r.city, r.country].filter(Boolean).join(' · ') || undefined,
          body: [r.phone, r.vat, r.website].filter(Boolean).join(' '),
          url: `/clients/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Leads ───────────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.lead.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            company: true,
            description: true,
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        await this.upsert(orgId, 'lead', r.id, {
          title: r.name,
          subtitle: ['Lead', r.company, r.email].filter(Boolean).join(' · '),
          body: [r.email, r.phone, r.description].filter(Boolean).join(' '),
          url: `/leads/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Invoices ────────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.invoice.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            number: true,
            referenceNumber: true,
            status: true,
            total: true,
            clientNote: true,
            adminNote: true,
            terms: true,
            client: { select: { company: true } },
            items: { select: { description: true, longDesc: true } },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        const itemsText = r.items
          .map((i) => [i.description, i.longDesc].filter(Boolean).join(' '))
          .join(' ');
        await this.upsert(orgId, 'invoice', r.id, {
          title: `Invoice ${r.number}`,
          subtitle: [
            'Invoice',
            r.client?.company,
            r.status,
            String(r.total),
          ]
            .filter(Boolean)
            .join(' · '),
          body: [r.referenceNumber, r.clientNote, r.adminNote, r.terms, itemsText]
            .filter(Boolean)
            .join(' '),
          url: `/invoices/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Estimates ───────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.estimate.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            number: true,
            referenceNumber: true,
            status: true,
            total: true,
            clientNote: true,
            adminNote: true,
            terms: true,
            client: { select: { company: true } },
            items: { select: { description: true, longDesc: true } },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        const itemsText = r.items
          .map((i) => [i.description, i.longDesc].filter(Boolean).join(' '))
          .join(' ');
        await this.upsert(orgId, 'estimate', r.id, {
          title: `Estimate ${r.number}`,
          subtitle: [
            'Estimate',
            r.client?.company,
            r.status,
            String(r.total),
          ]
            .filter(Boolean)
            .join(' · '),
          body: [r.referenceNumber, r.clientNote, r.adminNote, r.terms, itemsText]
            .filter(Boolean)
            .join(' '),
          url: `/estimates/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Proposals ───────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.proposal.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            subject: true,
            status: true,
            total: true,
            content: true,
            client: { select: { company: true } },
            items: { select: { description: true, longDesc: true } },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        const itemsText = r.items
          .map((i) => [i.description, i.longDesc].filter(Boolean).join(' '))
          .join(' ');
        await this.upsert(orgId, 'proposal', r.id, {
          title: r.subject,
          subtitle: [
            'Proposal',
            r.client?.company,
            r.status,
            r.total != null ? String(r.total) : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
          body: [r.content, itemsText].filter(Boolean).join(' '),
          url: `/proposals/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Contracts ───────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.contract.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            subject: true,
            status: true,
            value: true,
            description: true,
            content: true,
            type: true,
            client: { select: { company: true } },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        await this.upsert(orgId, 'contract', r.id, {
          title: r.subject,
          subtitle: [
            'Contract',
            r.client?.company,
            r.status,
            r.value != null ? String(r.value) : undefined,
          ]
            .filter(Boolean)
            .join(' · '),
          body: [r.type, r.description, r.content].filter(Boolean).join(' '),
          url: `/contracts/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Tickets ─────────────────────────────────────────────────────────
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.ticket.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            subject: true,
            status: true,
            priority: true,
            message: true,
            client: { select: { company: true } },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      );
      for (const r of rows) {
        await this.upsert(orgId, 'ticket', r.id, {
          title: r.subject,
          subtitle: ['Ticket', r.client?.company, r.status, r.priority]
            .filter(Boolean)
            .join(' · '),
          body: r.message ?? undefined,
          url: `/tickets/${r.id}`,
        });
      }
      return rows.length;
    });

    // ── Products ────────────────────────────────────────────────────────
    // products has NO RLS policy (see prisma/rls-policies.sql) so we read
    // it via the plain client. Filter explicitly by organizationId.
    total += await this.streamBatched(BATCH, async (skip, take) => {
      const rows = await this.prisma.product.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          name: true,
          sku: true,
          description: true,
          unitPrice: true,
          unit: true,
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      });
      for (const r of rows) {
        await this.upsert(orgId, 'product', r.id, {
          title: r.name,
          subtitle: ['Product', r.sku, String(r.unitPrice), r.unit]
            .filter(Boolean)
            .join(' · '),
          body: r.description ?? undefined,
          url: `/products/${r.id}`,
        });
      }
      return rows.length;
    });

    this.logger.log(`reindexAll done: org=${orgId} total=${total}`);
    return { total };
  }

  /**
   * Helper: paginate `loader(skip, take)` until it returns < take rows.
   * Returns the total number of rows processed.
   */
  private async streamBatched(
    take: number,
    loader: (skip: number, take: number) => Promise<number>,
  ): Promise<number> {
    let skip = 0;
    let total = 0;
    // Hard cap to prevent runaways (1M rows per type is plenty).
    const HARD_CAP = 1_000_000;
    while (skip < HARD_CAP) {
      const got = await loader(skip, take);
      total += got;
      if (got < take) break;
      skip += take;
    }
    return total;
  }

  // ─── Upsert-by-id helpers (event-driven path) ────────────────────────────
  // Each helper re-reads the canonical row from Postgres rather than
  // trusting the event payload — keeps the indexer immune to partial
  // payloads (e.g. an event that ships only `{ id, status }`).

  private async upsertClientById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.client.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          company: true,
          phone: true,
          vat: true,
          city: true,
          country: true,
          website: true,
        },
      }),
    );
    if (!r) return this.delete(orgId, 'client', id);
    return this.upsert(orgId, 'client', r.id, {
      title: r.company,
      subtitle: ['Client', r.city, r.country].filter(Boolean).join(' · ') || undefined,
      body: [r.phone, r.vat, r.website].filter(Boolean).join(' '),
      url: `/clients/${r.id}`,
    });
  }

  private async upsertLeadById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.lead.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          description: true,
        },
      }),
    );
    if (!r) return this.delete(orgId, 'lead', id);
    return this.upsert(orgId, 'lead', r.id, {
      title: r.name,
      subtitle: ['Lead', r.company, r.email].filter(Boolean).join(' · '),
      body: [r.email, r.phone, r.description].filter(Boolean).join(' '),
      url: `/leads/${r.id}`,
    });
  }

  private async upsertInvoiceById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.invoice.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          number: true,
          referenceNumber: true,
          status: true,
          total: true,
          clientNote: true,
          adminNote: true,
          terms: true,
          client: { select: { company: true } },
          items: { select: { description: true, longDesc: true } },
        },
      }),
    );
    if (!r) return this.delete(orgId, 'invoice', id);
    const itemsText = r.items
      .map((i) => [i.description, i.longDesc].filter(Boolean).join(' '))
      .join(' ');
    return this.upsert(orgId, 'invoice', r.id, {
      title: `Invoice ${r.number}`,
      subtitle: [
        'Invoice',
        r.client?.company,
        r.status,
        String(r.total),
      ]
        .filter(Boolean)
        .join(' · '),
      body: [r.referenceNumber, r.clientNote, r.adminNote, r.terms, itemsText]
        .filter(Boolean)
        .join(' '),
      url: `/invoices/${r.id}`,
    });
  }

  private async upsertEstimateById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.estimate.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          number: true,
          referenceNumber: true,
          status: true,
          total: true,
          clientNote: true,
          adminNote: true,
          terms: true,
          client: { select: { company: true } },
          items: { select: { description: true, longDesc: true } },
        },
      }),
    );
    if (!r) return this.delete(orgId, 'estimate', id);
    const itemsText = r.items
      .map((i) => [i.description, i.longDesc].filter(Boolean).join(' '))
      .join(' ');
    return this.upsert(orgId, 'estimate', r.id, {
      title: `Estimate ${r.number}`,
      subtitle: [
        'Estimate',
        r.client?.company,
        r.status,
        String(r.total),
      ]
        .filter(Boolean)
        .join(' · '),
      body: [r.referenceNumber, r.clientNote, r.adminNote, r.terms, itemsText]
        .filter(Boolean)
        .join(' '),
      url: `/estimates/${r.id}`,
    });
  }

  private async upsertProposalById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.proposal.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          subject: true,
          status: true,
          total: true,
          content: true,
          client: { select: { company: true } },
          items: { select: { description: true, longDesc: true } },
        },
      }),
    );
    if (!r) return this.delete(orgId, 'proposal', id);
    const itemsText = r.items
      .map((i) => [i.description, i.longDesc].filter(Boolean).join(' '))
      .join(' ');
    return this.upsert(orgId, 'proposal', r.id, {
      title: r.subject,
      subtitle: [
        'Proposal',
        r.client?.company,
        r.status,
        r.total != null ? String(r.total) : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      body: [r.content, itemsText].filter(Boolean).join(' '),
      url: `/proposals/${r.id}`,
    });
  }

  private async upsertContractById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.contract.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          subject: true,
          status: true,
          value: true,
          description: true,
          content: true,
          type: true,
          client: { select: { company: true } },
        },
      }),
    );
    if (!r) return this.delete(orgId, 'contract', id);
    return this.upsert(orgId, 'contract', r.id, {
      title: r.subject,
      subtitle: [
        'Contract',
        r.client?.company,
        r.status,
        r.value != null ? String(r.value) : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      body: [r.type, r.description, r.content].filter(Boolean).join(' '),
      url: `/contracts/${r.id}`,
    });
  }

  private async upsertTicketById(orgId: string, id: string) {
    const r = await this.prisma.withOrganization(orgId, (tx) =>
      tx.ticket.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          message: true,
          client: { select: { company: true } },
        },
      }),
    );
    if (!r) return this.delete(orgId, 'ticket', id);
    return this.upsert(orgId, 'ticket', r.id, {
      title: r.subject,
      subtitle: ['Ticket', r.client?.company, r.status, r.priority]
        .filter(Boolean)
        .join(' · '),
      body: r.message ?? undefined,
      url: `/tickets/${r.id}`,
    });
  }

  // No `upsertProductById` — products emit no events. Picked up via reindex.

  // ─── Event listeners ─────────────────────────────────────────────────────
  // Convention: every payload carries `orgId` (see automations.service.ts);
  // the entity itself is on a key matching the entity name.

  // ── Lead ────────────────────────────────────────────────────────────────
  // GAP: no `lead.updated`, no `lead.deleted` events emitted today.
  @OnEvent('lead.created')
  onLeadCreated(p: any) {
    void this.handle(() =>
      this.upsertLeadById(p.orgId, p.lead?.id ?? p.id),
    );
  }
  @OnEvent('lead.status_changed')
  onLeadStatusChanged(p: any) {
    void this.handle(() =>
      this.upsertLeadById(p.orgId, p.lead?.id ?? p.id),
    );
  }
  @OnEvent('lead.converted')
  onLeadConverted(p: any) {
    // Lead becomes a Client; refresh the lead row (status now reflects
    // conversion) and let `client.created` (which always fires from the
    // converter) handle the new client.
    void this.handle(() =>
      this.upsertLeadById(p.orgId, p.lead?.id ?? p.leadId ?? p.id),
    );
  }

  // ── Client ──────────────────────────────────────────────────────────────
  // GAP: no `client.updated` event. Edits to company/phone/etc. won't
  // refresh the index until a reindex runs.
  @OnEvent('client.created')
  onClientCreated(p: any) {
    void this.handle(() =>
      this.upsertClientById(p.orgId, p.client?.id ?? p.id),
    );
  }
  @OnEvent('client.deleted')
  onClientDeleted(p: any) {
    void this.handle(() => this.delete(p.orgId, 'client', p.id));
  }

  // ── Invoice ─────────────────────────────────────────────────────────────
  @OnEvent('invoice.created')
  onInvoiceCreated(p: any) {
    void this.handle(() =>
      this.upsertInvoiceById(p.orgId, p.invoice?.id ?? p.id),
    );
  }
  @OnEvent('invoice.status_changed')
  onInvoiceStatusChanged(p: any) {
    void this.handle(() =>
      this.upsertInvoiceById(p.orgId, p.invoice?.id ?? p.id),
    );
  }
  @OnEvent('invoice.sent')
  onInvoiceSent(p: any) {
    void this.handle(() =>
      this.upsertInvoiceById(p.orgId, p.invoice?.id ?? p.id),
    );
  }
  @OnEvent('invoice.deleted')
  onInvoiceDeleted(p: any) {
    void this.handle(() => this.delete(p.orgId, 'invoice', p.id));
  }

  // ── Estimate ────────────────────────────────────────────────────────────
  @OnEvent('estimate.created')
  onEstimateCreated(p: any) {
    void this.handle(() =>
      this.upsertEstimateById(p.orgId, p.estimate?.id ?? p.id),
    );
  }
  @OnEvent('estimate.status_changed')
  onEstimateStatusChanged(p: any) {
    void this.handle(() =>
      this.upsertEstimateById(p.orgId, p.estimate?.id ?? p.id),
    );
  }
  @OnEvent('estimate.sent')
  onEstimateSent(p: any) {
    void this.handle(() =>
      this.upsertEstimateById(p.orgId, p.estimate?.id ?? p.id),
    );
  }
  @OnEvent('estimate.accepted')
  onEstimateAccepted(p: any) {
    void this.handle(() =>
      this.upsertEstimateById(p.orgId, p.estimate?.id ?? p.id),
    );
  }
  @OnEvent('estimate.deleted')
  onEstimateDeleted(p: any) {
    void this.handle(() => this.delete(p.orgId, 'estimate', p.id));
  }

  // ── Proposal ────────────────────────────────────────────────────────────
  @OnEvent('proposal.created')
  onProposalCreated(p: any) {
    void this.handle(() =>
      this.upsertProposalById(p.orgId, p.proposal?.id ?? p.id),
    );
  }
  @OnEvent('proposal.status_changed')
  onProposalStatusChanged(p: any) {
    void this.handle(() =>
      this.upsertProposalById(p.orgId, p.proposal?.id ?? p.id),
    );
  }
  @OnEvent('proposal.sent')
  onProposalSent(p: any) {
    void this.handle(() =>
      this.upsertProposalById(p.orgId, p.proposal?.id ?? p.id),
    );
  }
  @OnEvent('proposal.accepted')
  onProposalAccepted(p: any) {
    void this.handle(() =>
      this.upsertProposalById(p.orgId, p.proposal?.id ?? p.id),
    );
  }
  @OnEvent('proposal.deleted')
  onProposalDeleted(p: any) {
    void this.handle(() => this.delete(p.orgId, 'proposal', p.id));
  }

  // ── Contract ────────────────────────────────────────────────────────────
  // GAP: no `contract.updated` and no `contract.deleted` events today —
  // the service emits only created / sent_for_signing / signed / renewed.
  @OnEvent('contract.created')
  onContractCreated(p: any) {
    void this.handle(() =>
      this.upsertContractById(p.orgId, p.contract?.id ?? p.id),
    );
  }
  @OnEvent('contract.sent_for_signing')
  onContractSent(p: any) {
    void this.handle(() =>
      this.upsertContractById(p.orgId, p.contract?.id ?? p.id),
    );
  }
  @OnEvent('contract.signed')
  onContractSigned(p: any) {
    void this.handle(() =>
      this.upsertContractById(p.orgId, p.contract?.id ?? p.id),
    );
  }
  @OnEvent('contract.renewed')
  onContractRenewed(p: any) {
    void this.handle(() =>
      this.upsertContractById(p.orgId, p.contract?.id ?? p.id),
    );
  }

  // ── Ticket ──────────────────────────────────────────────────────────────
  @OnEvent('ticket.created')
  onTicketCreated(p: any) {
    void this.handle(() =>
      this.upsertTicketById(p.orgId, p.ticket?.id ?? p.id),
    );
  }
  @OnEvent('ticket.status_changed')
  onTicketStatusChanged(p: any) {
    void this.handle(() =>
      this.upsertTicketById(p.orgId, p.ticket?.id ?? p.id),
    );
  }
  @OnEvent('ticket.assigned')
  onTicketAssigned(p: any) {
    void this.handle(() =>
      this.upsertTicketById(p.orgId, p.ticket?.id ?? p.id),
    );
  }
  @OnEvent('ticket.replied')
  onTicketReplied(p: any) {
    void this.handle(() =>
      this.upsertTicketById(p.orgId, p.ticketId ?? p.ticket?.id),
    );
  }
  @OnEvent('ticket.deleted')
  onTicketDeleted(p: any) {
    void this.handle(() => this.delete(p.orgId, 'ticket', p.id));
  }

  // ── Product ─────────────────────────────────────────────────────────────
  // GAP: products emit no events at all. Index for products is populated
  // only by `reindexAll(orgId)` — admin must trigger a reindex (or boot)
  // after editing products. Fix by emitting product.created/.updated/.deleted
  // from products.service.ts in a follow-up.

  // ─── Internals ───────────────────────────────────────────────────────────

  /** Wrap an indexer call so listener errors never break the event bus. */
  private async handle(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`indexer error: ${(err as Error).message}`);
    }
  }
}
