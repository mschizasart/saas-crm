import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/permissions.decorator';
import { BookingService } from './booking.service';
import { PublicBookDto } from './dto/public-book.dto';

/**
 * Public, unauthenticated self-service booking (Calendly-style).
 *
 * Route prefix `public/booking` is recognised by TenantInterceptor as org-less
 * (no JWT, no subdomain) — the org is resolved from the :orgSlug path param in
 * the service. Each handler is also @Public() so JwtAuthGuard is skipped.
 */
@ApiTags('Public Booking')
@Controller({ version: '1', path: 'public/booking' })
export class PublicBookingController {
  constructor(private service: BookingService) {}

  @Get(':orgSlug/:pageSlug')
  @Public()
  @ApiOperation({ summary: 'Fetch a public booking page for rendering' })
  getPage(
    @Param('orgSlug') orgSlug: string,
    @Param('pageSlug') pageSlug: string,
  ) {
    return this.service.getPublicPage(orgSlug, pageSlug);
  }

  @Get(':orgSlug/:pageSlug/slots')
  @Public()
  @ApiOperation({ summary: 'Available slots for a date (YYYY-MM-DD)' })
  getSlots(
    @Param('orgSlug') orgSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Query('date') date: string,
  ) {
    return this.service.getPublicSlots(orgSlug, pageSlug, date);
  }

  @Post(':orgSlug/:pageSlug/book')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Request a booking — creates a PENDING Appointment and emails a confirm link (double-opt-in)',
  })
  book(
    @Param('orgSlug') orgSlug: string,
    @Param('pageSlug') pageSlug: string,
    @Body() body: PublicBookDto,
    @Ip() ip: string,
  ) {
    return this.service.book(orgSlug, pageSlug, body, ip ?? null);
  }

  /**
   * Email double-opt-in confirm: the visitor opens the link emailed by /book.
   * Flips the pending appointment to 'scheduled' (first verifier wins) and sends
   * the confirmation + staff emails. The token is a single-use secret, so this
   * carries low abuse risk; the per-IP burst limit still guards it.
   */
  @Post('verify/:token')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a pending booking via its email link token' })
  verify(@Param('token') token: string, @Ip() ip: string) {
    return this.service.verify(token, ip ?? null);
  }
}
