import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiComposerService } from './ai-composer.service';
import { AiImproveService } from './ai-improve.service';
import { InboxAiService } from './inbox-ai.service';
import { TicketClassifierService } from './ticket-classifier.service';

@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiComposerService,
    AiImproveService,
    InboxAiService,
    TicketClassifierService,
  ],
  exports: [
    AiService,
    AiComposerService,
    AiImproveService,
    InboxAiService,
    TicketClassifierService,
  ],
})
export class AiModule {}
