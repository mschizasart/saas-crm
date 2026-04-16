import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateContractDto {
  subject: string;
  clientId?: string;
  content?: string;
  type?: string;
  value?: number;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class ContractsService {
  static MERGE_FIELDS = [
    { key: '{client_name}', label: 'Client Company Name' },
    { key: '{contact_name}', label: 'Primary Contact Name' },
    { key: '{contact_email}', label: 'Primary Contact Email' },
    { key: '{contract_value}', label: 'Contract Value' },
    { key: '{start_date}', label: 'Start Date' },
    { key: '{end_date}', label: 'End Date' },
    { key: '{today}', label: "Today's Date" },
    { key: '{organization_name}', label: 'Your Company Name' },
    { key: '{organization_address}', label: 'Your Company Address' },
  ];

  static getAvailableMergeFields() {
    return ContractsService.MERGE_FIELDS;
  }

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
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, clientId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (clientId) where.clientId = clientId;
      if (search) {
        where.OR = [
          { subject: { contains: search, mode: 'insensitive' } },
          { client: { company: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.contract.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            creator: { select: { firstName: true, lastName: true } },
            _count: { select: { comments: true } },
          },
        }),
        tx.contract.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const contract = await tx.contract.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          creator: { select: { id: true, firstName: true, lastName: true, email: true } },
          comments: {
            orderBy: { createdAt: 'asc' },
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
      if (!contract) throw new NotFoundException('Contract not found');
      return contract;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateContractDto, createdBy: string) {
    const contract = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contract.create({
        data: {
          organizationId: orgId,
          clientId: dto.clientId ?? null,
          subject: dto.subject,
          content: dto.content ?? null,
          type: dto.type ?? null,
          status: 'draft',
          value: dto.value ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          createdBy,
        },
        include: {
          client: { select: { id: true, company: true } },
          creator: { select: { firstName: true, lastName: true } },
        },
      });
    });

    this.events.emit('contract.created', { contract, orgId, createdBy });
    return contract;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateContractDto>) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException('Only draft contracts can be edited');
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contract.update({
        where: { id },
        data: {
          ...(dto.subject !== undefined && { subject: dto.subject }),
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.content !== undefined && { content: dto.content }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.value !== undefined && { value: dto.value }),
          ...(dto.startDate !== undefined && {
            startDate: dto.startDate ? new Date(dto.startDate) : null,
          }),
          ...(dto.endDate !== undefined && {
            endDate: dto.endDate ? new Date(dto.endDate) : null,
          }),
        },
        include: {
          client: { select: { id: true, company: true } },
          creator: { select: { firstName: true, lastName: true } },
        },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    const contract = await this.findOne(orgId, id);
    if (contract.status !== 'draft') {
      throw new BadRequestException('Only draft contracts can be deleted');
    }
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.contractComment.deleteMany({ where: { contractId: id } });
      await tx.contract.delete({ where: { id } });
    });
    this.events.emit('contract.deleted', { id, orgId });
  }

  // ─── sendForSigning ───────────────────────────────────────────────────────

  async sendForSigning(orgId: string, id: string) {
    const contract = await this.findOne(orgId, id);
    if (contract.status !== 'draft') {
      throw new BadRequestException(
        `Contract with status '${contract.status}' cannot be sent for signing`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.contract.update({
        where: { id },
        data: { status: 'pending_signature' },
      });
      return tx.contract.findUnique({
        where: { id },
        include: {
          client: {
            include: {
              contacts: {
                where: { type: 'contact', active: true },
                take: 5,
              },
            },
          },
          organization: { select: { id: true, name: true } },
        },
      });
    });

    this.events.emit('contract.sent_for_signing', { contract: updated, orgId });
    return updated;
  }

  // ─── sign (public — no orgId scoping) ─────────────────────────────────────

  async sign(
    hash: string,
    signatureData: string,
    signedByName: string,
    signedByEmail: string,
  ) {
    const contract = await this.prisma.contract.findUnique({ where: { hash } });
    if (!contract) throw new NotFoundException('Contract not found');
    if (contract.status !== 'pending_signature') {
      throw new BadRequestException(
        'This contract is not awaiting a signature',
      );
    }

    const updated = await this.prisma.contract.update({
      where: { hash },
      data: {
        status: 'active',
        signedAt: new Date(),
        signatureData,
        signedByName,
        signedByEmail,
      },
    });

    this.events.emit('contract.signed', {
      contract: updated,
      orgId: updated.organizationId,
    });
    return updated;
  }

  // ─── getByHash (public — safe fields only) ────────────────────────────────

  async getByHash(hash: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { hash },
      include: {
        client: { select: { id: true, company: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    // Return only fields safe for public consumption
    return {
      id: contract.id,
      subject: contract.subject,
      content: contract.content,
      type: contract.type,
      status: contract.status,
      value: contract.value,
      startDate: contract.startDate,
      endDate: contract.endDate,
      signedAt: contract.signedAt,
      signedByName: contract.signedByName,
      signedByEmail: contract.signedByEmail,
      hash: contract.hash,
      client: contract.client,
    };
  }

  // ─── addComment ───────────────────────────────────────────────────────────

  async addComment(
    orgId: string,
    contractId: string,
    content: string,
    userId: string,
  ) {
    // Verify contract belongs to org
    await this.findOne(orgId, contractId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contractComment.create({
        data: { contractId, content, userId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  }

  // ─── Contract Types ────────────────────────────────────────────────────────

  async getContractTypes(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contractType.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { contracts: true } } },
        orderBy: { name: 'asc' },
      });
    });
  }

  async createContractType(orgId: string, name: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contractType.create({
        data: { organizationId: orgId, name },
      });
    });
  }

  async deleteContractType(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.contractType.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Contract type not found');
      await tx.contractType.delete({ where: { id } });
    });
  }

  // ─── getStats ─────────────────────────────────────────────────────────────

  async getStats(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const [draft, pending_signature, active, expired, cancelled] =
        await Promise.all([
          tx.contract.count({ where: { organizationId: orgId, status: 'draft' } }),
          tx.contract.count({ where: { organizationId: orgId, status: 'pending_signature' } }),
          tx.contract.count({ where: { organizationId: orgId, status: 'active' } }),
          tx.contract.count({ where: { organizationId: orgId, status: 'expired' } }),
          tx.contract.count({ where: { organizationId: orgId, status: 'cancelled' } }),
        ]);

      return { draft, pending_signature, active, expired, cancelled };
    });
  }

  // ─── renderContent (merge fields) ─────────────────────────────────────────

  async renderContent(orgId: string, contractId: string) {
    const contract = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contract.findFirst({
        where: { id: contractId, organizationId: orgId },
        include: {
          client: {
            include: {
              contacts: {
                where: { type: 'contact', active: true },
                take: 1,
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          organization: {
            select: { id: true, name: true, address: true },
          },
        },
      });
    });

    if (!contract) throw new NotFoundException('Contract not found');

    let html = contract.content ?? '';
    const primaryContact = (contract.client as any)?.contacts?.[0];
    const org = (contract as any).organization;

    const replacements: Record<string, string> = {
      '{client_name}': (contract.client as any)?.company ?? '',
      '{contact_name}': primaryContact
        ? `${primaryContact.firstName ?? ''} ${primaryContact.lastName ?? ''}`.trim()
        : '',
      '{contact_email}': primaryContact?.email ?? '',
      '{contract_value}': contract.value != null ? String(contract.value) : '',
      '{start_date}': contract.startDate
        ? new Date(contract.startDate).toLocaleDateString()
        : '',
      '{end_date}': contract.endDate
        ? new Date(contract.endDate).toLocaleDateString()
        : '',
      '{today}': new Date().toLocaleDateString(),
      '{organization_name}': org?.name ?? '',
      '{organization_address}': org?.address ?? '',
    };

    for (const [key, value] of Object.entries(replacements)) {
      html = html.split(key).join(value);
    }

    return { content: html };
  }

  // ─── renew ────────────────────────────────────────────────────────────────

  async renew(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);

    const now = new Date();
    const oneYearLater = new Date(now);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    const renewed = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.contract.create({
        data: {
          organizationId: orgId,
          clientId: existing.clientId ?? null,
          subject: `${existing.subject} (Renewed)`,
          content: existing.content ?? null,
          type: existing.type ?? null,
          status: 'draft',
          value: existing.value ?? null,
          startDate: now,
          endDate: oneYearLater,
          createdBy: existing.createdBy,
        },
        include: {
          client: { select: { id: true, company: true } },
          creator: { select: { firstName: true, lastName: true } },
        },
      });
    });

    this.events.emit('contract.renewed', {
      contract: renewed,
      orgId,
      renewedFrom: id,
    });

    return renewed;
  }
}
