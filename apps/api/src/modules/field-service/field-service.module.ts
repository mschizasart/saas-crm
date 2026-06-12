import { Module } from '@nestjs/common';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

/**
 * Field Service — Work Orders + Dispatch (Wave H1 — migration 039).
 *
 * - WorkOrdersService: CRUD + status lifecycle
 *   (draft → scheduled → in_progress → completed | cancelled). Every
 *   transition is written to `work_order_status_history` inside the same
 *   $transaction as the parent update so the audit log can never drift
 *   (same pattern as Wave D opportunities and Wave F2 quotes).
 * - DispatchService: read-side helpers for the dispatcher UI — board
 *   view, single technician calendar, simple availability lookup.
 *
 * PrismaService comes from the global DatabaseModule — no explicit
 * import needed (mirrors CpqModule / OpportunitiesModule).
 */
@Module({
  controllers: [WorkOrdersController, DispatchController],
  providers: [WorkOrdersService, DispatchService],
  exports: [WorkOrdersService, DispatchService],
})
export class FieldServiceModule {}
