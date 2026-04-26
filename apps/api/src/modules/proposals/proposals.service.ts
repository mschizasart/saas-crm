import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { EXPORT_ROW_CAP } from '../../common/csv/csv-writer';

export interface CreateProposalDto {
  subject: string;
  clientId?: string;
  content?: string;
  totalValue?: number;
  currency?: string;
  allowComments?: boolean;
  assignedTo?: string;
  /**
   * Optional line items. Most proposal flows are content-only (the rich-text
   * editor carries the body), but the schema supports items so external
   * callers (or a future quote-builder UI) can attach them. Each line may
   * carry a productId FK validated against the same orgId.
   */
  items?: Array<{
    description: string;
    longDescription?: string;
    qty?: number;
    rate?: number;
    tax1?: string;
    tax2?: string;
    unit?: string;
    order?: number;
    productId?: string | null;
  }>;
}

/**
 * Validate that every productId on a line refers to a product owned by this
 * org. Done in a single query — never loop a per-id check.
 */
async function assertProductIdsBelongToOrg(
  prisma: PrismaService,
  orgId: string,
  items: Array<{ productId?: string | null }>,
): Promise<void> {
  const ids = Array.from(
    new Set(
      items
        .map((it) => it.productId)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  );
  if (ids.length === 0) return;
  const found = await prisma.product.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new BadRequestException(
      'Product does not belong to your organization',
    );
  }
}

