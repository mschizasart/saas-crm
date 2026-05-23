import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TaxController } from './tax.controller';
import { TaxConfigService } from './tax-config.service';

/**
 * Exported as @Global so feature modules outside `tax/` — notably
 * `InvoicesModule` — can inject `TaxConfigService` to auto-apply tax on
 * invoice save without importing TaxModule explicitly. Same trick
 * AiModule / EmailSettingsModule use for their config services.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [TaxController],
  providers: [TaxConfigService],
  exports: [TaxConfigService],
})
export class TaxModule {}
