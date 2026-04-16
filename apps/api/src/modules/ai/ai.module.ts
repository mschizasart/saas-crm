import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { TicketClassifierService } from './ticket-classifier.service';

@Module({
  controllers: [AiController],
  providers: [AiService, TicketClassifierService],
  exports: [AiService, TicketClassifierService],
})
export class AiModule {}
