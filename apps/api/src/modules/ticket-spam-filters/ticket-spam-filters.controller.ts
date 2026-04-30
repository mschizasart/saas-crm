import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  TicketSpamFiltersService,
  CreateSpamFilterDto,
  UpdateSpamFilterDto,
  TicketDraft,
} from './ticket-spam-filters.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Ticket Spam Filters')
@Controller({ version: '1', path: 'ticket-spam-filters' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class TicketSpamFiltersController {
  constructor(private service: TicketSpamFiltersService) {}

  @Get()
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'List all ticket spam filters for the org' })
  findAll(@CurrentOrg() org: any) {
    return this.service.findAll(org.id);
  }

  @Get(':id')
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'Get a single ticket spam filter' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'Create a ticket spam filter' })
  create(@CurrentOrg() org: any, @Body() dto: CreateSpamFilterDto) {
    return this.service.create(org.id, dto);
  }

  @Put(':id')
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'Update a ticket spam filter' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateSpamFilterDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('tickets.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ticket spam filter' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  @Post('test')
  @Permissions('tickets.edit')
  @ApiOperation({
    summary:
      'Dry-run a ticket draft against all active filters; returns matching rules',
  })
  test(@CurrentOrg() org: any, @Body() draft: TicketDraft) {
    return this.service.test(org.id, draft);
  }
}
