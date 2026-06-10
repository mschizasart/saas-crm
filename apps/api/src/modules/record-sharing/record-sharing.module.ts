import { Module } from '@nestjs/common';
import { RecordSharingController } from './record-sharing.controller';
import { RecordSharingService } from './record-sharing.service';

/**
 * Record sharing (Wave G1).
 *
 * Hierarchical record visibility on top of the static RBAC layer —
 * see the service file for the correctness rails. PrismaService is
 * supplied by the global DatabaseModule, same as the other feature
 * modules.
 *
 * RecordSharingService is exported so feature modules (leads,
 * opportunities, ...) can inject it and call `applyVisibilityScope`
 * inside their list endpoints.
 */
@Module({
  controllers: [RecordSharingController],
  providers: [RecordSharingService],
  exports: [RecordSharingService],
})
export class RecordSharingModule {}
