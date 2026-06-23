import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CallsController } from './calls.controller';
import { PublicCallsController } from './public-calls.controller';
import { CallsService } from './calls.service';
import { CallsConfigService } from './calls-config.service';
import { StorageModule } from '../storage/storage.module';

/**
 * Built-in calling + call logging (migration 044).
 *
 * - CallsService: logging CRUD + click-to-call + the public-webhook handlers.
 *   Writes a unified `activities` (type 'call') row on log/complete so calls
 *   show on the lead/client timeline.
 * - CallsConfigService: resolves Twilio creds by REUSING the org's existing
 *   `sms_settings` row (same Twilio account as SMS), falling back to the
 *   platform-env TWILIO_* creds.
 * - PublicCallsController: signature-validated Twilio voice webhooks
 *   (TwiML / status / recording).
 *
 * No BullMQ queue — there are no async jobs; the webhooks update rows inline.
 * PrismaService comes from the global DatabaseModule; StorageModule is imported
 * for call-recording storage.
 */
@Module({
  imports: [ConfigModule, StorageModule],
  controllers: [CallsController, PublicCallsController],
  providers: [CallsService, CallsConfigService],
  exports: [CallsService, CallsConfigService],
})
export class CallsModule {}
