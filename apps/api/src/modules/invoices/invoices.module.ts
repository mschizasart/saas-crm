import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { RecurringInvoicesProcessor } from './recurring-invoices.processor';
import { RecurringScheduler } from './recurring-scheduler.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'recurring-invoices' })],
  controllers: [InvoicesController],
  providers: [InvoicesService, RecurringInvoicesProcessor, RecurringScheduler],
  exports: [InvoicesService],
})
export class InvoicesModule {}
