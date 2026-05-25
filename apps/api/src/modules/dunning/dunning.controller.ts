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
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DunningService } from './dunning.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

interface RuleDto {
  name?: string;
  offsetDays?: number;
  subject?: string;
  body?: string;
  isActive?: boolean;
}

/**
 * Bound for `offsetDays` (days relative to the invoice due date). Kept in
 * sync with the service-layer clamp in dunning.service.ts. ±365 days covers
 * every realistic reminder schedule while preventing an unbounded offset from
 * matching every open invoice in a single pass.
 */
export const OFFSET_DAYS_MIN = -365;
export const OFFSET_DAYS_MAX = 365;

@ApiTags('Dunning')
@Controller({ version: '1', path: 'dunning' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class DunningController {
  constructor(
    private readonly service: DunningService,
    @InjectQueue('dunning') private readonly queue: Queue,
  ) {}

  // ─── Settings ───────────────────────────────────────────────────────────

  @Get('settings')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get dunning settings (enabled toggle)' })
  getSettings(@CurrentOrg() org: any) {
    return this.service.getSettings(org.id);
  }

  @Put('settings')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update dunning settings (enabled toggle)' })
  updateSettings(
    @CurrentOrg() org: any,
    @Body() dto: { enabled?: boolean },
  ) {
    if (typeof dto?.enabled !== 'boolean') {
      throw new BadRequestException('`enabled` must be a boolean');
    }
    return this.service.updateSettings(org.id, dto.enabled);
  }

  // ─── Rules CRUD ─────────────────────────────────────────────────────────

  @Get('rules')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'List reminder rules (ordered by offsetDays)' })
  listRules(@CurrentOrg() org: any) {
    return this.service.listRules(org.id);
  }

  @Post('rules')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a reminder rule' })
  createRule(@CurrentOrg() org: any, @Body() dto: RuleDto) {
    this.assertRulePayload(dto, true);
    return this.service.createRule(org.id, {
      name: dto.name!,
      offsetDays: dto.offsetDays!,
      subject: dto.subject!,
      body: dto.body!,
      isActive: dto.isActive,
    });
  }

  @Put('rules/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update a reminder rule' })
  async updateRule(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: RuleDto,
  ) {
    this.assertRulePayload(dto, false);
    const updated = await this.service.updateRule(org.id, id, dto);
    if (!updated) throw new NotFoundException('Dunning rule not found');
    return updated;
  }

  @Delete('rules/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Delete a reminder rule' })
  async deleteRule(@CurrentOrg() org: any, @Param('id') id: string) {
    const res = await this.service.deleteRule(org.id, id);
    if (!res.deleted) throw new NotFoundException('Dunning rule not found');
    return res;
  }

  // ─── Manual run ─────────────────────────────────────────────────────────

  /**
   * Trigger the dunning pass for this org. Enqueues a `dunning-run` job on
   * the BullMQ `dunning` queue (NOT run synchronously in the HTTP path).
   * Per-org `jobId` de-dupes against an already-running sweep, and the
   * unique log guard makes a concurrent cron tick + this manual run safe.
   */
  @Post('run')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Manually trigger the dunning pass for this org (queued)' })
  async run(@CurrentOrg() org: any) {
    await this.queue.add(
      'dunning-run',
      { orgId: org.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
        jobId: `dunning-run:${org.id}`,
      },
    );
    return { queued: true };
  }

  // ─── Logs ───────────────────────────────────────────────────────────────

  @Get('logs')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Sent-reminder history for an invoice' })
  getLogs(@CurrentOrg() org: any, @Query('invoiceId') invoiceId: string) {
    if (!invoiceId) throw new BadRequestException('invoiceId is required');
    return this.service.getLogsForInvoice(org.id, invoiceId);
  }

  // ─── Validation ─────────────────────────────────────────────────────────

  private assertRulePayload(dto: RuleDto, requireAll: boolean) {
    if (requireAll) {
      if (!dto?.name?.trim()) throw new BadRequestException('name is required');
      this.assertOffsetDays(dto.offsetDays, true);
      if (!dto?.subject?.trim())
        throw new BadRequestException('subject is required');
      if (!dto?.body?.trim()) throw new BadRequestException('body is required');
    } else {
      if (dto.offsetDays !== undefined) {
        this.assertOffsetDays(dto.offsetDays, true);
      }
    }
  }

  /**
   * Validate offsetDays. Must be a finite number within a sane bounded range
   * (±1 year). An unbounded offset like -99999 would make `today >= dueDate +
   * offset` true for EVERY open invoice, triggering a runaway send to the
   * whole book — so we reject anything out of range with a clear 400. The
   * service layer re-clamps as a defensive backstop.
   */
  private assertOffsetDays(value: unknown, required: boolean) {
    if (value === undefined || value === null) {
      if (required) throw new BadRequestException('offsetDays is required');
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException('offsetDays must be a number');
    }
    if (value < OFFSET_DAYS_MIN || value > OFFSET_DAYS_MAX) {
      throw new BadRequestException(
        `offsetDays must be between ${OFFSET_DAYS_MIN} and ${OFFSET_DAYS_MAX}`,
      );
    }
  }
}
