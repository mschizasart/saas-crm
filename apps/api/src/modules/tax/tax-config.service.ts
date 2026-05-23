import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { decrypt, encrypt, isEncrypted } from '../../common/crypto/encrypt';
import {
  TaxAddress,
  TaxCalcInput,
  TaxCalcResult,
  TaxProvider,
} from './providers/tax-provider.types';
import { TaxJarProvider } from './providers/taxjar.provider';
import { AvalaraProvider } from './providers/avalara.provider';

/**
 * The tax-automation brain. Mirrors AiConfigService's
 * encrypt-on-write / redact-on-read / resolveProvider / testConnection
 * pattern, but for sales-tax / VAT providers.
 *
 * Auto tax is an OPT-IN layer on top of the existing manual tax rates
 * (taxes table + tax1/tax2 on line items). Precedence when auto tax is
 * active (enabled): the provider-computed tax REPLACES the manual tax1/tax2
 * for the persisted `totalTax`. A provider error NEVER blocks invoice save —
 * it degrades to whatever manual/zero tax the totals already carry.
 */

export type TaxProviderKind = 'NONE' | 'TAXJAR' | 'AVALARA';

export interface TaxOriginAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

export interface UpsertTaxSettingsDto {
  provider?: TaxProviderKind;
  /** Plaintext — encrypted before storage. Omit = unchanged, null = clear, string = set. */
  apiKey?: string | null;
  avalaraAccountId?: string | null;
  avalaraCompanyCode?: string | null;
  originAddress?: TaxOriginAddress | null;
  enabled?: boolean;
  autoApply?: boolean;
}

/** Shape returned to clients — never includes the decrypted key. */
export interface TaxSettingsResponse {
  provider: TaxProviderKind;
  apiKeySet: boolean;
  avalaraAccountId: string | null;
  avalaraCompanyCode: string | null;
  originAddress: TaxOriginAddress | null;
  enabled: boolean;
  autoApply: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  updatedAt: string | null;
}

export interface TaxTestResult {
  ok: boolean;
  error?: string;
  /** Tax computed on the sample order, when the test succeeds. */
  sampleTax?: number;
  rate?: number;
}

export interface CalculateForEntityResult {
  provider: TaxProviderKind;
  taxableAmount: number;
  taxAmount: number;
  rate: number;
  breakdown: TaxCalcResult['breakdown'];
  /** True when autoApply persisted the tax onto the entity's totals. */
  applied: boolean;
}

