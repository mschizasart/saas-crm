import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

/**
 * Multi-org membership module.
 *
 * Routes here are explicitly cross-tenant. See the matching skip rule
 * in `apps/api/src/common/interceptors/tenant.interceptor.ts` for
 * `/api/v1/memberships`.
 */
@Module({
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
