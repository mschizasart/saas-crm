import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { HealthScoreService } from './health-score.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, HealthScoreService],
  exports: [ClientsService, HealthScoreService],
})
export class ClientsModule {}