@Injectable()
export class TaxConfigService {
  private readonly logger = new Logger(TaxConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  private toResponse(row: any): TaxSettingsResponse {
    return {
      provider: (row?.provider ?? 'NONE') as TaxProviderKind,
      apiKeySet: !!row?.apiKey,
      avalaraAccountId: row?.avalaraAccountId ?? null,
      avalaraCompanyCode: row?.avalaraCompanyCode ?? null,
      originAddress: (row?.originAddress as TaxOriginAddress | null) ?? null,
      enabled: row?.enabled ?? false,
      autoApply: row?.autoApply ?? false,
      lastTestedAt: row?.lastTestedAt
        ? new Date(row.lastTestedAt).toISOString()
        : null,
      lastTestError: row?.lastTestError ?? null,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  // ─── Read ────────────────────────────────────────────────────────────

  async getForOrg(orgId: string): Promise<TaxSettingsResponse> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      (tx as any).taxSettings.findUnique({ where: { organizationId: orgId } }),
    );
    return this.toResponse(row);
  }

  // ─── Write ───────────────────────────────────────────────────────────

  async upsert(
    orgId: string,
    dto: UpsertTaxSettingsDto,
  ): Promise<TaxSettingsResponse> {
    const provider: TaxProviderKind = dto.provider ?? 'NONE';

    const existing = await this.prisma.withOrganization(orgId, (tx) =>
      (tx as any).taxSettings.findUnique({ where: { organizationId: orgId } }),
    );

    // apiKey: undefined = no change, null = clear, string = set (encrypted).
    let keyUpdate: { apiKey?: string | null } = {};
    let willHaveKey = !!existing?.apiKey;
    if (dto.apiKey === null) {
      keyUpdate = { apiKey: null };
      willHaveKey = false;
    } else if (typeof dto.apiKey === 'string' && dto.apiKey.trim().length > 0) {
      keyUpdate = { apiKey: encrypt(dto.apiKey.trim(), this.encKey()) };
      willHaveKey = true;
    }

    const avalaraAccountId =
      dto.avalaraAccountId !== undefined
        ? dto.avalaraAccountId?.trim() || null
        : (existing?.avalaraAccountId ?? null);
    const avalaraCompanyCode =
      dto.avalaraCompanyCode !== undefined
        ? dto.avalaraCompanyCode?.trim() || null
        : (existing?.avalaraCompanyCode ?? null);

    // Validation for active providers. Only enforce when the tenant is
    // actually turning the integration on — a NONE/disabled row can be saved
    // with partial config so the user can fill it in incrementally.
    const willBeEnabled = dto.enabled ?? existing?.enabled ?? false;
    if (provider !== 'NONE' && willBeEnabled) {
      if (!willHaveKey) {
        throw new BadRequestException(
          `An API key is required when the tax provider is ${provider} and enabled`,
        );
      }
      if (provider === 'AVALARA' && (!avalaraAccountId || !avalaraCompanyCode)) {
        throw new BadRequestException(
          'Avalara requires an account id and a company code',
        );
      }
    }

    const data: Record<string, any> = {
      provider,
      avalaraAccountId,
      avalaraCompanyCode,
      enabled: willBeEnabled,
      autoApply: dto.autoApply ?? existing?.autoApply ?? false,
      ...keyUpdate,
    };
    if (dto.originAddress !== undefined) {
      data.originAddress = dto.originAddress
        ? sanitizeAddress(dto.originAddress)
        : null;
    }

    const row = await this.prisma.withOrganization(orgId, (tx) =>
      (tx as any).taxSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, ...data },
        update: data,
      }),
    );
    return this.toResponse(row);
  }

  // ─── Resolution ──────────────────────────────────────────────────────

  /**
   * Resolve the effective tax provider for an org, or null when tax
   * automation is off (NONE / disabled / unconfigured / undecryptable key).
   * Returning null — rather than throwing — keeps the invoice path simple:
   * "no provider → leave manual tax alone".
   */
  async resolveProvider(
    orgId: string,
    overrideRow?: any,
  ): Promise<{ provider: TaxProvider; kind: TaxProviderKind } | null> {
    const row =
      overrideRow ??
      (await this.prisma.withOrganization(orgId, (tx) =>
        (tx as any).taxSettings.findUnique({
          where: { organizationId: orgId },
        }),
      ));

    if (!row || row.enabled === false || row.provider === 'NONE') return null;

    const key = row.apiKey ? this.safeDecrypt(row.apiKey, orgId) : null;
    if (!key) {
      this.logger.warn(
        `Org ${orgId} tax provider ${row.provider} has no usable API key — auto tax disabled for this org`,
      );
      return null;
    }

    if (row.provider === 'TAXJAR') {
      return { provider: new TaxJarProvider(key), kind: 'TAXJAR' };
    }
    if (row.provider === 'AVALARA') {
      if (!row.avalaraAccountId || !row.avalaraCompanyCode) {
        this.logger.warn(
          `Org ${orgId} Avalara config incomplete (account/company) — auto tax disabled`,
        );
        return null;
      }
      const base = this.resolveAvalaraBaseUrl(
        this.config.get<string>('AVALARA_BASE_URL'),
      );
      return {
        provider: new AvalaraProvider(
          row.avalaraAccountId,
          key,
          row.avalaraCompanyCode,
          base,
        ),
        kind: 'AVALARA',
      };
    }
    return null;
  }

  // ─── Calculate for an invoice ─────────────────────────────────────────

  /**
   * Load the invoice + client address + org origin, call the provider,
   * persist a TaxCalculation audit row, and (when `applyToEntity`) write the
   * computed tax onto the invoice totals.
   *
   * Used by the "Calculate tax" button (applyToEntity from autoApply) and by
   * the invoice service on save when autoApply is on.
   *
   * Throws BadRequestException only for genuine "you can't do this" cases
   * (no provider configured, entity missing). Provider/transport errors are
   * re-thrown as-is so the HTTP caller surfaces them; the invoice-save path
   * catches them and degrades.
   */
  async calculateForInvoice(
    orgId: string,
    invoiceId: string,
    opts: { entityType?: 'invoice' | 'estimate'; applyToEntity?: boolean } = {},
  ): Promise<CalculateForEntityResult> {
    const entityType = opts.entityType ?? 'invoice';

    const resolved = await this.resolveProvider(orgId);
    if (!resolved) {
      throw new BadRequestException(
        'Automatic tax is not enabled for this organization',
      );
    }

    const { entity, items, toAddress } = await this.loadEntity(
      orgId,
      entityType,
      invoiceId,
    );

    const settings = await this.prisma.withOrganization(orgId, (tx) =>
      (tx as any).taxSettings.findUnique({ where: { organizationId: orgId } }),
    );
    const org = await this.prisma.withOrganization(orgId, (tx) =>
      tx.organization.findUnique({
        where: { id: orgId },
        select: {
          address: true,
          city: true,
          state: true,
          zipCode: true,
          country: true,
        },
      }),
    );

    const fromAddress = resolveOriginAddress(settings?.originAddress, org);

    const lineItems = items.map((it) => ({
      amount: Number(it.qty ?? 0) * Number(it.rate ?? 0),
      quantity: Number(it.qty ?? 1) || 1,
      ref: it.id,
    }));
    const taxableAmount = round2(
      lineItems.reduce((s, li) => s + li.amount, 0),
    );

    const input: TaxCalcInput = { fromAddress, toAddress, lineItems };
    const result = await resolved.provider.calculate(input);

    // Persist audit row (best-effort — never let it block the result).
    try {
      await this.prisma.withOrganization(orgId, (tx) =>
        (tx as any).taxCalculation.create({
          data: {
            organizationId: orgId,
            entityType,
            entityId: invoiceId,
            provider: resolved.kind,
            taxableAmount,
            taxAmount: result.taxAmount,
            rate: result.rate,
            breakdown: result.breakdown as any,
          },
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to persist TaxCalculation for ${entityType} ${invoiceId}: ${(err as Error).message ?? err}`,
      );
    }

    let applied = false;
    if (opts.applyToEntity) {
      applied = await this.applyTaxToEntity(
        orgId,
        entityType,
        invoiceId,
        entity,
        taxableAmount,
        result.taxAmount,
      );
    }

    return {
      provider: resolved.kind,
      taxableAmount,
      taxAmount: result.taxAmount,
      rate: result.rate,
      breakdown: result.breakdown,
      applied,
    };
  }

  /**
   * Recompute the entity total with the provider tax REPLACING the manual
   * per-line tax. Discount handling matches invoices.service.calculateTotals:
   * total = subtotal + tax - discount (fixed) or subtotal + tax - subtotal*pct.
   *
   * ATOMICITY / CONSISTENCY: this is intentionally a SECOND write, separate
   * from the main invoice transaction — keeping the (potentially slow) provider
   * network call out of an open DB transaction avoids long-tx risk. The
   * trade-off is that a crash can happen between the main write and this one,
   * so this write MUST leave the row internally consistent on its own. We
   * therefore write all three coupled money columns together — `subTotal`
   * (= the provider's taxableAmount), `totalTax`, and `total` — in a SINGLE
   * `update`. Every committed state is then self-consistent: either the manual
   * state from the main write (subTotal / manual-or-zero tax / total) or this
   * auto state (subTotal / provider tax / total), never a mix where `total`
   * reflects tax while `subTotal` is stale.
   */
  private async applyTaxToEntity(
    orgId: string,
    entityType: 'invoice' | 'estimate',
    entityId: string,
    entity: any,
    subtotal: number,
    taxAmount: number,
  ): Promise<boolean> {
    const discountRaw = Number(entity.discount ?? 0) || 0;
    const discountAmount =
      (entity.discountType ?? 'fixed') === 'percent'
        ? round2((subtotal * discountRaw) / 100)
        : discountRaw;
    const total = round2(Math.max(0, subtotal + taxAmount - discountAmount));

    try {
      await this.prisma.withOrganization(orgId, async (tx) => {
        if (entityType === 'invoice') {
          await tx.invoice.update({
            where: { id: entityId },
            data: { subTotal: subtotal, totalTax: taxAmount, total },
          });
        } else {
          await tx.estimate.update({
            where: { id: entityId },
            data: { subTotal: subtotal, totalTax: taxAmount, total },
          });
        }
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to apply auto tax to ${entityType} ${entityId}: ${(err as Error).message ?? err}`,
      );
      return false;
    }
  }

  private async loadEntity(
    orgId: string,
    entityType: 'invoice' | 'estimate',
    entityId: string,
  ): Promise<{
    entity: any;
    items: Array<{ id: string; qty: any; rate: any }>;
    toAddress: TaxAddress;
  }> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const entity =
        entityType === 'invoice'
          ? await tx.invoice.findFirst({
              where: { id: entityId, organizationId: orgId },
              include: { items: true, client: true },
            })
          : await tx.estimate.findFirst({
              where: { id: entityId, organizationId: orgId },
              include: { items: true, client: true },
            });
      if (!entity) {
        throw new NotFoundException(`${entityType} not found`);
      }
      const client: any = (entity as any).client;
      const toAddress = clientToAddress(client);
      return {
        entity,
        items: ((entity as any).items ?? []).map((it: any) => ({
          id: it.id,
          qty: it.qty,
          rate: it.rate,
        })),
        toAddress,
      };
    });
  }

  // ─── Test connection ─────────────────────────────────────────────────

  /**
   * Run a small sample calculation against the saved (or override) config to
   * verify the credentials. Returns a friendly ok/error object rather than
   * throwing, and persists lastTestedAt / lastTestError (best-effort).
   */
  async testConnection(
    orgId: string,
    override?: UpsertTaxSettingsDto,
  ): Promise<TaxTestResult> {
    let resolved: { provider: TaxProvider; kind: TaxProviderKind } | null;

    try {
      if (override && override.provider && override.provider !== 'NONE') {
        // Test an UNSAVED config. Blank apiKey → fall back to the saved key.
        const saved = await this.prisma.withOrganization(orgId, (tx) =>
          (tx as any).taxSettings.findUnique({
            where: { organizationId: orgId },
          }),
        );
        let key = (override.apiKey ?? '').trim();
        if (!key && saved?.provider === override.provider && saved.apiKey) {
          key = this.safeDecrypt(saved.apiKey, orgId) ?? '';
        }
        if (!key) {
          return { ok: false, error: 'No API key supplied to test' };
        }
        // Build a synthetic row so resolveProvider can construct the provider.
        // `key` is ALWAYS plaintext here (freshly typed by the user, or just
        // safeDecrypt'd from the saved row), so always encrypt it — the
        // isEncrypted() heuristic could misfire on a hex-shaped token and skip
        // encryption, then resolveProvider would feed a raw token to decrypt().
        const overrideRow = {
          provider: override.provider,
          enabled: true,
          apiKey: encrypt(key, this.encKey()),
          avalaraAccountId:
            override.avalaraAccountId ?? saved?.avalaraAccountId ?? null,
          avalaraCompanyCode:
            override.avalaraCompanyCode ?? saved?.avalaraCompanyCode ?? null,
        };
        resolved = await this.resolveProvider(orgId, overrideRow);
      } else {
        resolved = await this.resolveProvider(orgId);
      }
    } catch (err) {
      const error = (err as Error).message || 'Tax provider not configured';
      await this.persistTestResult(orgId, error);
      return { ok: false, error };
    }

    if (!resolved) {
      const error =
        'Tax automation is not configured (provider NONE, disabled, or missing key)';
      await this.persistTestResult(orgId, error);
      return { ok: false, error };
    }

    // A representative US sample order so providers return a non-trivial tax.
    const sample: TaxCalcInput = {
      fromAddress: { state: 'CA', zip: '90404', country: 'US', city: 'Santa Monica' },
      toAddress: { state: 'NY', zip: '10001', country: 'US', city: 'New York' },
      lineItems: [{ amount: 100, quantity: 1, ref: 'sample' }],
    };

    try {
      const res = await resolved.provider.calculate(sample);
      await this.persistTestResult(orgId, null);
      return { ok: true, sampleTax: res.taxAmount, rate: res.rate };
    } catch (err) {
      const error = (err as Error).message || 'Tax test failed';
      await this.persistTestResult(orgId, error);
      return { ok: false, error };
    }
  }

  private async persistTestResult(
    orgId: string,
    error: string | null,
  ): Promise<void> {
    try {
      await this.prisma.withOrganization(orgId, async (tx) => {
        const row = await (tx as any).taxSettings.findUnique({
          where: { organizationId: orgId },
        });
        if (!row) return;
        await (tx as any).taxSettings.update({
          where: { organizationId: orgId },
          data: {
            lastTestedAt: new Date(),
            lastTestError: error ? error.slice(0, 500) : null,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist tax test result for org ${orgId}: ${(err as Error).message ?? err}`,
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private safeDecrypt(value: string, orgId: string): string | null {
    try {
      return isEncrypted(value) ? decrypt(value, this.encKey()) : value;
    } catch (err) {
      this.logger.error(
        `Failed to decrypt tax key for org ${orgId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * SSRF guard for the AVALARA_BASE_URL env var. Line-item amounts + customer
   * addresses are POSTed to this host, so only known Avalara hosts are allowed.
   * Anything else (or a malformed URL) is ignored with a warning, and we fall
   * back to the provider's production default (returning undefined).
   */
  private resolveAvalaraBaseUrl(raw: string | undefined): string | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;

    const ALLOWED_HOSTS = new Set([
      'rest.avatax.com',
      'sandbox.avatax.com',
    ]);

    let host: string;
    try {
      host = new URL(trimmed).hostname.toLowerCase();
    } catch {
      this.logger.warn(
        `Ignoring malformed AVALARA_BASE_URL (${trimmed}); using the production default`,
      );
      return undefined;
    }

    if (!ALLOWED_HOSTS.has(host)) {
      this.logger.warn(
        `Ignoring AVALARA_BASE_URL with disallowed host "${host}"; using the production default`,
      );
      return undefined;
    }
    return trimmed;
  }
}

// ─── Module-private pure helpers ─────────────────────────────────────────

function sanitizeAddress(a: TaxOriginAddress): TaxOriginAddress {
  return {
    street: a.street?.trim() || null,
    city: a.city?.trim() || null,
    state: a.state?.trim() || null,
    zip: a.zip?.trim() || null,
    country: a.country?.trim() || null,
  };
}

/** Prefer the explicit TaxSettings.originAddress; fall back to the org address. */
function resolveOriginAddress(
  origin: any,
  org: any,
): TaxAddress {
  if (origin && (origin.zip || origin.city || origin.state || origin.country)) {
    return {
      street: origin.street ?? null,
      city: origin.city ?? null,
      state: origin.state ?? null,
      zip: origin.zip ?? null,
      country: origin.country ?? null,
    };
  }
  return {
    street: org?.address ?? null,
    city: org?.city ?? null,
    state: org?.state ?? null,
    zip: org?.zipCode ?? null,
    country: org?.country ?? null,
  };
}

/** Prefer the client's billing address; fall back to shipping then legacy. */
function clientToAddress(client: any): TaxAddress {
  if (!client) return { country: 'US' };
  const hasBilling =
    client.billingZip || client.billingCity || client.billingState;
  if (hasBilling) {
    return {
      street: client.billingStreet ?? null,
      city: client.billingCity ?? null,
      state: client.billingState ?? null,
      zip: client.billingZip ?? null,
      country: client.billingCountry ?? null,
    };
  }
  const hasShipping =
    client.shippingZip || client.shippingCity || client.shippingState;
  if (hasShipping) {
    return {
      street: client.shippingStreet ?? null,
      city: client.shippingCity ?? null,
      state: client.shippingState ?? null,
      zip: client.shippingZip ?? null,
      country: client.shippingCountry ?? null,
    };
  }
  return {
    street: client.address ?? null,
    city: client.city ?? null,
    state: client.state ?? null,
    zip: client.zipCode ?? null,
    country: client.country ?? null,
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
