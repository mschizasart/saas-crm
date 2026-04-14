import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { ImapPollProcessor } from './imap-poll.processor';
import { ImapScheduler } from './imap-scheduler.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'imap-poll' })],
  controllers: [TicketsController],
  providers: [TicketsService, ImapPollProcessor, ImapScheduler],
  exports: [TicketsService],
})
export class TicketsModule {}
