import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
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

  // ─── White-label branding ─────────────────────────────────
  //
  // The existing `logo` column doubles as the brand logo, so it is
  // included in the branding payload (read + write). All colors are
  // validated against a strict hex regex before persistence to prevent
  // CSS injection on the web side (the values land in `style` / CSS vars).

  static readonly HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

  /** Safe display branding fields read by any authenticated org user. */
  async getBranding(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        customDomain: true,
        brandPrimaryColor: true,
        brandSidebarColor: true,
        brandFaviconUrl: true,
        brandEmailFooter: true,
        whiteLabelEnabled: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /**
   * Upsert branding fields. Colors are validated to be 6-digit hex so the
   * web layer can safely inject them into CSS variables / inline styles.
   * Logo/favicon URLs are stored as-is (uploaded via the storage module).
   */
  async updateBranding(
    orgId: string,
    body: Partial<{
      logo: string | null;
      brandPrimaryColor: string | null;
      brandSidebarColor: string | null;
      brandFaviconUrl: string | null;
      brandEmailFooter: string | null;
      whiteLabelEnabled: boolean;
    }>,
  ) {
    const data: Record<string, any> = {};

    const assignColor = (
      key: 'brandPrimaryColor' | 'brandSidebarColor',
      value: unknown,
    ) => {
      if (value === undefined) return;
      if (value === null || value === '') {
        data[key] = null;
        return;
      }
      if (typeof value !== 'string' || !OrganizationsService.HEX_COLOR.test(value)) {
        throw new BadRequestException(
          `${key} must be a 6-digit hex color like #3B82F6`,
        );
      }
      // Normalise to the canonical lowercase form.
      data[key] = value.toLowerCase();
    };

    assignColor('brandPrimaryColor', body.brandPrimaryColor);
    assignColor('brandSidebarColor', body.brandSidebarColor);

    if (body.logo !== undefined) {
      data.logo = body.logo === '' ? null : body.logo;
    }
    if (body.brandFaviconUrl !== undefined) {
      data.brandFaviconUrl =
        body.brandFaviconUrl === '' ? null : body.brandFaviconUrl;
    }
    if (body.brandEmailFooter !== undefined) {
      // Strip <script> blocks so an admin can't smuggle JS into the footer
      // that later renders inside outgoing email HTML. Other HTML is allowed.
      data.brandEmailFooter =
        body.brandEmailFooter === null || body.brandEmailFooter === ''
          ? null
          : OrganizationsService.stripScripts(body.brandEmailFooter);
    }
    if (body.whiteLabelEnabled !== undefined) {
      data.whiteLabelEnabled = !!body.whiteLabelEnabled;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.organization.update({ where: { id: orgId }, data });
    }
    return this.getBranding(orgId);
  }

  /**
   * Public (unauthenticated) branding by slug — for the portal login and
   * public lead/quote forms. Returns ONLY safe display fields. When
   * white-label is disabled (or the org is missing) returns null so the
   * caller falls back to the platform default theme.
   */
  async getPublicBranding(slug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: {
        name: true,
        slug: true,
        logo: true,
        brandPrimaryColor: true,
        brandSidebarColor: true,
        brandFaviconUrl: true,
        whiteLabelEnabled: true,
      },
    });
    if (!org || !org.whiteLabelEnabled) return null;
    return {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      brandPrimaryColor: org.brandPrimaryColor,
      brandSidebarColor: org.brandSidebarColor,
      brandFaviconUrl: org.brandFaviconUrl,
      whiteLabelEnabled: org.whiteLabelEnabled,
    };
  }

  /** Remove <script>…</script> blocks (and stray opening tags) from HTML. */
  static stripScripts(html: string): string {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<\/?script\b[^>]*>/gi, '');
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

  // ─── Onboarding ───────────────────────────────────────────

  /**
   * Allowed values for `onboardingStep`. Must stay in sync with the web
   * wizard's URL slugs (`apps/web/app/(admin)/onboarding/...`). The
   * special value `'done'` is what we record alongside `completedAt`.
   */
  static readonly ONBOARDING_STEPS = [
    'welcome',
    'org_details',
    'team',
    'first_client',
    'first_lead',
    'email',
    'ai',
    'done',
  ] as const;

  /**
   * Return wizard state + a slim view of the org for pre-filling forms.
   * Always returns 200 — empty state for fresh tenants.
   */
  async getOnboarding(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        phone: true,
        website: true,
        vatNumber: true,
        settings: true,
        // Note: defaultCurrencyId/timezone live in `settings` JSON since we
        // don't have dedicated columns for them on Organization.
        onboardingCompletedAt: true,
        onboardingStep: true,
        onboardingSkipped: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    return {
      completedAt: org.onboardingCompletedAt,
      currentStep: org.onboardingStep,
      skipped: org.onboardingSkipped,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        address: org.address,
        city: org.city,
        state: org.state,
        zipCode: org.zipCode,
        country: org.country,
        phone: org.phone,
        website: org.website,
        vatNumber: org.vatNumber,
        timezone: (org.settings as any)?.timezone ?? null,
        defaultCurrencyId: (org.settings as any)?.defaultCurrencyId ?? null,
      },
    };
  }

  /**
   * Patch onboarding state. Optional fields:
   *   - step:    advance `onboardingStep` (validated against ONBOARDING_STEPS)
   *   - skip:    if true, set `onboardingSkipped=true`
   *   - complete:if true, set `onboardingCompletedAt=now()` and step='done'
   *   - orgUpdates: shallow merge into Organization columns and/or settings
   */
  async updateOnboarding(
    orgId: string,
    body: {
      step?: string;
      skip?: boolean;
      complete?: boolean;
      orgUpdates?: Partial<{
        name: string;
        logo: string;
        address: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
        phone: string;
        website: string;
        vatNumber: string;
        timezone: string;
        defaultCurrencyId: string;
      }>;
    },
  ) {
    const data: Record<string, any> = {};

    if (body.step !== undefined) {
      const allowed = OrganizationsService.ONBOARDING_STEPS as readonly string[];
      if (!allowed.includes(body.step)) {
        throw new BadRequestException(
          `Invalid onboarding step "${body.step}". Allowed: ${allowed.join(', ')}`,
        );
      }
      data.onboardingStep = body.step;
    }

    if (body.skip === true) {
      data.onboardingSkipped = true;
    }

    if (body.complete === true) {
      data.onboardingCompletedAt = new Date();
      data.onboardingStep = 'done';
    }

    // Apply orgUpdates if provided — column fields go on `data`, the two
    // "soft" settings (timezone, defaultCurrencyId) merge into settings JSON.
    if (body.orgUpdates) {
      const u = body.orgUpdates;
      const COLUMN_FIELDS = [
        'name',
        'logo',
        'address',
        'city',
        'state',
        'zipCode',
        'country',
        'phone',
        'website',
        'vatNumber',
      ] as const;
      for (const k of COLUMN_FIELDS) {
        if (u[k] !== undefined) data[k] = u[k];
      }
      if (u.timezone !== undefined || u.defaultCurrencyId !== undefined) {
        const current = await this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { settings: true },
        });
        const settings = ((current?.settings as Record<string, any>) ?? {});
        if (u.timezone !== undefined) settings.timezone = u.timezone;
        if (u.defaultCurrencyId !== undefined)
          settings.defaultCurrencyId = u.defaultCurrencyId;
        data.settings = settings;
      }
    }

    if (Object.keys(data).length === 0) {
      // No-op patch — just return current state.
      return this.getOnboarding(orgId);
    }

    await this.prisma.organization.update({ where: { id: orgId }, data });
    return this.getOnboarding(orgId);
  }

  /**
   * Reset onboarding state so a power user can re-run the tour.
   * Called from `/settings → Re-run onboarding tour`.
   */
  async resetOnboarding(orgId: string) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        onboardingCompletedAt: null,
        onboardingStep: null,
        onboardingSkipped: false,
      },
    });
    return this.getOnboarding(orgId);
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
