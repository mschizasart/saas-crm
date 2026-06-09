import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { auditExtension } from '../modules/audit/audit-extension';

/**
 * Tenant-aware Prisma service.
 *
 * Usage — wrap any query that needs RLS enforcement:
 *   await this.prisma.withOrganization(orgId, async (tx) => {
 *     return tx.invoice.findMany();
 *   });
 *
 * The SET LOCAL ensures the RLS session variable is scoped to the
 * transaction and automatically reset when the transaction ends.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });

    // ── Wave E2: attach the audit-trail extension ─────────────────
    // `$extends` returns a NEW client (it does not mutate `this`), so we
    // copy the extended client's prototype methods back onto the service
    // instance. This preserves the `PrismaService` identity (DI still
    // works) while routing every `prisma.<model>.<op>` call through the
    // audit extension's `query` hooks. `withOrganization` and
    // `withoutTenant` keep working because they call methods that the
    // extended client also exposes (`$transaction`, `$executeRaw`).
    Object.assign(this, this.$extends(auditExtension));
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Execute a callback with the RLS organization context set.
   * All queries inside the callback are automatically scoped to the tenant.
   *
   * ── Audit-extension caveat (Wave E2.2, known limitation) ─────────
   * The audit extension's query hooks fire on `this.prisma.<model>.<op>`
   * but NOT on `tx.<model>.<op>` inside this `$transaction` block.
   * Prisma 6 deny-lists `$extends` on the transaction client
   * (see runtime/library.d.ts: `denylist = [..., "$extends"]`), so we
   * cannot re-extend `tx` to forward writes through the hooks.
   *
   * Services that mutate audited entities must either
   *   (a) do the mutation OUTSIDE `withOrganization` / `$transaction`, or
   *   (b) explicitly write an `AuditLog` row inside the transaction.
   *
   * Tracked as Wave E2.2.
   */
  async withOrganization<T>(
    organizationId: string,
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // set_config(name, value, is_local) — is_local=true scopes to current txn.
      // Equivalent to SET LOCAL, but accepts parameters (SET LOCAL does not).
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Bypass RLS — use ONLY for super-admin / platform-level operations.
   * Never call from tenant-scoped request handlers.
   */
  async withoutTenant<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
