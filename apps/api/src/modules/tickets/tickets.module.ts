import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { ImapPollProcessor } from './imap-poll.processor';
import { ImapScheduler } from './imap-scheduler.service';
import { TicketSpamFiltersModule } from '../ticket-spam-filters/ticket-spam-filters.module';
// Wave H3 (E3.1) — public-API key auth on /tickets.
import { PublicApiModule } from '../public-api/public-api.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'imap-poll' }),
    TicketSpamFiltersModule,
    PublicApiModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, ImapPollProcessor, ImapScheduler],
  exports: [TicketsService],
})
export class TicketsModule {}
