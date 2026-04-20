import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';

export interface CreateProposalDto {
  subject: string;
  clientId?: string;
  content?: string;
  totalValue?: number;
  currency?: string;
  allowComments?: boolean;
  assignedTo?: string;
}

// Statuses that allow editing
const EDITABLE_STATUSES = ['draft', 'revising'];

@Injectable()
export class ProposalsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

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

    return this.prisma.withOrganization(orgId, async (tx) => {
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
      await tx.proposal.delete({ where: { id } });
    });

    this.events.emit('proposal.deleted', { id, orgId });
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
