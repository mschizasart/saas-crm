import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { HealthScoreService } from './health-score.service';
// Wave H3 (E3.1) — PublicApiModule exports JwtOrApiKeyGuard +
// ApiKeyStrategy, which the controller opts into for public-API key
// auth on top of the existing JWT path.
import { PublicApiModule } from '../public-api/public-api.module';

@Module({
  imports: [PublicApiModule],
  controllers: [ClientsController],
  providers: [ClientsService, HealthScoreService],
  exports: [ClientsService, HealthScoreService],
})
export class ClientsModule {}
