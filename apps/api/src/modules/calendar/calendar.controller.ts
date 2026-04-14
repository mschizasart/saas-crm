import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CalendarService, CreateEventDto } from './calendar.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Calendar')
@Controller({ version: '1', path: 'calendar' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CalendarController {
  constructor(private service: CalendarService) {}

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
}
