import { Module } from '@nestjs/common';
import { AccountHierarchyController } from './account-hierarchy.controller';
import { AccountHierarchyService } from './account-hierarchy.service';

/**
 * Account hierarchy (Wave F1).
 *
 * Salesforce-style parent/child tree on the Client model — see the
 * service file for the correctness rails. PrismaService is supplied
 * by the global DatabaseModule, same as the other feature modules.
 */
@Module({
  controllers: [AccountHierarchyController],
  providers: [AccountHierarchyService],
  exports: [AccountHierarchyService],
})
export class AccountHierarchyModule {}
