import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiKeysService } from './api-keys.service';
import { PublicApiKeysController } from './api-keys.controller';
import { PublicWebhooksService } from './webhooks.service';
import { PublicWebhooksController } from './webhooks.controller';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookRetryScheduler } from './webhook-retry.scheduler';
import { ApiKeyStrategy } from '../auth/strategies/api-key.strategy';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * Public REST API + Webhooks (Wave E3).
 *
 * Bundles:
 *  - API key CRUD + strategy
 *  - Webhook CRUD, dispatcher, delivery processor, and retry scheduler
 *  - The combined `JwtOrApiKeyGuard` (opt-in per controller)
 *
 * BullModule.registerQueue for `webhook-delivery` is duplicated here
 * (matching the campaigns/dunning pattern) so `@InjectQueue('webhook-delivery')`
 * resolves inside this module's providers.
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: 'webhook-delivery' }),
  ],
  controllers: [PublicApiKeysController, PublicWebhooksController],
  providers: [
    ApiKeysService,
    PublicWebhooksService,
    WebhookDispatcherService,
    WebhookDeliveryProcessor,
    WebhookRetryScheduler,
    ApiKeyStrategy,
    // The combined guard depends on JwtAuthGuard — declare it here so
    // Nest's DI can resolve it when a controller opts in via @UseGuards.
    JwtAuthGuard,
    JwtOrApiKeyGuard,
  ],
  exports: [
    ApiKeysService,
    PublicWebhooksService,
    WebhookDispatcherService,
    ApiKeyStrategy,
    JwtOrApiKeyGuard,
  ],
})
export class PublicApiModule implements OnModuleInit {
  private readonly logger = new Logger(PublicApiModule.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fail boot if ENCRYPTION_KEY isn't configured — without it the webhook
   * secret encryption / HMAC signing chain silently degrades to unsigned
   * deliveries (trivially forgeable). Surfacing the misconfiguration at
   * startup is much better than at first webhook send.
   */
  onModuleInit() {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key) {
      this.logger.error(
        'ENCRYPTION_KEY is not set — required by PublicApiModule (webhook secret encryption + HMAC). Refusing to boot.',
      );
      throw new Error(
        'ENCRYPTION_KEY env var is required when the public-api module is loaded',
      );
    }
  }
}
