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
import {
  AppointmentsService,
  CreateAppointmentDto,
  BookPublicDto,
} from './appointments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Public } from '../../common/decorators/permissions.decorator';

@ApiTags('Appointments')
@Controller({ version: '1', path: 'appointments' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class AppointmentsController {
  constructor(private service: AppointmentsService) {}

  @Get('slots')
  @ApiOperation({ summary: 'Get available time slots for a staff member on a date' })
  getSlots(
    @CurrentOrg() org: any,
    @Query('staffId') staffId: string,
    @Query('date') date: string,
  ) {
    return this.service.getAvailableSlots(org.id, staffId, date);
  }

  @Post('book')
  @Public()
  @ApiOperation({ summary: 'Public booking endpoint' })
  bookPublic(@Body() dto: BookPublicDto) {
    return this.service.bookFromPublic(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List appointments with optional date range and staff filter' })
  findAll(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.service.findAll(org.id, { from, to, staffId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single appointment' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new appointment' })
  create(@CurrentOrg() org: any, @Body() dto: CreateAppointmentDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an appointment' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateAppointmentDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an appointment' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
