import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiController } from './ai.controller';
import { AiSettingsController } from './ai-settings.controller';
import { AiService } from './ai.service';
import { AiComposerService } from './ai-composer.service';
import { AiConfigService } from './ai-config.service';
import { AiImproveService } from './ai-improve.service';
import { InboxAiService } from './inbox-ai.service';
import { TicketClassifierService } from './ticket-classifier.service';

/**
 * Exported as @Global so feature modules outside `ai/` — notably
 * `LeadsModule` (lead-scoring.service.ts) — can inject `AiConfigService`
 * to resolve per-org AI providers without importing AiModule explicitly.
 * Same trick EmailSettingsModule uses for EmailSettingsService.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AiController, AiSettingsController],
  providers: [
    AiService,
    AiComposerService,
    AiConfigService,
    AiImproveService,
    InboxAiService,
    TicketClassifierService,
  ],
  exports: [
    AiService,
    AiComposerService,
    AiConfigService,
    AiImproveService,
    InboxAiService,
    TicketClassifierService,
  ],
})
export class AiModule {}
