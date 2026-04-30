import { Module } from '@nestjs/common';
import { TicketSpamFiltersController } from './ticket-spam-filters.controller';
import { TicketSpamFiltersService } from './ticket-spam-filters.service';

@Module({
  controllers: [TicketSpamFiltersController],
  providers: [TicketSpamFiltersService],
  exports: [TicketSpamFiltersService],
})
export class TicketSpamFiltersModule {}
