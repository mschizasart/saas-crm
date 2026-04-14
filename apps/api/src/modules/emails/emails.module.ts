import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';
import { EmailProcessor } from './email.processor';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'emails' })],
  controllers: [EmailsController],
  providers: [EmailsService, EmailProcessor],
  exports: [EmailsService],
})
export class EmailsModule {}
