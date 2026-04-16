import { Module } from '@nestjs/common';
import { NewsfeedController } from './newsfeed.controller';
import { NewsfeedService } from './newsfeed.service';

@Module({
  controllers: [NewsfeedController],
  providers: [NewsfeedService],
  exports: [NewsfeedService],
})
export class NewsfeedModule {}