// Statuses that allow editing
const EDITABLE_STATUSES = ['draft', 'revising'];

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Export ────────────────────────────────────────────────────────────────
  async findAllForExport(
    orgId: string,
    query: { search?: string; status?: string } = {},
  ): Promise<{ rows: any[]; truncated: boolean }> {
    const { search, status } = query;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { subject: { contains: search, mode: 'insensitive' } },
          { client: { company: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const rows = await (tx as any).proposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_CAP + 1,
        include: {
          client: { select: { company: true } },
        },
      });

      const truncated = rows.length > EXPORT_ROW_CAP;
      if (truncated) {
        this.logger.warn(
          `Proposals export truncated at ${EXPORT_ROW_CAP} rows for org ${orgId}`,
        );
      }
      return { rows: truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows, truncated };
    });
  }

  // ─── findAll ───────────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      assignedTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, assignedTo, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      // NOTE: Proposal schema has no assignedTo field; ignore filter
      if (search) {
        where.OR = [
          { subject: { contains: search, mode: 'insensitive' } },
          { client: { company: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        (tx as any).proposal.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
          },
        }),
        tx.proposal.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const proposal = await (tx as any).proposal.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          items: { orderBy: { order: 'asc' } },
          comments: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!proposal) throw new NotFoundException('Proposal not found');
      return proposal;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateProposalDto, createdBy: string) {
    if (dto.items?.length) {
      await assertProductIdsBelongToOrg(this.prisma, orgId, dto.items);
    }

    const proposal = await this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).proposal.create({
        data: {
          organizationId: orgId,
          subject: dto.subject,
          clientId: dto.clientId ?? null,
          content: dto.content ?? '',
          status: 'draft',
          total: dto.totalValue ?? null,
          currency: dto.currency ?? null,
          allowComments: dto.allowComments ?? true,
          hash: randomUUID(),
          dateCreated: new Date(),
          ...(dto.items?.length
            ? {
                items: {
                  createMany: {
                    data: dto.items.map((item, index) => ({
                      description: item.description,
                      longDesc: item.longDescription ?? null,
                      qty: Number(item.qty ?? 0),
                      rate: Number(item.rate ?? 0),
                      tax1: item.tax1 ?? null,
                      tax2: item.tax2 ?? null,
                      unit: item.unit ?? null,
                      order: item.order ?? index,
                      productId: item.productId ?? null,
                    })),
                  },
                },
              }
            : {}),
        },
        include: {
          client: { select: { id: true, company: true } },
        },
      });
    });

    this.events.emit('proposal.created', { proposal, orgId, createdBy });
    return proposal;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateProposalDto>) {
    const existing = await this.findOne(orgId, id);
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        'Only proposals in draft or revising status can be edited',
      );
    }

    if (dto.items) {
      await assertProductIdsBelongToOrg(this.prisma, orgId, dto.items);
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      // If items were provided, replace them wholesale (delete-then-recreate).
      // Anything not present in the payload — including productId — is dropped,
      // so the caller is responsible for round-tripping productId.
      if (dto.items) {
        await tx.proposalItem.deleteMany({ where: { proposalId: id } });
        if (dto.items.length > 0) {
          await tx.proposalItem.createMany({
            data: dto.items.map((item, index) => ({
              proposalId: id,
              description: item.description,
              longDesc: item.longDescription ?? null,
              qty: Number(item.qty ?? 0),
              rate: Number(item.rate ?? 0),
              tax1: item.tax1 ?? null,
              tax2: item.tax2 ?? null,
              unit: item.unit ?? null,
              order: item.order ?? index,
              productId: item.productId ?? null,
            })),
          });
        }
      }

      return (tx as any).proposal.update({
        where: { id },
        data: {
          ...(dto.subject !== undefined && { subject: dto.subject }),
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.content !== undefined && { content: dto.content }),
          ...(dto.totalValue !== undefined && { total: dto.totalValue }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.allowComments !== undefined && {
            allowComments: dto.allowComments,
          }),
        },
        include: {
          client: { select: { id: true, company: true } },
        },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException('Only draft proposals can be deleted');
    }

    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.proposalComment.deleteMany({ where: { proposalId: id } });
      await tx.proposalItem.deleteMany({ where: { proposalId: id } });
      await tx.proposal.delete({ where: { id } });
    });

    this.events.emit('proposal.deleted', { id, orgId });
  }

  // ─── bulkUpdateStatus ──────────────────────────────────────────────────────
  // Like updateStatus, but for many ids at once. Accepts both `revised` and
  // `revising`; normalizes to the canonical persisted value. Terminal statuses
  // (`accepted`/`declined`) are skipped to avoid accidentally reversing a
  // client decision via a mass action.
  async bulkUpdateStatus(
    orgId: string,
    proposalIds: string[],
    rawStatus: string,
    userId?: string,
  ): Promise<{ updated: number; skipped: Array<{ id: string; reason: string }> }> {
    const normalized = rawStatus === 'revised' ? 'revising' : rawStatus;
    const allowedTargets = [
      'draft',
      'sent',
      'open',
      'revising',
      'declined',
      'accepted',
    ];
    if (!allowedTargets.includes(normalized)) {
      throw new BadRequestException(
        `Invalid proposal status '${rawStatus}'. Allowed: draft | sent | open | revised | revising | declined | accepted`,
      );
    }
    const ids = Array.from(new Set(proposalIds ?? [])).filter(Boolean);
    if (ids.length === 0) return { updated: 0, skipped: [] };

    const skipped: Array<{ id: string; reason: string }> = [];
    let updated = 0;

    await this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await (tx as any).proposal.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        select: { id: true, status: true },
      });
      const foundIds = new Set<string>(existing.map((e: any) => e.id));
      for (const id of ids) {
        if (!foundIds.has(id)) skipped.push({ id, reason: 'not found' });
      }

      for (const p of existing as Array<{ id: string; status: string }>) {
        if (p.status === normalized) {
          skipped.push({ id: p.id, reason: `already ${normalized}` });
          continue;
        }
        if (
          (p.status === 'accepted' || p.status === 'declined') &&
          normalized !== 'revising'
        ) {
          skipped.push({
            id: p.id,
            reason: `cannot transition from '${p.status}' to '${normalized}'`,
          });
          continue;
        }
        await (tx as any).proposal.update({
          where: { id: p.id },
          data: { status: normalized },
        });
        updated += 1;
        this.events.emit('proposal.status_changed', {
          proposal: { ...p, status: normalized },
          orgId,
          previousStatus: p.status,
          newStatus: normalized,
          userId,
        });
      }
    });

    return { updated, skipped };
  }

  // ─── updateStatus (generic, for kanban drops) ───────────────────────────

  async updateStatus(
    orgId: string,
    id: string,
    rawStatus: string,
    userId?: string,
  ) {
    // Accept both `revised` (schema comment) and `revising` (persisted value).
    // Normalize to the value the rest of the service actually writes.
    const normalized = rawStatus === 'revised' ? 'revising' : rawStatus;

    const allowed = [
      'draft',
      'sent',
      'open',
      'revising',
      'declined',
      'accepted',
    ];
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(
        `Invalid proposal status '${rawStatus}'. Allowed: draft | sent | open | revised | revising | declined | accepted`,
      );
    }

    const existing = await this.findOne(orgId, id);
    const previousStatus = existing.status;

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).proposal.update({
        where: { id },
        data: { status: normalized },
      });
    });

    this.events.emit('proposal.status_changed', {
      proposal: updated,
      orgId,
      previousStatus,
      newStatus: normalized,
      userId,
    });

    return updated;
  }

  // ─── send ──────────────────────────────────────────────────────────────────

  async send(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (!EDITABLE_STATUSES.includes(existing.status) && existing.status !== 'sent') {
      throw new BadRequestException(
        `Proposal with status '${existing.status}' cannot be sent`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.proposal.update({
        where: { id },
        data: { status: 'sent' },
      });
    });

    this.events.emit('proposal.sent', { proposal: updated, orgId });
    return updated;
  }

  // ─── markOpen (public) ────────────────────────────────────────────────────

  async markOpen(hash: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { hash } });
    if (!proposal) throw new NotFoundException('Proposal not found');

    if (proposal.status !== 'sent') return proposal;

    const updated = await (this.prisma as any).proposal.update({
      where: { hash },
      data: { status: 'open' },
    });

    this.events.emit('proposal.opened', { proposal: updated });
    return updated;
  }

  // ─── accept (public) ──────────────────────────────────────────────────────

  async accept(hash: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { hash } });
    if (!proposal) throw new NotFoundException('Proposal not found');

    if (!['sent', 'open'].includes(proposal.status)) {
      throw new BadRequestException(
        `Proposal cannot be accepted in status '${proposal.status}'`,
      );
    }

    const updated = await (this.prisma as any).proposal.update({
      where: { hash },
      data: { status: 'accepted', signedAt: new Date() },
    });

    this.events.emit('proposal.accepted', { proposal: updated });
    return updated;
  }

  // ─── decline (public) ─────────────────────────────────────────────────────

  async decline(hash: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { hash } });
    if (!proposal) throw new NotFoundException('Proposal not found');

    if (!['sent', 'open'].includes(proposal.status)) {
      throw new BadRequestException(
        `Proposal cannot be declined in status '${proposal.status}'`,
      );
    }

    return (this.prisma as any).proposal.update({
      where: { hash },
      data: { status: 'declined' },
    });
  }

  // ─── addComment ───────────────────────────────────────────────────────────

  async addComment(
    proposalId: string,
    content: string,
    isStaff: boolean,
    addedBy: string,
    orgId?: string,
  ) {
    if (orgId) {
      const proposal = await this.prisma.proposal.findFirst({
        where: { id: proposalId, organizationId: orgId },
        select: { id: true, allowComments: true },
      });
      if (!proposal) throw new NotFoundException('Proposal not found');
      if (!proposal.allowComments) {
        throw new BadRequestException('Comments are disabled on this proposal');
      }
    } else {
      const proposal = await this.prisma.proposal.findUnique({
        where: { id: proposalId },
        select: { id: true, allowComments: true },
      });
      if (!proposal) throw new NotFoundException('Proposal not found');
      if (!proposal.allowComments) {
        throw new BadRequestException('Comments are disabled on this proposal');
      }
    }

    return (this.prisma as any).proposalComment.create({
      data: {
        proposalId,
        content,
        userId: addedBy,
      },
    });
  }

  // ─── getByHash (public) ───────────────────────────────────────────────────

  async getByHash(hash: string) {
    const proposal = await (this.prisma as any).proposal.findUnique({
      where: { hash },
      include: {
        client: { select: { id: true, company: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');

    // Return safe fields only — omit internal fields
    const { organizationId: _org, ...safe } = proposal as any;

    return safe;
  }

  // ─── getStats ─────────────────────────────────────────────────────────────

  async getStats(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const statuses = ['draft', 'sent', 'open', 'accepted', 'declined', 'revising'];

      const counts = await Promise.all(
        statuses.map((status) =>
          tx.proposal.count({ where: { organizationId: orgId, status } }),
        ),
      );

      return statuses.reduce(
        (acc, status, i) => ({ ...acc, [status]: counts[i] }),
        {} as Record<string, number>,
      );
    });
  }
}
