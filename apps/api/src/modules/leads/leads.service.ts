import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── List / Find ────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      assignedToId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, assignedToId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (status) where.status = status;
      if (assignedToId) where.assignedToId = assignedToId;

      const [data, total] = await Promise.all([
        tx.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            assignedTo: {
              select: { id: true, firstName: true, lastName: true },
            },
            _count: { select: { notes: true } },
          },
        }),
        tx.lead.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, organizationId: orgId },
        include: {
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
          notes: {
            orderBy: { createdAt: 'desc' },
            include: {
              addedBy: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          customFieldValues: { include: { field: true } },
        },
      });
      if (!lead) throw new NotFoundException('Lead not found');
      return lead;
    });
  }

  // ─── Create / Update / Delete ───────────────────────────────

  async create(orgId: string, dto: CreateLeadDto, createdBy: string) {
    const lead = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.lead.create({
        data: {
          ...dto,
          organizationId: orgId,
          status: dto.status ?? 'new',
        },
      });
    });
    this.events.emit('lead.created', { lead, orgId, createdBy });
    return lead;
  }

  async update(orgId: string, id: string, dto: Partial<CreateLeadDto>) {
    const existing = await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.lead.update({ where: { id }, data: dto });
    });

    if (dto.status && dto.status !== existing.status) {
      if (dto.status === 'won' || dto.status === 'lost') {
        this.events.emit('lead.status_changed', {
          lead: updated,
          orgId,
          previousStatus: existing.status,
          newStatus: dto.status,
        });
      }
    }

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
      return tx.lead.update({ where: { id }, data: { status } });
    });

    this.events.emit('lead.status_changed', {
      lead: updated,
      orgId,
      previousStatus: existing.status,
      newStatus: status,
    });

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
        const bcrypt = await import('bcrypt');
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
        data: { leadId, note, addedById },
        include: {
          addedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  }

  // ─── Kanban Board ────────────────────────────────────────────

  async getKanbanBoard(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const leads = await tx.lead.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
          budget: true,
          status: true,
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
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
        const bucket = lead.status as LeadStatus;
        if (bucket in board) {
          board[bucket].push(lead);
        }
      }

      return board;
    });
  }
}
