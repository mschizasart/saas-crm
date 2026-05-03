import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadScoringService } from './lead-scoring.service';
import { LeadScoringProcessor } from './lead-scoring.processor';
import { LeadScoringListener } from './lead-scoring.listener';

@Module({
  imports: [
    // Local registration so @InjectQueue('lead-scoring') resolves inside
    // this module (the global QueueModule already declares the queue
    // for the connection / worker host wiring).
    BullModule.registerQueue({ name: 'lead-scoring' }),
  ],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadScoringService,
    LeadScoringProcessor,
    LeadScoringListener,
  ],
  exports: [LeadsService, LeadScoringService],
})
export class LeadsModule {}
