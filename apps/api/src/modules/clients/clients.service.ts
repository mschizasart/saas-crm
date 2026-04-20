import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityLogService } from '../activity-log/activity-log.service';

export interface CreateClientDto {
  company: string;
  groupId?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  website?: string;
  phone?: string;
  vat?: string;
  currencyId?: string;
  defaultLanguage?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingCountry?: string;
}

export interface CreateContactDto {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  phoneMobile?: string;
  isPrimary?: boolean;
}

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private activityLog: ActivityLogService,
  ) {}

  // ─── Clients CRUD ──────────────────────────────────────────

  async findAll(
    orgId: string,
    query: { search?: string; page?: number; limit?: number; active?: boolean },
  ) {
    const { search, page = 1, limit = 20, active } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (search) where.company = { contains: search, mode: 'insensitive' };
      if (active !== undefined) where.active = active;

      const [data, total] = await Promise.all([
        tx.client.findMany({
          where,
          skip,
          take: limit,
          orderBy: { company: 'asc' },
          include: {
            group: { select: { id: true, name: true } },
            currency: { select: { id: true, symbol: true, name: true } },
            _count: { select: { invoices: true, projects: true, tickets: true } },
          },
        }),
        tx.client.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id, organizationId: orgId },
        include: {
          group: true,
          currency: true,
          contacts: {
            where: { type: 'contact', active: true },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              isPrimary: true,
            },
          },
          customFieldValues: { include: { field: true } },
          _count: {
            select: {
              invoices: true,
              projects: true,
              tickets: true,
              contracts: true,
            },
          },
        },
      });
      if (!client) throw new NotFoundException('Client not found');
      return client;
    });
  }

  async create(orgId: string, dto: CreateClientDto, createdBy: string) {
    const client = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.create({ data: { ...dto, organizationId: orgId } });
    });
    this.events.emit('client.created', { client, orgId, createdBy });
    return client;
  }

  async update(orgId: string, id: string, dto: Partial<CreateClientDto>, userId?: string) {
    const existing = await this.findOne(orgId, id);
    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.update({ where: { id }, data: dto });
    });

    // Log field-level changes
    if (userId) {
      await this.activityLog.logEntityUpdate(
        orgId,
        userId,
        'client',
        id,
        existing,
        dto,
      );
    }

    return updated;
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.client.delete({ where: { id } });
    });
    this.events.emit('client.deleted', { id, orgId });
  }

  async toggleActive(orgId: string, id: string) {
    const client = await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.update({
        where: { id },
        data: { active: !client.active },
      });
    });
  }

  // ─── Contacts ──────────────────────────────────────────────

  async getContacts(orgId: string, clientId: string) {
    await this.findOne(orgId, clientId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.findMany({
        where: { organizationId: orgId, clientId, type: 'contact' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isPrimary: true,
          active: true,
          lastLogin: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
      });
    });
  }

  async createContact(orgId: string, clientId: string, dto: CreateContactDto) {
    await this.findOne(orgId, clientId);
    const existing = await this.prisma.user.findFirst({
      where: { organizationId: orgId, email: dto.email },
    });
    if (existing) throw new ConflictException('A user with this email already exists');

    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(Math.random().toString(36).slice(-12), 12);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.create({
        data: {
          organizationId: orgId,
          email: dto.email,
          password: hash,
          passwordFormat: 'bcrypt',
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          phoneMobile: dto.phoneMobile,
          type: 'contact',
          clientId,
          isPrimary: dto.isPrimary ?? false,
          active: true,
        },
      });
    });
  }

  // ─── Groups ────────────────────────────────────────────────

  async getGroups(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.clientGroup.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { clients: true } } },
        orderBy: { name: 'asc' },
      });
    });
  }

  async createGroup(orgId: string, name: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.clientGroup.create({
        data: { organizationId: orgId, name },
      });
    });
  }

  async deleteGroup(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.clientGroup.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Client group not found');
      // Set groupId to null on clients in this group
      await tx.client.updateMany({ where: { groupId: id, organizationId: orgId }, data: { groupId: null } });
      await tx.clientGroup.delete({ where: { id } });
    });
  }

  // ─── Statement ─────────────────────────────────────────────

  async getStatement(
    orgId: string,
    clientId: string,
    options?: { from?: Date; to?: Date },
  ) {
    await this.findOne(orgId, clientId);
    const dateFilter: any = {};
    if (options?.from) dateFilter.gte = options.from;
    if (options?.to) dateFilter.lte = options.to;
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const invoiceWhere: any = { clientId, organizationId: orgId };
      if (hasDateFilter) invoiceWhere.date = dateFilter;
      const paymentWhere: any = { clientId, organizationId: orgId };
      if (hasDateFilter) paymentWhere.paymentDate = dateFilter;

      const [invoices, payments] = await Promise.all([
        tx.invoice.findMany({
          where: invoiceWhere,
          select: { id: true, number: true, date: true, total: true, status: true },
          orderBy: { date: 'desc' },
        }),
        tx.payment.findMany({
          where: paymentWhere,
          select: { id: true, amount: true, paymentDate: true, transactionId: true },
          orderBy: { paymentDate: 'desc' },
        }),
      ]);
      return { invoices, payments };
    });
  }
}
