import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { decrypt, encrypt, isEncrypted } from '../../common/crypto/encrypt';
import { AiProvider } from './providers/ai-provider.types';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * The AI resolution brain.
 *
 * Mirrors EmailSettingsService's encrypt-on-write / redact-on-read /
 * resolveConfig / sendTest pattern, but for AI providers. Every AI consumer
 * (ai-improve, inbox-ai, lead-scoring) goes through `resolveProvider(orgId)`
 * instead of calling Anthropic directly, so a tenant can bring their own key
 * and the platform stops subsidising their token spend.
 */

export type AiProviderKind = 'ANTHROPIC' | 'OPENAI' | 'PLATFORM_DEFAULT';

export interface UpsertAiSettingsDto {
  provider?: AiProviderKind;
  /** Plaintext — encrypted before storage. Omit = unchanged, null = clear, string = set. */
  apiKey?: string | null;
  model?: string | null;
  enabled?: boolean;
  monthlyTokenCap?: number | null;
}

/** Shape returned to clients — never includes the decrypted key. */
export interface AiSettingsResponse {
  provider: AiProviderKind;
  apiKeySet: boolean;
  model: string | null;
  enabled: boolean;
  monthlyTokenCap: number | null;
  tokensUsedThisMonth: number;
  usageResetAt: string | null;
  lastTestedAt: string | null;
  lastTestError: string | null;
  updatedAt: string | null;
}

export interface ResolvedAiProvider {
  provider: AiProvider;
  model: string;
  source: 'org' | 'platform-env';
}

