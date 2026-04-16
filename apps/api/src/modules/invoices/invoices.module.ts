import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { RecurringInvoicesProcessor } from './recurring-invoices.processor';
import { RecurringScheduler } from './recurring-scheduler.service';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'recurring-invoices' }),
    forwardRef(() => CreditNotesModule),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, RecurringInvoicesProcessor, RecurringScheduler],
  exports: [InvoicesService],
})
export class InvoicesModule {}
