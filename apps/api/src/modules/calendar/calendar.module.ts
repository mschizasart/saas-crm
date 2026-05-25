import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { IcalService } from './ical.service';
import { AuthModule } from '../auth/auth.module';
import { CalendarSyncController } from './calendar-sync.controller';
import { CalendarSyncService } from './sync/calendar-sync.service';
import { GoogleCalendarService } from './sync/google-calendar.service';
import { MicrosoftCalendarService } from './sync/microsoft-calendar.service';
import { CalendarSyncScheduler } from './sync/calendar-sync-scheduler.service';
import { CalendarSyncProcessor } from './sync/calendar-sync.processor';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    BullModule.registerQueue({ name: 'calendar-sync' }),
  ],
  controllers: [CalendarController, CalendarSyncController],
  providers: [
    CalendarService,
    IcalService,
    CalendarSyncService,
    GoogleCalendarService,
    MicrosoftCalendarService,
    CalendarSyncScheduler,
    CalendarSyncProcessor,
  ],
  exports: [CalendarService, IcalService, CalendarSyncService],
})
export class CalendarModule {}
