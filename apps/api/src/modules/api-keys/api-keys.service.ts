import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new API key. Returns the full key ONCE — it is never stored in plaintext.
   */
  async create(orgId: string, name: string, expiresAt?: string) {
    const rawKey = `ak_${crypto.randomBytes(24).toString('base64url')}`;
    const keyPrefix = rawKey.substring(0, 11); // "ak_" + 8 chars
    const keyHash = await bcrypt.hash(rawKey, 10);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId: orgId,
        name,
        keyHash,
        keyPrefix,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        active: true,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      key: rawKey, // Only returned once
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Validate an API key. Returns orgId if valid, null otherwise.
   */
  async validate(key: string): Promise<{ orgId: string; keyId: string } | null> {
    if (!key || !key.startsWith('ak_')) return null;

    const prefix = key.substring(0, 11);

    // Find candidate keys by prefix
    const candidates = await this.prisma.apiKey.findMany({
      where: {
        keyPrefix: prefix,
        active: true,
      },
    });

    for (const candidate of candidates) {
      const match = await bcrypt.compare(key, candidate.keyHash);
      if (match) {
        // Check expiry
        if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) {
          return null;
        }

        // Update lastUsedAt (fire-and-forget)
        this.prisma.apiKey
          .update({
            where: { id: candidate.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {});

        return { orgId: candidate.organizationId, keyId: candidate.id };
      }
    }

    return null;
  }

  /**
   * List all keys for an org — never exposes full key or hash.
   */
  async findAll(orgId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Soft-delete: deactivate the key but keep the record.
   */
  async revoke(orgId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('API key not found');

    return this.prisma.apiKey.update({
      where: { id },
      data: { active: false },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        active: true,
      },
    });
  }

  /**
   * Hard delete: permanently remove the key.
   */
  async delete(orgId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('API key not found');

    await this.prisma.apiKey.delete({ where: { id } });
  }
}
