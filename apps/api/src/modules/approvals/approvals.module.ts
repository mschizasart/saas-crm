import { Module } from '@nestjs/common';
import { ApprovalProcessesController } from './approval-processes.controller';
import { ApprovalRequestsController } from './approval-requests.controller';
import { ApprovalProcessesService } from './approval-processes.service';
import { ApprovalRequestsService } from './approval-requests.service';

/**
 * Approval workflows (Wave E1).
 *
 * - ApprovalProcessesService: CRUD for process + steps definitions.
 *   Step writes always run in the same $transaction as the process
 *   row; deletes are refused while any requests reference the process.
 * - ApprovalRequestsService: live requests + decisions. The `decide()`
 *   method runs eligibility check + decision insert + status update +
 *   step advance inside ONE prisma.$transaction so the chain can
 *   never advance without a matching decision row.
 *
 * PrismaService is supplied by the global DatabaseModule (no explicit
 * import needed — same pattern as DunningModule / OpportunitiesModule).
 */
@Module({
  controllers: [ApprovalProcessesController, ApprovalRequestsController],
  providers: [ApprovalProcessesService, ApprovalRequestsService],
  exports: [ApprovalProcessesService, ApprovalRequestsService],
})
export class ApprovalsModule {}
