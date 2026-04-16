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

  // ─── Taxes ─────────────────────────────────────────────────

  async getTaxes(orgId: string) {
    return this.prisma.tax.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    });
  }

  async createTax(orgId: string, name: string, rate: number) {
    return this.prisma.tax.create({
      data: { organizationId: orgId, name, rate },
    });
  }

  async updateTax(orgId: string, id: string, data: { name?: string; rate?: number }) {
    const existing = await this.prisma.tax.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException('Tax not found');
    return this.prisma.tax.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.rate !== undefined && { rate: data.rate }),
      },
    });
  }

  async deleteTax(orgId: string, id: string) {
    const existing = await this.prisma.tax.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException('Tax not found');
    await this.prisma.tax.delete({ where: { id } });
  }

  // ─── Currencies ───────────────────────────────────────────

  async getCurrencies(orgId: string) {
    return this.prisma.currency.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    });
  }

  async createCurrency(
    orgId: string,
    data: { name: string; symbol: string; symbolPlacement?: string; decimalSeparator?: string; thousandSeparator?: string; decimalPlaces?: number; isDefault?: boolean; exchangeRate?: number },
  ) {
    return this.prisma.currency.create({
      data: {
        organizationId: orgId,
        name: data.name,
        symbol: data.symbol,
        symbolPlacement: data.symbolPlacement ?? 'before',
        decimalSeparator: data.decimalSeparator ?? '.',
        thousandSeparator: data.thousandSeparator ?? ',',
        decimalPlaces: data.decimalPlaces ?? 2,
        isDefault: data.isDefault ?? false,
        exchangeRate: data.exchangeRate ?? 1,
      },
    });
  }

  async updateCurrency(
    orgId: string,
    id: string,
    data: { name?: string; symbol?: string; symbolPlacement?: string; decimalSeparator?: string; thousandSeparator?: string; decimalPlaces?: number; isDefault?: boolean; exchangeRate?: number },
  ) {
    const existing = await this.prisma.currency.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException('Currency not found');
    return this.prisma.currency.update({ where: { id }, data });
  }

  async deleteCurrency(orgId: string, id: string) {
    const existing = await this.prisma.currency.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException('Currency not found');
    await this.prisma.currency.delete({ where: { id } });
  }

  // ─── Usage Stats ──────────────────────────────────────────

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
