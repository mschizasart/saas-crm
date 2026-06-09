import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { QuotesService } from './quotes.service';
import {
  CreateQuoteDto,
  UpdateQuoteDto,
  SendQuoteDto,
} from './cpq.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('CPQ — Quotes')
@Controller({ version: '1', path: 'quotes' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class QuotesController {
  constructor(private service: QuotesService) {}

  @Get()
  @Permissions('quotes.view')
  @ApiOperation({ summary: 'List quotes (paginated, filterable)' })
  list(
    @CurrentOrg() org: any,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      status,
      clientId,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('quotes.view')
  @ApiOperation({ summary: 'Fetch a single quote with line items' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('quotes.create')
  @ApiOperation({ summary: 'Create a new quote (draft status)' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Put(':id')
  @Permissions('quotes.edit')
  @ApiOperation({ summary: 'Update a DRAFT quote (use lifecycle endpoints for status)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('quotes.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a DRAFT quote (refused for sent/accepted)' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  @Post(':id/send')
  @Permissions('quotes.send')
  @ApiOperation({ summary: 'Send a draft quote to the client (status → sent)' })
  send(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: SendQuoteDto,
  ) {
    return this.service.send(org.id, id, dto ?? {});
  }

  @Post(':id/mark-accepted')
  @Permissions('quotes.edit')
  @ApiOperation({ summary: 'Mark a sent quote as accepted' })
  markAccepted(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.markAccepted(org.id, id);
  }

  @Post(':id/mark-rejected')
  @Permissions('quotes.edit')
  @ApiOperation({ summary: 'Mark a sent quote as rejected' })
  markRejected(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.markRejected(org.id, id);
  }

  @Post(':id/duplicate')
  @Permissions('quotes.create')
  @ApiOperation({ summary: 'Duplicate a quote (new draft, fresh number)' })
  duplicate(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.duplicate(org.id, user.id, id);
  }

  @Post(':id/convert-to-invoice')
  @Permissions('quotes.edit')
  @ApiOperation({ summary: 'Convert an accepted quote to an Invoice' })
  convertToInvoice(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.convertToInvoice(org.id, user.id, id);
  }
}
