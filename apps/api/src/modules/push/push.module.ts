import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Web push notification module.
 *
 * Stand-alone module so other modules (notifications, automations, etc.)
 * can `imports: [PushModule]` and inject `PushService` to fan-out events
 * to subscribed devices.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
