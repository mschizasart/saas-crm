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
      return tx.contract.update({
        where: { id },
        data: { status: 'pending_signature' },
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
}
