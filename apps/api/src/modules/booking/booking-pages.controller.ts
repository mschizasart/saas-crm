import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BookingService } from './booking.service';
import {
  CreateBookingPageDto,
  UpdateBookingPageDto,
} from './dto/booking-page.dto';

/**
 * Admin CRUD for booking pages. Gated by the new `bookingPages.*` permission
 * family (seeded to Admin in seed-org.ts). The existing appointments controller
 * uses no @Permissions at all, so there were no appointments.* perms to reuse;
 * we add a dedicated family rather than leave these endpoints ungated.
 */
@ApiTags('Booking Pages')
@Controller({ version: '1', path: 'booking-pages' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class BookingPagesController {
  constructor(private service: BookingService) {}

  @Get()
  @Permissions('bookingPages.view')
  @ApiOperation({ summary: 'List booking pages for the current organization' })
  list(@CurrentOrg() org: any) {
    return this.service.list(org.id);
  }

  @Get(':id')
  @Permissions('bookingPages.view')
  @ApiOperation({ summary: 'Get a single booking page' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('bookingPages.create')
  @ApiOperation({ summary: 'Create a booking page' })
  create(@CurrentOrg() org: any, @Body() dto: CreateBookingPageDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('bookingPages.edit')
  @ApiOperation({ summary: 'Update a booking page' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateBookingPageDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('bookingPages.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a booking page' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }
}
