import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClockService } from './clock.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Clock')
@Controller({ version: '1', path: 'clock' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ClockController {
  constructor(private service: ClockService) {}

  @Post('in')
  @ApiOperation({ summary: 'Clock in' })
  clockIn(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() body: { note?: string },
  ) {
    return this.service.clockIn(org.id, user.id, body.note);
  }

  @Post('out')
  @ApiOperation({ summary: 'Clock out' })
  clockOut(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.clockOut(org.id, user.id);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current clock status' })
  getStatus(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.getStatus(org.id, user.id);
  }

  @Get('entries')
  @ApiOperation({ summary: 'List clock entries' })
  getEntries(
    @CurrentOrg() org: any,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getEntries(org.id, {
      userId,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('today')
  @ApiOperation({ summary: 'Today\'s clock in/out report for all staff' })
  getTodayReport(@CurrentOrg() org: any) {
    return this.service.getTodayReport(org.id);
  }
}
