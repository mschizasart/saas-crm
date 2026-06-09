import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          try {
            const url = new URL(redisUrl);
            return {
              connection: {
                host: url.hostname || 'redis',
                port: parseInt(url.port || '6379', 10),
                password: url.password || undefined,
              },
            };
          } catch {
            // Fall through to host/port
          }
        }
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', 'redis'),
            port: parseInt(config.get<string>('REDIS_PORT', '6379'), 10),
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: 'emails' },
      { name: 'recurring-invoices' },
      { name: 'imap-poll' },
      { name: 'inbox-imap' },
      { name: 'general' },
      // Lead scoring (migration 013) — heuristic + AI score per lead.
      // Concurrency is set on the WorkerHost (LeadScoringProcessor),
      // not here — BullModule.registerQueue is for queue config only.
      { name: 'lead-scoring' },
      // Dunning (migration 026) — per-org overdue-invoice reminder sweeps.
      // Concurrency is set on the WorkerHost (DunningProcessor).
      { name: 'dunning' },
      // 2-way calendar sync (migration 025) — per-CalendarSync sync job
      // enqueued by CalendarSyncScheduler every 15 min. Concurrency (4) is
      // set on CalendarSyncProcessor.
      { name: 'calendar-sync' },
      // Bulk email campaigns (migration 024) — one job per campaign drives
      // the send loop. Concurrency (5) is set on CampaignsProcessor.
      { name: 'campaigns' },
      // Public outbound webhook delivery (Wave E3, migration 032) — one
      // job per delivery row. Concurrency (8) is set on
      // WebhookDeliveryProcessor. The delivery row in
      // public_webhook_deliveries is the source of truth; the queue is
      // just the scheduler. A 1-min fallback sweep
      // (WebhookRetryScheduler) re-enqueues due rows in case BullMQ
      // loses a delayed job.
      { name: 'webhook-delivery' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
