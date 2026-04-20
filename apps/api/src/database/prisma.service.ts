import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
