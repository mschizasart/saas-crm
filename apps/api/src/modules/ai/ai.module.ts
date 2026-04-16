import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiComposerService } from './ai-composer.service';
import { TicketClassifierService } from './ticket-classifier.service';

@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [AiService, AiComposerService, TicketClassifierService],
  exports: [AiService, AiComposerService, TicketClassifierService],
})
export class AiModule {}
