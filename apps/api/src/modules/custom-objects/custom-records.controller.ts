import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomRecordsService } from './custom-records.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Custom Records')
@Controller({ version: '1', path: 'custom-objects' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class CustomRecordsController {
  constructor(private records: CustomRecordsService) {}

  @Get(':slug/records')
  @Permissions('custom-records.view')
  @ApiOperation({ summary: 'List records for a custom object (paged)' })
  list(
    @CurrentOrg() org: any,
    @Param('slug') slug: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.records.list(org.id, slug, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':slug/records')
  @Permissions('custom-records.create')
  @ApiOperation({ summary: 'Create a new record for a custom object' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('slug') slug: string,
    @Body() body: { data: Record<string, any> } | Record<string, any>,
  ) {
    // Accept either { data: {…} } or the raw {…} body shape so the web
    // form can post the field map directly.
    const data =
      body && typeof body === 'object' && 'data' in body
        ? (body as any).data
        : body;
    return this.records.create(org.id, user?.id ?? null, slug, data);
  }

  @Get(':slug/records/:recordId')
  @Permissions('custom-records.view')
  @ApiOperation({ summary: 'Get a single record' })
  findOne(
    @CurrentOrg() org: any,
    @Param('slug') slug: string,
    @Param('recordId') recordId: string,
  ) {
    return this.records.findOne(org.id, slug, recordId);
  }

  @Put(':slug/records/:recordId')
  @Permissions('custom-records.edit')
  @ApiOperation({ summary: 'Update a record (partial — merges into jsonb)' })
  update(
    @CurrentOrg() org: any,
    @Param('slug') slug: string,
    @Param('recordId') recordId: string,
    @Body() body: { data: Record<string, any> } | Record<string, any>,
  ) {
    const data =
      body && typeof body === 'object' && 'data' in body
        ? (body as any).data
        : body;
    return this.records.update(org.id, slug, recordId, data);
  }

  @Delete(':slug/records/:recordId')
  @Permissions('custom-records.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a record' })
  remove(
    @CurrentOrg() org: any,
    @Param('slug') slug: string,
    @Param('recordId') recordId: string,
  ) {
    return this.records.remove(org.id, slug, recordId);
  }
}