/** Test-connection payload — friendly object instead of throwing. */
export interface AiTestResult {
  ok: boolean;
  error?: string;
  model?: string;
}

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  private toResponse(row: any): AiSettingsResponse {
    return {
      provider: (row?.provider ?? 'PLATFORM_DEFAULT') as AiProviderKind,
      apiKeySet: !!row?.apiKey,
      model: row?.model ?? null,
      enabled: row?.enabled ?? true,
      monthlyTokenCap: row?.monthlyTokenCap ?? null,
      tokensUsedThisMonth: row?.tokensUsedThisMonth ?? 0,
      usageResetAt: row?.usageResetAt
        ? new Date(row.usageResetAt).toISOString()
        : null,
      lastTestedAt: row?.lastTestedAt
        ? new Date(row.lastTestedAt).toISOString()
        : null,
      lastTestError: row?.lastTestError ?? null,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  // ─── Read ────────────────────────────────────────────────────────────

  async getForOrg(orgId: string): Promise<AiSettingsResponse> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.aiSettings.findUnique({ where: { organizationId: orgId } }),
    );
    return this.toResponse(row);
  }

  // ─── Write ───────────────────────────────────────────────────────────

  async upsert(
    orgId: string,
    dto: UpsertAiSettingsDto,
  ): Promise<AiSettingsResponse> {
    const provider: AiProviderKind = dto.provider ?? 'PLATFORM_DEFAULT';

    // Existing row — needed to validate "key already on file" and to know
    // whether the incoming (omitted) apiKey leaves a usable key in place.
    const existing = await this.prisma.withOrganization(orgId, (tx) =>
      tx.aiSettings.findUnique({ where: { organizationId: orgId } }),
    );

    // Build the encrypted apiKey update only when the caller supplied a value.
    // `null` explicitly clears; `undefined` means "no change".
    let keyUpdate: { apiKey?: string | null } = {};
    let willHaveKey = !!existing?.apiKey;
    if (dto.apiKey === null) {
      keyUpdate = { apiKey: null };
      willHaveKey = false;
    } else if (typeof dto.apiKey === 'string' && dto.apiKey.trim().length > 0) {
      keyUpdate = { apiKey: encrypt(dto.apiKey.trim(), this.encKey()) };
      willHaveKey = true;
    }

    // Validation for tenant-key providers.
    if (provider === 'ANTHROPIC' || provider === 'OPENAI') {
      if (!willHaveKey) {
        throw new BadRequestException(
          `An API key is required when the provider is ${provider}`,
        );
      }
      if (
        dto.model !== undefined &&
        (dto.model === null || dto.model.trim().length === 0)
      ) {
        throw new BadRequestException(
          `A model is required when the provider is ${provider}`,
        );
      }
      // If model wasn't supplied at all and there's no model on the row,
      // fall back to the provider's sensible default rather than rejecting.
    }

    // Resolve the model to persist: explicit dto value wins, else keep
    // existing, else default-for-provider (only for non-default providers).
    let model: string | null;
    if (dto.model !== undefined) {
      model = dto.model && dto.model.trim().length > 0 ? dto.model.trim() : null;
    } else {
      model = existing?.model ?? null;
    }
    if (!model && provider === 'ANTHROPIC') {
      model = AnthropicProvider.DEFAULT_MODEL;
    } else if (!model && provider === 'OPENAI') {
      model = OpenAiProvider.DEFAULT_MODEL;
    } else if (provider === 'PLATFORM_DEFAULT') {
      // Platform default ignores the org model — keep it null for clarity.
      model = null;
    }

    const data: Record<string, any> = {
      provider,
      model,
      enabled: dto.enabled ?? existing?.enabled ?? true,
      ...keyUpdate,
    };
    if (dto.monthlyTokenCap !== undefined) {
      data.monthlyTokenCap =
        dto.monthlyTokenCap === null || dto.monthlyTokenCap <= 0
          ? null
          : Math.floor(dto.monthlyTokenCap);
    }

    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.aiSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, ...data },
        update: data,
      }),
    );
    return this.toResponse(row);
  }

  // ─── Resolution ──────────────────────────────────────────────────────

  /**
   * Resolve the effective AI provider for an org. Throws clean, user-facing
   * errors for the disabled / over-cap / unconfigured cases — callers either
   * surface them or (lead-scoring) fall back to a heuristic.
   */
  async resolveProvider(orgId: string): Promise<ResolvedAiProvider> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.aiSettings.findUnique({ where: { organizationId: orgId } }),
    );

    // Explicit kill-switch for the whole tenant.
    if (row && row.enabled === false) {
      throw new ServiceUnavailableException(
        'AI features are disabled for this organization',
      );
    }

    // Soft monthly cap — checked before the call, not mid-stream.
    if (
      row &&
      row.monthlyTokenCap != null &&
      row.tokensUsedThisMonth >= row.monthlyTokenCap &&
      !this.usageWindowExpired(row.usageResetAt)
    ) {
      throw new ServiceUnavailableException(
        'Monthly AI token limit reached for this organization',
      );
    }

    // ─── Tenant-supplied Anthropic key ──────────────────────────────
    if (row && row.provider === 'ANTHROPIC' && row.apiKey) {
      const key = this.safeDecrypt(row.apiKey, orgId);
      if (key) {
        return {
          provider: new AnthropicProvider(key),
          model: row.model || AnthropicProvider.DEFAULT_MODEL,
          source: 'org',
        };
      }
      // Decrypt failed — fall through to platform default rather than 500.
      this.logger.warn(
        `Org ${orgId} has an undecryptable Anthropic key — falling back to platform default`,
      );
    }

    // ─── Tenant-supplied OpenAI key ─────────────────────────────────
    if (row && row.provider === 'OPENAI' && row.apiKey) {
      const key = this.safeDecrypt(row.apiKey, orgId);
      if (key) {
        return {
          provider: new OpenAiProvider(key),
          model: row.model || OpenAiProvider.DEFAULT_MODEL,
          source: 'org',
        };
      }
      this.logger.warn(
        `Org ${orgId} has an undecryptable OpenAI key — falling back to platform default`,
      );
    }

    // ─── Platform default (no row / PLATFORM_DEFAULT / fall-through) ─
    const envKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (envKey) {
      return {
        provider: new AnthropicProvider(envKey),
        model: AnthropicProvider.DEFAULT_MODEL,
        source: 'platform-env',
      };
    }

    // Same graceful 503 the code throws today when nothing is configured.
    throw new ServiceUnavailableException(
      'AI features are not configured by your administrator',
    );
  }

  // ─── Usage accounting ────────────────────────────────────────────────

  /** True when the usage window is null or older than ~1 month. */
  private usageWindowExpired(resetAt: Date | null | undefined): boolean {
    if (!resetAt) return true;
    return Date.now() - new Date(resetAt).getTime() >= ONE_MONTH_MS;
  }

  /**
   * Increment `tokensUsedThisMonth`. Rolls the window when it has expired.
   * Fire-and-forget: callers must NOT await this on the AI response path —
   * a usage-write failure should never fail a user's AI request.
   */
  async recordUsage(
    orgId: string,
    inputTokens?: number,
    outputTokens?: number,
  ): Promise<void> {
    const total = (inputTokens ?? 0) + (outputTokens ?? 0);
    if (total <= 0) return;
    try {
      await this.prisma.withOrganization(orgId, async (tx) => {
        const row = await tx.aiSettings.findUnique({
          where: { organizationId: orgId },
        });
        // No row means PLATFORM_DEFAULT with no settings persisted — nothing
        // to meter against; the platform eats this one.
        if (!row) return;

        if (this.usageWindowExpired(row.usageResetAt)) {
          await tx.aiSettings.update({
            where: { organizationId: orgId },
            data: { tokensUsedThisMonth: total, usageResetAt: new Date() },
          });
        } else {
          await tx.aiSettings.update({
            where: { organizationId: orgId },
            data: { tokensUsedThisMonth: { increment: total } },
          });
        }
      });
    } catch (err) {
      // Never throw — usage metering is best-effort.
      this.logger.warn(
        `Failed to record AI usage for org ${orgId}: ${(err as Error).message ?? err}`,
      );
    }
  }

  // ─── Test connection ─────────────────────────────────────────────────

  /**
   * Run a tiny 1-token completion against the resolved (or override) config.
   * Returns a friendly ok/error object rather than throwing so the UI can
   * show the upstream error verbatim. Persists lastTestedAt / lastTestError.
   */
  async testConnection(
    orgId: string,
    override?: { provider?: AiProviderKind; apiKey?: string; model?: string },
  ): Promise<AiTestResult> {
    let provider: AiProvider;
    let model: string;

    try {
      if (
        override &&
        (override.provider === 'ANTHROPIC' || override.provider === 'OPENAI')
      ) {
        // Test an UNSAVED config. If apiKey is blank, fall back to the saved
        // (encrypted) key for that provider so "test" works without retyping.
        let key = (override.apiKey ?? '').trim();
        if (!key) {
          const row = await this.prisma.withOrganization(orgId, (tx) =>
            tx.aiSettings.findUnique({ where: { organizationId: orgId } }),
          );
          if (row?.provider === override.provider && row.apiKey) {
            key = this.safeDecrypt(row.apiKey, orgId) ?? '';
          }
        }
        if (!key) {
          return { ok: false, error: 'No API key supplied to test' };
        }
        if (override.provider === 'ANTHROPIC') {
          provider = new AnthropicProvider(key);
          model = override.model?.trim() || AnthropicProvider.DEFAULT_MODEL;
        } else {
          provider = new OpenAiProvider(key);
          model = override.model?.trim() || OpenAiProvider.DEFAULT_MODEL;
        }
      } else {
        const resolved = await this.resolveProvider(orgId);
        provider = resolved.provider;
        model = resolved.model;
      }
    } catch (err) {
      const error = (err as Error).message || 'AI not configured';
      await this.persistTestResult(orgId, error);
      return { ok: false, error };
    }

    try {
      await provider.complete({
        system: 'You are a connectivity probe. Reply with the single word OK.',
        userMessage: 'ping',
        maxTokens: 1,
        model,
      });
      await this.persistTestResult(orgId, null);
      return { ok: true, model };
    } catch (err) {
      const error = (err as Error).message || 'AI test failed';
      await this.persistTestResult(orgId, error);
      return { ok: false, error, model };
    }
  }

  /** Best-effort write of the last test outcome — only if a row exists. */
  private async persistTestResult(
    orgId: string,
    error: string | null,
  ): Promise<void> {
    try {
      await this.prisma.withOrganization(orgId, async (tx) => {
        const row = await tx.aiSettings.findUnique({
          where: { organizationId: orgId },
        });
        if (!row) return;
        await tx.aiSettings.update({
          where: { organizationId: orgId },
          data: {
            lastTestedAt: new Date(),
            lastTestError: error ? error.slice(0, 500) : null,
          },
        });
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist AI test result for org ${orgId}: ${(err as Error).message ?? err}`,
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private safeDecrypt(value: string, orgId: string): string | null {
    try {
      return isEncrypted(value) ? decrypt(value, this.encKey()) : value;
    } catch (err) {
      this.logger.error(
        `Failed to decrypt AI key for org ${orgId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
