import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

type SettingsUpdate =
  | { key: string; value: any }
  | Record<string, any>;

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async findBySlug(slug: string) {
    return this.prisma.organization.findUnique({ where: { slug } });
  }

  /**
   * Return the current organization with settings JSON.
   */
  async getCurrent(orgId: string) {
    return this.findById(orgId);
  }

  /**
   * Update organization profile fields (non-settings columns).
   */
  async updateProfile(
    orgId: string,
    data: Partial<{
      name: string;
      slug: string;
      logo: string;
      address: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      phone: string;
      website: string;
      vatNumber: string;
    }>,
  ) {
    // Slug uniqueness guard
    if (data.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: data.slug, NOT: { id: orgId } },
      });
      if (existing) throw new ConflictException('Slug already in use');
    }
    return this.prisma.organization.update({
      where: { id: orgId },
      data,
    });
  }

  /**
   * Merge into settings JSON. Accepts either `{key, value}` for a single
   * update or a plain object for bulk merge.
   */
  async updateSettings(orgId: string, input: SettingsUpdate) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException();

    const current = (org.settings as Record<string, any>) ?? {};

    let merged: Record<string, any>;
    if (
      input &&
      typeof input === 'object' &&
      'key' in input &&
      'value' in input &&
      typeof (input as any).key === 'string'
    ) {
      const { key, value } = input as { key: string; value: any };
      merged = { ...current, [key]: value };
    } else {
      merged = { ...current, ...(input as Record<string, any>) };
    }

    return this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: merged },
    });
  }

  async setCustomDomain(orgId: string, domain: string) {
    const existing = await this.prisma.organization.findFirst({
      where: { customDomain: domain, NOT: { id: orgId } },
    });
    if (existing) throw new ConflictException('Domain already in use');

    return this.prisma.organization.update({
      where: { id: orgId },
      data: { customDomain: domain },
    });
  }

  async getUsageStats(orgId: string) {
    const [staffCount, clientCount, projectCount] = await Promise.all([
      this.prisma.user.count({
        where: { organizationId: orgId, type: 'staff', active: true },
      }),
      this.prisma.client.count({
        where: { organizationId: orgId, active: true },
      }),
      this.prisma.project.count({ where: { organizationId: orgId } }),
    ]);

    // Storage bytes: no file-size field tracked in schema — return 0.
    // TODO: sum file sizes once a File/Upload model with a size field exists.
    const storageBytes = 0;

    return { staffCount, clientCount, projectCount, storageBytes };
  }
}
