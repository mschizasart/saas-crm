import { Module, forwardRef } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { IcalService } from './ical.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [CalendarController],
  providers: [CalendarService, IcalService],
  exports: [CalendarService, IcalService],
})
export class CalendarModule {}
