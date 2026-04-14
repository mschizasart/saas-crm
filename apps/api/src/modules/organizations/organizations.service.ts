import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

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

  async updateSettings(orgId: string, settings: Record<string, any>) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException();

    const merged = { ...(org.settings as object), ...settings };
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: merged },
    });
  }

  async updateProfile(orgId: string, data: Partial<{
    name: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    phone: string;
    website: string;
    vatNumber: string;
    logo: string;
  }>) {
    return this.prisma.organization.update({
      where: { id: orgId },
      data,
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
    const [staffCount, clientCount, activeProjects] = await Promise.all([
      this.prisma.user.count({ where: { organizationId: orgId, type: 'staff', active: true } }),
      this.prisma.client.count({ where: { organizationId: orgId, active: true } }),
      this.prisma.project.count({
        where: { organizationId: orgId, status: { in: ['in_progress', 'not_started'] } },
      }),
    ]);
    return { staffCount, clientCount, activeProjects };
  }
}
