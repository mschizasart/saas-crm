import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  BulkCreateDto,
  BulkDeleteDto,
  BulkOperationsListQueryDto,
  BulkUpdateDto,
  BulkEntityType,
} from './bulk-api.dto';
import { BulkService } from './bulk.service';
import { CsvImportService } from './csv-import.service';

/**
 * Wave H3 — Public bulk API + CSV import.
 *
 * Routes:
 *   POST    /bulk/<entity>                — bulk create
 *   PUT     /bulk/<entity>                — bulk update
 *   DELETE  /bulk/<entity>                — bulk delete
 *   POST    /bulk/<entity>/import-csv     — CSV upload (multipart)
 *   GET     /bulk/operations              — past runs (list)
 *   GET     /bulk/operations/:id          — single run detail
 *
 * Guards:
 *   `JwtOrApiKeyGuard` accepts BOTH the in-app JWT and a public-API
 *   `crm_*` bearer token. The `Permissions(...)` decorator is read
 *   by `RbacGuard`; for API-key callers the existing RbacGuard /
 *   public-API scope-check still applies per Wave E3 contract.
 *
 * Permissions namespace: `bulk.clients` / `bulk.leads` / etc., plus
 * `bulk.view` for the read endpoints. See seed-org.ts for the
 * canonical grant set.
 */
