import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { CampaignsController } from './campaigns.controller';
import { PublicCampaignsController } from './public-campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsProcessor } from './campaigns.processor';

/**
 * Bulk email campaigns / newsletters (migration 024).
 *
 * Reuses the global EmailsService (EmailsModule is @Global) to actually send —
 * each recipient goes through emailsService.queue() with campaign tracking, so
 * opens/clicks attribute back through OutboundMessage for free.
 *
 * Registers the 'campaigns' queue locally so @InjectQueue('campaigns') resolves
 * here; the queue connection itself is owned by the global QueueModule.
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: 'campaigns' }),
  ],
  controllers: [CampaignsController, PublicCampaignsController],
  providers: [CampaignsService, CampaignsProcessor],
  exports: [CampaignsService],
})
export class CampaignsModule {}
