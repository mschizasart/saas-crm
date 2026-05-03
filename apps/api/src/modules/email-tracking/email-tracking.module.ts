import { Module } from '@nestjs/common';
import { EmailTrackingController } from './email-tracking.controller';
import { OutboundMessagesController } from './outbound-messages.controller';

/**
 * Holds the public open / click tracking endpoints AND the auth'd
 * "list outbound messages" endpoint used by the per-record "Sent emails"
 * panel.
 *
 * PrismaService is provided globally elsewhere — no extra wiring needed.
 */
@Module({
  controllers: [EmailTrackingController, OutboundMessagesController],
})
export class EmailTrackingModule {}
