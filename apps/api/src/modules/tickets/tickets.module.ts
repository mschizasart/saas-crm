import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { ImapPollProcessor } from './imap-poll.processor';
import { ImapScheduler } from './imap-scheduler.service';
import { TicketSpamFiltersModule } from '../ticket-spam-filters/ticket-spam-filters.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'imap-poll' }),
    TicketSpamFiltersModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, ImapPollProcessor, ImapScheduler],
  exports: [TicketsService],
})
export class TicketsModule {}
