import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

export interface CreateVaultDto {
  name: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  clientId: string;
}

export type UpdateVaultDto = Partial<CreateVaultDto>;

@Injectable()
export class VaultService {
  private key: Buffer;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const keyHex =
      this.config.get<string>('VAULT_ENCRYPTION_KEY') ??
      '0000000000000000000000000000000000000000000000000000000000000000';
    this.key = Buffer.from(keyHex, 'hex');
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(encrypted: string): string {
    const [ivHex, tagHex, dataHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  private stripPassword<T extends { password?: string | null }>(entry: T) {
    const { password, ...rest } = entry;
    return { ...rest, hasPassword: !!password };
  }

  async findAll(
    orgId: string,
    query: {
      search?: string;
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, clientId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (clientId) where.clientId = clientId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { url: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [entries, total] = await Promise.all([
        tx.vaultEntry.findMany({
          where,
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
          },
        }),
        tx.vaultEntry.count({ where }),
      ]);

      return {
        data: entries.map((e: any) => this.stripPassword(e)),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const entry = await tx.vaultEntry.findFirst({
        where: { id, organizationId: orgId },
        include: { client: { select: { id: true, company: true } } },
      });
      if (!entry) throw new NotFoundException('Vault entry not found');
      return this.stripPassword(entry as any);
    });
  }

  async reveal(orgId: string, id: string): Promise<{ password: string }> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const entry = await tx.vaultEntry.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!entry) throw new NotFoundException('Vault entry not found');
      const password = entry.password ? this.decrypt(entry.password) : '';
      return { password };
    });
  }

  async create(orgId: string, dto: CreateVaultDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const created = await tx.vaultEntry.create({
        data: {
          organizationId: orgId,
          clientId: dto.clientId,
          name: dto.name,
          username: dto.username ?? null,
          password: dto.password ? this.encrypt(dto.password) : null,
          url: dto.url ?? null,
          notes: dto.notes ?? null,
        },
        include: { client: { select: { id: true, company: true } } },
      });
      return this.stripPassword(created as any);
    });
  }

  async update(orgId: string, id: string, dto: UpdateVaultDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.vaultEntry.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Vault entry not found');

      const updated = await tx.vaultEntry.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.username !== undefined && { username: dto.username }),
          ...(dto.url !== undefined && { url: dto.url }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.password !== undefined && {
            password: dto.password ? this.encrypt(dto.password) : null,
          }),
        },
        include: { client: { select: { id: true, company: true } } },
      });
      return this.stripPassword(updated as any);
    });
  }

  async delete(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.vaultEntry.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Vault entry not found');
      await tx.vaultEntry.delete({ where: { id } });
    });
  }
}