@ApiTags('Bulk')
@Controller({ version: '1', path: 'bulk' })
@UseGuards(JwtOrApiKeyGuard, RbacGuard)
@ApiBearerAuth()
export class BulkController {
  constructor(
    private readonly bulk: BulkService,
    private readonly csv: CsvImportService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  //  Past-runs read endpoints (declared FIRST so /bulk/operations
  //  isn't shadowed by the more generic /bulk/:entity matchers).
  // ═══════════════════════════════════════════════════════════

  @Get('operations')
  @Permissions('bulk.view')
  @ApiOperation({ summary: 'List past bulk-operation runs for the org' })
  listOperations(
    @CurrentOrg() org: any,
    @Query() query: BulkOperationsListQueryDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bulk.listOperations(org.id, {
      entity_type: query.entity_type,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('operations/:id')
  @Permissions('bulk.view')
  @ApiOperation({ summary: 'Get a single bulk-operation run with the full sampled errors' })
  getOperation(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.bulk.findOperation(org.id, id);
  }

  // ═══════════════════════════════════════════════════════════
  //  CLIENTS
  // ═══════════════════════════════════════════════════════════

  @Post('clients')
  @Permissions('bulk.clients')
  @ApiOperation({ summary: 'Bulk-create clients (per-row partial success)' })
  bulkCreateClients(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkCreateDto,
  ) {
    return this.bulk.bulkCreate(org.id, this.userId(user), 'client', dto.rows);
  }

  @Put('clients')
  @Permissions('bulk.clients')
  @ApiOperation({ summary: 'Bulk-update clients (rows must include id)' })
  bulkUpdateClients(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkUpdateDto,
  ) {
    return this.bulk.bulkUpdate(org.id, this.userId(user), 'client', dto.rows);
  }

  @Delete('clients')
  @Permissions('bulk.clients')
  @ApiOperation({ summary: 'Bulk-delete clients by id list' })
  bulkDeleteClients(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteDto,
  ) {
    return this.bulk.bulkDelete(org.id, this.userId(user), 'client', dto.ids);
  }

  @Post('clients/import-csv')
  @Permissions('bulk.clients')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import clients from a CSV file (multipart/form-data)' })
  importCsvClients(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.handleCsvUpload(org.id, this.userId(user), 'client', req);
  }

  // ═══════════════════════════════════════════════════════════
  //  LEADS
  // ═══════════════════════════════════════════════════════════

  @Post('leads')
  @Permissions('bulk.leads')
  @ApiOperation({ summary: 'Bulk-create leads (per-row partial success)' })
  bulkCreateLeads(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkCreateDto,
  ) {
    return this.bulk.bulkCreate(org.id, this.userId(user), 'lead', dto.rows);
  }

  @Put('leads')
  @Permissions('bulk.leads')
  @ApiOperation({ summary: 'Bulk-update leads (rows must include id)' })
  bulkUpdateLeads(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkUpdateDto,
  ) {
    return this.bulk.bulkUpdate(org.id, this.userId(user), 'lead', dto.rows);
  }

  @Delete('leads')
  @Permissions('bulk.leads')
  @ApiOperation({ summary: 'Bulk-delete leads by id list' })
  bulkDeleteLeads(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteDto,
  ) {
    return this.bulk.bulkDelete(org.id, this.userId(user), 'lead', dto.ids);
  }

  @Post('leads/import-csv')
  @Permissions('bulk.leads')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import leads from a CSV file (multipart/form-data)' })
  importCsvLeads(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.handleCsvUpload(org.id, this.userId(user), 'lead', req);
  }

  // ═══════════════════════════════════════════════════════════
  //  OPPORTUNITIES
  // ═══════════════════════════════════════════════════════════

  @Post('opportunities')
  @Permissions('bulk.opportunities')
  @ApiOperation({ summary: 'Bulk-create opportunities (per-row partial success)' })
  bulkCreateOpps(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkCreateDto,
  ) {
    return this.bulk.bulkCreate(
      org.id,
      this.userId(user),
      'opportunity',
      dto.rows,
    );
  }

  @Put('opportunities')
  @Permissions('bulk.opportunities')
  @ApiOperation({ summary: 'Bulk-update opportunities (rows must include id)' })
  bulkUpdateOpps(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkUpdateDto,
  ) {
    return this.bulk.bulkUpdate(
      org.id,
      this.userId(user),
      'opportunity',
      dto.rows,
    );
  }

  @Delete('opportunities')
  @Permissions('bulk.opportunities')
  @ApiOperation({ summary: 'Bulk-delete opportunities by id list' })
  bulkDeleteOpps(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteDto,
  ) {
    return this.bulk.bulkDelete(
      org.id,
      this.userId(user),
      'opportunity',
      dto.ids,
    );
  }

  @Post('opportunities/import-csv')
  @Permissions('bulk.opportunities')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import opportunities from a CSV file (multipart/form-data)' })
  importCsvOpps(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.handleCsvUpload(org.id, this.userId(user), 'opportunity', req);
  }

  // ═══════════════════════════════════════════════════════════
  //  TASKS
  // ═══════════════════════════════════════════════════════════

  @Post('tasks')
  @Permissions('bulk.tasks')
  @ApiOperation({ summary: 'Bulk-create tasks (per-row partial success)' })
  bulkCreateTasks(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkCreateDto,
  ) {
    return this.bulk.bulkCreate(org.id, this.userId(user), 'task', dto.rows);
  }

  @Put('tasks')
  @Permissions('bulk.tasks')
  @ApiOperation({ summary: 'Bulk-update tasks (rows must include id)' })
  bulkUpdateTasks(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkUpdateDto,
  ) {
    return this.bulk.bulkUpdate(org.id, this.userId(user), 'task', dto.rows);
  }

  @Delete('tasks')
  @Permissions('bulk.tasks')
  @ApiOperation({ summary: 'Bulk-delete tasks by id list' })
  @HttpCode(HttpStatus.OK)
  bulkDeleteTasks(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BulkDeleteDto,
  ) {
    return this.bulk.bulkDelete(org.id, this.userId(user), 'task', dto.ids);
  }

  @Post('tasks/import-csv')
  @Permissions('bulk.tasks')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import tasks from a CSV file (multipart/form-data)' })
  importCsvTasks(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.handleCsvUpload(org.id, this.userId(user), 'task', req);
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Pulls the user id off the request principal.
   * For API-key callers the principal id is prefixed `api-key:<keyId>`
   * (see ApiKeyStrategy). We pass `null` in that case so the audit
   * row's `created_by_id` stays nullable rather than pointing at a
   * fake user FK that would never match `users(id)`.
   */
  private userId(user: any): string | null {
    if (!user?.id) return null;
    if (typeof user.id === 'string' && user.id.startsWith('api-key:')) return null;
    return user.id;
  }

  /**
   * Shared multipart/form-data extractor (Fastify `@fastify/multipart`
   * is registered globally; see storage.controller.ts for the
   * canonical pattern). 5 MB cap matches the existing per-entity
   * CSV importers.
   */
  private async handleCsvUpload(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    req: any,
  ) {
    if (typeof req.file !== 'function' && typeof req.parts !== 'function') {
      throw new BadRequestException(
        'Multipart not supported — @fastify/multipart not registered',
      );
    }

    const MAX_BYTES = 5 * 1024 * 1024;
    let buffer: Buffer | null = null;
    let hasHeader = true;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (buf.length > MAX_BYTES) {
          throw new PayloadTooLargeException(
            `CSV file exceeds 5MB limit (${buf.length} bytes)`,
          );
        }
        buffer = buf;
      } else if (part.fieldname === 'hasHeader') {
        // Multipart text field — string "false" disables header.
        hasHeader = String(part.value).toLowerCase() !== 'false';
      }
    }

    if (!buffer) {
      throw new BadRequestException(
        'No CSV file uploaded (field name: "file")',
      );
    }

    return this.csv.importCsv(orgId, userId, entityType, buffer, hasHeader);
  }
}
