import { Module } from '@nestjs/common';
import { EstimateRequestFormsController } from './estimate-request-forms.controller';
import { EstimateRequestFormsService } from './estimate-request-forms.service';

@Module({
  controllers: [EstimateRequestFormsController],
  providers: [EstimateRequestFormsService],
  exports: [EstimateRequestFormsService],
})
export class EstimateRequestFormsModule {}
