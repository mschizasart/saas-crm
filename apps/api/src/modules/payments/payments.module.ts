import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { GatewayFactory } from './gateways/gateway.factory';

@Module({
  imports: [ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, GatewayFactory],
  exports: [PaymentsService, GatewayFactory],
})
export class PaymentsModule {}
