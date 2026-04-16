import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CalendarService, CreateEventDto } from './calendar.service';
import { IcalService } from './ical.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Calendar')
@Controller({ version: '1', path: 'calendar' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CalendarController {
  constructor(
    private service: CalendarService,
    private icalService: IcalService,
  ) {}

  @Get('events/upcoming')
  @ApiOperation({ summary: 'Get upcoming events' })
  getUpcoming(
    @CurrentOrg() org: any,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getUpcoming(
      org.id,
      userId,
      limit ? Number(limit) : 10,
    );
  }

  @Get('events')
  @ApiOperation({ summary: 'List events in date range' })
  findAll(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: string,
  ) {
    return this.service.findAll(org.id, { from, to, userId, type });
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Get a single event' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post('events')
  @ApiOperation({ summary: 'Create an event' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateEventDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  @Patch('events/:id')
  @ApiOperation({ summary: 'Update an event' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateEventDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete('events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an event' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── iCal Feed ────────────────────────────────────────────────

  @Get('feed-url')
  @ApiOperation({ summary: 'Generate a calendar feed URL for Google Calendar sync' })
  getFeedUrl(@CurrentOrg() org: any, @CurrentUser() user: any) {
    const token = this.icalService.generateFeedToken(org.id, user.id);
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
    const feedUrl = `${baseUrl}/api/v1/calendar/feed.ics?token=${token}`;
    return { feedUrl, expiresIn: '30 days' };
  }

  @Public()
  @Get('feed.ics')
  @ApiOperation({ summary: 'iCalendar feed (public, token-authenticated)' })
  async getIcalFeed(@Query('token') token: string, @Res() res: any) {
    if (!token) {
      throw new UnauthorizedException('Feed token is required');
    }
    const verified = this.icalService.verifyFeedToken(token);
    if (!verified) {
      throw new UnauthorizedException('Invalid or expired feed token');
    }
    const ical = await this.icalService.generateCalendarFeed(
      verified.orgId,
      verified.userId,
    );
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="appoinlycrm.ics"',
    );
    res.send(ical);
  }
}
