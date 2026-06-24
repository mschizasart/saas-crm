import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailsService } from '../emails/emails.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { RecordSharingService } from '../record-sharing/record-sharing.service';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { EXPORT_ROW_CAP } from '../../common/csv/csv-writer';

export interface ImportSkipped {
  row: number;
  reason: string;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped: ImportSkipped[];
  errors: ImportError[];
}

/** Columns accepted by the leads CSV importer (case-insensitive, snake or camel). */
const LEAD_CSV_COLUMNS = [
  'name',
  'email',
  'phone',
  'company',
  'source',
  'status',
  'assigneeEmail',
  'notes',
] as const;

export interface CreateLeadDto {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  description?: string;
  budget?: number;
  currency?: string;
  status?: string;
  source?: string;
  assignedToId?: string;
  customFieldValues?: Record<string, any>;
}

const VALID_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

type LeadStatus = (typeof VALID_STATUSES)[number];

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private activityLog: ActivityLogService,
    private recordSharing: RecordSharingService,
    @Optional() private emailsService?: EmailsService,
  ) {}

  // ─── Export ────────────────────────────────────────────────
  async findAllForExport(
    orgId: string,
    query: { search?: string; status?: string; assignedToId?: string } = {},
    /**
     * Optional caller — when supplied (and not isAdmin), the export
     * obeys the same hierarchical record-sharing scope as findAll().
     * Without this, a sales rep with `leads.view` would CSV-export
     * every lead in the tenant — bypassing the visibility check the
     * list view enforces. Wave G1.
     */
    currentUser?: {
      id: string;
      isAdmin?: boolean;
      role?: { permissions?: Record<string, Record<string, boolean>> };
    },
  ): Promise<{ rows: any[]; truncated: boolean }> {
    const { search, status, assignedToId } = query;

    return this.prisma.withOrganization(orgId, async (tx) => {
      // mergedIntoId: null — hide leads that were merged away as the loser
      // of a dedup merge (migration 045). They live on (soft-marked) for the
      // audit trail but must never appear in lists/exports.
      const where: any = { organizationId: orgId, mergedIntoId: null };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (status) {
        where.status = { is: { name: { equals: status, mode: 'insensitive' } } };
      }
      if (assignedToId) where.assignedTo = assignedToId;

      // Apply hierarchical visibility scope (Wave G1) — same contract
      // as findAll(). Admins fall through unchanged.
      const scopedWhere =
        currentUser && currentUser.isAdmin !== true
          ? await this.recordSharing.applyVisibilityScopeTx(
              tx,
              orgId,
              currentUser.id,
              currentUser.role?.permissions,
              where,
              'assignedTo',
            )
          : where;

      const rows = await tx.lead.findMany({
        where: scopedWhere,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_CAP + 1,
        include: {
          status: { select: { name: true } },
          source: { select: { name: true } },
        },
      });

      const truncated = rows.length > EXPORT_ROW_CAP;
      if (truncated) {
        this.logger.warn(
          `Leads export truncated at ${EXPORT_ROW_CAP} rows for org ${orgId}`,
        );
      }
      return { rows: truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows, truncated };
    });
  }

  // ─── List / Find ────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      assignedToId?: string;
      page?: number;
      limit?: number;
      /** 'createdAt' (default) | 'score' — score sorts NULLS LAST, desc. */
      sortBy?: string;
    },
    /**
     * Optional caller — when supplied, leads are scoped via
     * RecordSharingService.applyVisibilityScope() to (self + reports)
     * unless the caller has the `records.sharing.all` grant. Kept
     * optional so non-HTTP callers (CSV import internals, cron jobs)
     * keep working unchanged. Wave G1.
     */
    currentUser?: {
      id: string;
      isAdmin?: boolean;
      role?: { permissions?: Record<string, Record<string, boolean>> };
    },
  ) {
    const { search, status, assignedToId, page = 1, limit = 20, sortBy } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      // mergedIntoId: null — hide merged-away losers from the list (migration 045).
      const where: any = { organizationId: orgId, mergedIntoId: null };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (status) {
        where.status = { is: { name: { equals: status, mode: 'insensitive' } } };
      }
      if (assignedToId) where.assignedTo = assignedToId;

      // Wave G1 — hierarchical record sharing. When a caller is
      // present and is NOT a super-admin, scope leads to owners the
      // caller can see. Admins fall through unchanged. The Lead
      // model uses the scalar `assignedTo` column for ownership,
      // hence the explicit fourth arg.
      //
      // `user.isAdmin === true` is a blanket no-scope bypass mirroring
      // RbacGuard's admin contract. The `records.sharing.all` permission
      // inside applyVisibilityScope is the role-level equivalent for
      // non-admin users.
      //
      // We call the Tx variant because we're already inside a
      // `withOrganization` callback — the public method would open a
      // nested transaction and Prisma would throw.
      const scopedWhere =
        currentUser && currentUser.isAdmin !== true
          ? await this.recordSharing.applyVisibilityScopeTx(
              tx,
              orgId,
              currentUser.id,
              currentUser.role?.permissions,
              where,
              'assignedTo',
            )
          : where;

      // "Hottest first" sort uses Prisma's nullable-sort syntax to push
      // un-scored leads to the bottom; createdAt is the secondary key
      // so leads with identical (or null) scores order deterministically.
      const orderBy: any =
        sortBy === 'score'
          ? [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
          : { createdAt: 'desc' };

      const [data, total] = await Promise.all([
        tx.lead.findMany({
          where: scopedWhere,
          skip,
          take: limit,
          orderBy,
          include: {
            status: { select: { id: true, name: true, color: true } },
            source: { select: { id: true, name: true } },
            _count: { select: { notes: true } },
          },
        }),
        tx.lead.count({ where: scopedWhere }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, organizationId: orgId },
        include: {
          status: { select: { id: true, name: true, color: true } },
          source: { select: { id: true, name: true } },
          notes: {
            orderBy: { createdAt: 'desc' },
          },
          customFieldValues: { include: { field: true } },
        },
      });
      if (!lead) throw new NotFoundException('Lead not found');
      return lead;
    });
  }

  // ─── Create / Update / Delete ───────────────────────────────

  /**
   * Translate the public DTO shape (status/source as plain strings,
   * budget as number, position as string) into the Prisma Lead input
   * (statusId/sourceId FKs, value as Decimal, position ignored).
   */
  private async resolveLeadData(
    tx: any,
    orgId: string,
    dto: Partial<CreateLeadDto>,
  ): Promise<Record<string, any>> {
    // Split string-form status/source/budget/position off the DTO so they
    // don't leak into Prisma via the spread below.
    const {
      status,
      source,
      budget,
      position,
      customFieldValues, // handled by a dedicated endpoint
      assignedToId,
      ...rest
    } = dto;

    const data: Record<string, any> = { ...rest };

    // Lead.assignedTo is a scalar String column on the Lead model
    if (assignedToId !== undefined) {
      data.assignedTo = assignedToId;
    }

    // Resolve status -> statusId (look up or create on the fly)
    if (status !== undefined && status !== null && status !== '') {
      const existing = await tx.leadStatus.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: status, mode: 'insensitive' },
        },
      });
      if (existing) {
        data.statusId = existing.id;
      } else {
        const maxPos = await tx.leadStatus.aggregate({
          where: { organizationId: orgId },
          _max: { position: true },
        });
        const created = await tx.leadStatus.create({
          data: {
            organizationId: orgId,
            name: status,
            color: '#6b7280',
            position: (maxPos._max.position ?? -1) + 1,
          },
        });
        data.statusId = created.id;
      }
    }

    // Resolve source -> sourceId (look up or create on the fly)
    if (source !== undefined && source !== null && source !== '') {
      const existing = await tx.leadSource.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: source, mode: 'insensitive' },
        },
      });
      if (existing) {
        data.sourceId = existing.id;
      } else {
        const created = await tx.leadSource.create({
          data: { organizationId: orgId, name: source },
        });
        data.sourceId = created.id;
      }
    }

    // budget -> value (Prisma Decimal accepts plain number / string)
    if (budget !== undefined && budget !== null && (budget as any) !== '') {
      const n = typeof budget === 'string' ? Number(budget) : budget;
      data.value = Number.isFinite(n as number) ? (n as number) : null;
    }

    // `position` in the DTO is a job title string from the form and has no
    // safe mapping to the Lead.position Int (kanban order) — ignore it.
    void position;

    return data;
  }

  async create(orgId: string, dto: CreateLeadDto, createdBy: string) {
    const lead = await this.prisma.withOrganization(orgId, async (tx) => {
      const data = await this.resolveLeadData(tx, orgId, dto);
      return tx.lead.create({
        data: {
          ...data,
          organizationId: orgId,
        },
      });
    });
    this.events.emit('lead.created', { lead, orgId, createdBy });
    return lead;
  }

  async update(orgId: string, id: string, dto: Partial<CreateLeadDto>, userId?: string) {
    const existing = await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      const data = await this.resolveLeadData(tx, orgId, dto);
      return tx.lead.update({ where: { id }, data });
    });

    // Log field-level changes
    if (userId) {
      await this.activityLog.logEntityUpdate(
        orgId,
        userId,
        'lead',
        id,
        existing,
        dto,
      );
    }

    const previousStatusName = (existing as any).status?.name ?? null;
    if (dto.status && dto.status !== previousStatusName) {
      if (dto.status === 'won' || dto.status === 'lost') {
        this.events.emit('lead.status_changed', {
          lead: updated,
          orgId,
          previousStatus: previousStatusName,
          newStatus: dto.status,
        });
      }
    }

    // Trigger AI re-scoring (queued, non-blocking). Listener is in
    // lead-scoring.listener.ts. We deliberately do NOT emit on every
    // raw `prisma.lead.update` — only on explicit user-driven updates
    // — so that the scoring service's own write doesn't loop back.
    this.events.emit('lead.updated', { lead: updated, leadId: id, orgId });

    return updated;
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.lead.delete({ where: { id } });
    });
  }

  // ─── Status ─────────────────────────────────────────────────

  async updateStatus(orgId: string, id: string, status: string) {
    if (!VALID_STATUSES.includes(status as LeadStatus)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      );
    }

    const existing = await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      const data = await this.resolveLeadData(tx, orgId, { status });
      return tx.lead.update({ where: { id }, data });
    });

    this.events.emit('lead.status_changed', {
      lead: updated,
      orgId,
      previousStatus: (existing as any).status?.name ?? null,
      newStatus: status,
    });

    // A status flip is a strong signal; re-score this lead too.
    this.events.emit('lead.updated', { lead: updated, leadId: id, orgId });

    return updated;
  }

  // ─── Convert to Client ──────────────────────────────────────

  async convertToClient(orgId: string, id: string, createdBy: string) {
    const lead = await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const client = await tx.client.create({
        data: {
          organizationId: orgId,
          company: lead.company ?? lead.name,
          phone: lead.phone ?? undefined,
          website: lead.website ?? undefined,
          address: lead.address ?? undefined,
          city: lead.city ?? undefined,
          state: lead.state ?? undefined,
          zipCode: lead.zipCode ?? undefined,
          country: lead.country ?? undefined,
        },
      });

      // Create primary contact (User type=contact) from the lead so the
      // new client immediately has a reachable contact.
      if (lead.email) {
        const [firstName, ...rest] = (lead.name || '').split(' ');
        const lastName = rest.join(' ') || '-';
        const bcrypt = await import('bcryptjs');
        const hash = await bcrypt.hash(
          Math.random().toString(36).slice(-12),
          12,
        );
        // Avoid collisions on unique (organizationId, email)
        const existing = await tx.user.findFirst({
          where: { organizationId: orgId, email: lead.email },
        });
        if (!existing) {
          await tx.user.create({
            data: {
              organizationId: orgId,
              clientId: client.id,
              email: lead.email,
              password: hash,
              passwordFormat: 'bcrypt',
              firstName: firstName || lead.name || 'Contact',
              lastName,
              phone: lead.phone ?? null,
              type: 'contact',
              isPrimary: true,
              active: true,
            },
          });
        }
      }

      await tx.lead.update({
        where: { id },
        data: {
          convertedToClientId: client.id,
          convertedAt: new Date(),
        },
      });

      this.events.emit('lead.converted', {
        lead,
        leadId: id,
        clientId: client.id,
        client,
        orgId,
        createdBy,
      });

      return client;
    });
  }

  // ─── Notes ──────────────────────────────────────────────────

  async addNote(
    orgId: string,
    leadId: string,
    note: string,
    addedById: string,
  ) {
    await this.findOne(orgId, leadId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.leadNote.create({
        data: { leadId, content: note, userId: addedById },
      });
    });
  }

  // ─── Lead Statuses CRUD ──────────────────────────────────────

  async getStatuses(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.leadStatus.findMany({
        where: { organizationId: orgId },
        orderBy: { position: 'asc' },
        include: { _count: { select: { leads: true } } },
      });
    });
  }

  async createStatus(
    orgId: string,
    dto: { name: string; color?: string; isDefault?: boolean },
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const maxPos = await tx.leadStatus.aggregate({
        where: { organizationId: orgId },
        _max: { position: true },
      });
      return tx.leadStatus.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          color: dto.color ?? '#6b7280',
          isDefault: dto.isDefault ?? false,
          position: (maxPos._max.position ?? -1) + 1,
        },
      });
    });
  }

  async updateStatus2(
    orgId: string,
    id: string,
    dto: { name?: string; color?: string; position?: number; isDefault?: boolean },
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.leadStatus.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Lead status not found');
      return tx.leadStatus.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.position !== undefined && { position: dto.position }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        },
      });
    });
  }

  async deleteStatus(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.leadStatus.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Lead status not found');
      const count = await tx.lead.count({ where: { statusId: id } });
      if (count > 0) {
        throw new BadRequestException(
          `Cannot delete status: ${count} leads are using it`,
        );
      }
      await tx.leadStatus.delete({ where: { id } });
    });
  }

  // ─── Lead Sources CRUD ─────────────────────────────────────

  async getSources(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.leadSource.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { leads: true } } },
      });
    });
  }

  async createSource(orgId: string, dto: { name: string }) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.leadSource.create({
        data: { organizationId: orgId, name: dto.name },
      });
    });
  }

  async updateSource(orgId: string, id: string, dto: { name: string }) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.leadSource.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Lead source not found');
      return tx.leadSource.update({
        where: { id },
        data: { name: dto.name },
      });
    });
  }

  async deleteSource(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.leadSource.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Lead source not found');
      const count = await tx.lead.count({ where: { sourceId: id } });
      if (count > 0) {
        throw new BadRequestException(
          `Cannot delete source: ${count} leads are using it`,
        );
      }
      await tx.leadSource.delete({ where: { id } });
    });
  }

  // ─── Emails ─────────────────────────────────────────────────

  async getEmails(orgId: string, leadId: string) {
    await this.findOne(orgId, leadId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).leadEmail.findMany({
        where: { leadId },
        orderBy: { sentAt: 'desc' },
      });
    });
  }

  async logEmail(
    orgId: string,
    leadId: string,
    dto: {
      direction?: string;
      subject?: string;
      body?: string;
      fromEmail?: string;
      toEmail?: string;
    },
  ) {
    await this.findOne(orgId, leadId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).leadEmail.create({
        data: {
          leadId,
          direction: dto.direction ?? 'outbound',
          subject: dto.subject ?? null,
          body: dto.body ?? null,
          fromEmail: dto.fromEmail ?? null,
          toEmail: dto.toEmail ?? null,
        },
      });
    });
  }

  async sendEmail(
    orgId: string,
    leadId: string,
    dto: { to: string; subject: string; body: string },
  ) {
    const lead = await this.findOne(orgId, leadId);

    // Send via EmailsService
    if (this.emailsService) {
      await this.emailsService.queue({
        to: dto.to,
        subject: dto.subject,
        html: dto.body,
      });
    }

    // Log the email
    const email = await this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).leadEmail.create({
        data: {
          leadId,
          direction: 'outbound',
          subject: dto.subject,
          body: dto.body,
          toEmail: dto.to,
        },
      });
    });

    // Update last contact
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: { lastContact: new Date() },
      });
    });

    return email;
  }

  // ─── Web Form ────────────────────────────────────────────────

  async createFromWebForm(
    orgSlug: string,
    dto: {
      name: string;
      email?: string;
      phone?: string;
      company?: string;
      source?: string;
      message?: string;
    },
  ) {
    if (!orgSlug) {
      throw new BadRequestException('orgSlug query parameter is required');
    }
    if (!dto.name) {
      throw new BadRequestException('name is required');
    }

    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });
    if (!org) {
      throw new NotFoundException(`Organization not found for slug: ${orgSlug}`);
    }

    // Find the first (default) lead status for this org
    const defaultStatus = await this.prisma.leadStatus.findFirst({
      where: { organizationId: org.id },
      orderBy: { position: 'asc' },
    });

    // Resolve optional source string to a LeadSource row
    let sourceId: string | null = null;
    if (dto.source) {
      const existingSource = await this.prisma.leadSource.findFirst({
        where: {
          organizationId: org.id,
          name: { equals: dto.source, mode: 'insensitive' },
        },
      });
      if (existingSource) {
        sourceId = existingSource.id;
      } else {
        const created = await this.prisma.leadSource.create({
          data: { organizationId: org.id, name: dto.source },
        });
        sourceId = created.id;
      }
    }

    const lead = await this.prisma.lead.create({
      data: {
        organizationId: org.id,
        name: dto.name,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        company: dto.company ?? null,
        description: dto.message ?? null,
        statusId: defaultStatus?.id ?? null,
        sourceId,
      },
    });

    this.events.emit('lead.created', { lead, orgId: org.id, createdBy: 'web_form' });

    return { success: true, leadId: lead.id };
  }

  // ─── CSV Import ──────────────────────────────────────────────

  /** Exposed for the /import/template route so header stays in sync. */
  static readonly CSV_COLUMNS = LEAD_CSV_COLUMNS;

  /**
   * Import leads from a raw CSV buffer.
   *
   * - Parses with `csv-parse/sync` (handles BOM, quoted commas, CRLF).
   * - Header row is required; names match `LEAD_CSV_COLUMNS`
   *   case-insensitively, with a few snake_case aliases.
   * - `name` is required per row; missing → skipped.
   * - `status` defaults to the org's first lead status if absent or unknown.
   * - `source` / `assigneeEmail` are resolved to FK ids where possible;
   *   unknown values degrade silently to null and produce an entry in
   *   `errors` (without failing the row).
   * - All rows insert inside a single transaction; per-row DB failures
   *   end up in `errors` and processing continues.
   */
  async importFromCsv(orgId: string, csvBuffer: Buffer): Promise<ImportResult> {
    let records: Record<string, string>[];
    try {
      records = parseCsvSync(csvBuffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch (err: any) {
      throw new BadRequestException(`CSV parse failed: ${err.message}`);
    }

    if (records.length === 0) {
      return { imported: 0, skipped: [], errors: [] };
    }

    // Pre-load statuses (with default), sources, assignable staff users,
    // and existing lead emails for dedup so per-row resolution is a cheap
    // map lookup.
    const [statuses, sources, staff, existingEmailRows] = await Promise.all([
      this.prisma.leadStatus.findMany({
        where: { organizationId: orgId },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
      }),
      this.prisma.leadSource.findMany({ where: { organizationId: orgId } }),
      this.prisma.user.findMany({
        where: { organizationId: orgId, type: 'staff', active: true },
        select: { id: true, email: true },
      }),
      this.prisma.lead.findMany({
        where: { organizationId: orgId, email: { not: null } },
        select: { email: true },
      }),
    ]);
    const seenEmails = new Set<string>(
      existingEmailRows
        .map((r) => r.email?.toLowerCase().trim())
        .filter((e): e is string => !!e),
    );

    const defaultStatus = statuses[0] ?? null;
    const statusIndex = new Map<string, string>(
      statuses.map((s) => [s.name.toLowerCase(), s.id]),
    );
    const sourceIndex = new Map<string, string>(
      sources.map((s) => [s.name.toLowerCase(), s.id]),
    );
    const staffIndex = new Map<string, string>(
      staff.map((u) => [u.email.toLowerCase(), u.id]),
    );

    const skipped: ImportSkipped[] = [];
    const errors: ImportError[] = [];
    let imported = 0;

    const pick = (row: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) {
        const v = row[k.toLowerCase()];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          return String(v).trim();
        }
      }
      return null;
    };

    await this.prisma.withOrganization(orgId, async (tx) => {
      for (let i = 0; i < records.length; i++) {
        const rowNum = i + 2;
        const row = records[i];

        const name = pick(row, 'name', 'lead_name', 'full_name');
        if (!name) {
          skipped.push({ row: rowNum, reason: 'missing required field: name' });
          continue;
        }

        const email = pick(row, 'email');
        if (email) {
          const normalized = email.toLowerCase();
          if (seenEmails.has(normalized)) {
            skipped.push({
              row: rowNum,
              reason: `duplicate: lead with email "${email}" already exists`,
            });
            continue;
          }
          seenEmails.add(normalized);
        }
        const phone = pick(row, 'phone', 'telephone');
        const company = pick(row, 'company', 'company_name');
        const sourceRaw = pick(row, 'source');
        const statusRaw = pick(row, 'status');
        const assigneeEmailRaw = pick(
          row,
          'assigneeemail',
          'assignee_email',
          'assignee',
          'owner_email',
        );
        const notes = pick(row, 'notes', 'note', 'description');

        // Resolve status — fall back to default on missing/unknown
        let statusId: string | null = null;
        if (statusRaw) {
          const match = statusIndex.get(statusRaw.toLowerCase());
          if (match) {
            statusId = match;
          } else {
            errors.push({
              row: rowNum,
              field: 'status',
              message: `unknown status "${statusRaw}" — using default`,
            });
            statusId = defaultStatus?.id ?? null;
          }
        } else {
          statusId = defaultStatus?.id ?? null;
        }

        // Resolve source (unknown → null, non-fatal)
        let sourceId: string | null = null;
        if (sourceRaw) {
          sourceId = sourceIndex.get(sourceRaw.toLowerCase()) ?? null;
          if (!sourceId) {
            errors.push({
              row: rowNum,
              field: 'source',
              message: `unknown source "${sourceRaw}" — ignored`,
            });
          }
        }

        // Resolve assignee email → staff user id (unknown → null, non-fatal)
        let assignedTo: string | null = null;
        if (assigneeEmailRaw) {
          assignedTo = staffIndex.get(assigneeEmailRaw.toLowerCase()) ?? null;
          if (!assignedTo) {
            errors.push({
              row: rowNum,
              field: 'assigneeEmail',
              message: `no staff user with email "${assigneeEmailRaw}" — left unassigned`,
            });
          }
        }

        try {
          const created = await tx.lead.create({
            data: {
              organizationId: orgId,
              name,
              email,
              phone,
              company,
              description: notes,
              statusId,
              sourceId,
              assignedTo,
            },
          });
          imported++;
          // fire-and-forget event so downstream listeners (automations etc.)
          // see the new lead, same as the public create() path.
          this.events.emit('lead.created', {
            lead: created,
            orgId,
            createdBy: 'csv_import',
          });
        } catch (err: any) {
          errors.push({
            row: rowNum,
            field: 'row',
            message: err?.message ?? 'Insert failed',
          });
        }
      }
    });

    return { imported, skipped, errors };
  }

  // ─── Kanban Board ────────────────────────────────────────────

  async getKanbanBoard(
    orgId: string,
    /**
     * Optional caller — same Wave G1 visibility-scope contract as
     * findAll/findAllForExport. Without it, a sales rep with
     * `leads.view` would see the entire tenant on the kanban board
     * regardless of ownership.
     */
    currentUser?: {
      id: string;
      isAdmin?: boolean;
      role?: { permissions?: Record<string, Record<string, boolean>> };
    },
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // mergedIntoId: null — keep merged-away losers off the kanban board (migration 045).
      const where: any = { organizationId: orgId, mergedIntoId: null };

      const scopedWhere =
        currentUser && currentUser.isAdmin !== true
          ? await this.recordSharing.applyVisibilityScopeTx(
              tx,
              orgId,
              currentUser.id,
              currentUser.role?.permissions,
              where,
              'assignedTo',
            )
          : where;

      const leads = await tx.lead.findMany({
        where: scopedWhere,
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          value: true,
          assignedTo: true,
          score: true, // surface AI-powered lead score on kanban cards
          status: { select: { id: true, name: true, color: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const board: Record<LeadStatus, typeof leads> = {
        new: [],
        contacted: [],
        qualified: [],
        proposal: [],
        negotiation: [],
        won: [],
        lost: [],
      };

      for (const lead of leads) {
        const bucket = (lead.status?.name ?? '').toLowerCase() as LeadStatus;
        if (bucket in board) {
          board[bucket].push(lead);
        }
      }

      return board;
    });
  }
}
