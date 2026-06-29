import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { PublicBookingController } from './public-booking.controller';
import { BookingPagesController } from './booking-pages.controller';

/**
 * Public self-service booking (Calendly-style).
 *  - PublicBookingController: unauthenticated visitor endpoints (public/booking/*)
 *  - BookingPagesController:  authed admin CRUD (booking-pages/*)
 *
 * EmailsService comes from the @Global() EmailsModule; PrismaService from the
 * global DatabaseModule — neither needs importing here.
 */
@Module({
  controllers: [PublicBookingController, BookingPagesController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
