import { Module } from '@nestjs/common';
import { PredefinedRepliesController } from './predefined-replies.controller';
import { PredefinedRepliesService } from './predefined-replies.service';

@Module({
  controllers: [PredefinedRepliesController],
  providers: [PredefinedRepliesService],
  exports: [PredefinedRepliesService],
})
export class PredefinedRepliesModule {}
