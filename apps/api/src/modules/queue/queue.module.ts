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
      { name: 'general' },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
