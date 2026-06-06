/**
 * CRUD + execution for saved report definitions (Wave D2).
 *
 * NOTE on naming: this file is named `report-defs.service.ts` (not
 * `reports.service.ts`) because the existing canned `ReportsService` —
 * with hand-written sales / leads / clients / time-tracking / P&L
 * reports — already lives in this folder. The builder is a separate
 * concern that operates on persisted `Report` rows, so it gets its own
 * class. Both are wired up in `reports.module.ts`.
 *
 * All queries are tenant-scoped via `prisma.withOrganization(orgId, …)`
 * AND with explicit `where: { organizationId: orgId }` (belt and braces).
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  buildAndRun,
  describeEntities,
  ENTITY_REGISTRY,
  type ReportFilter,
  type ReportAggregation,
} from './report-engine';
import { CreateReportDto, UpdateReportDto } from './reports.dto';

const ALLOWED_CHART_TYPES = new Set(['table', 'bar', 'line', 'pie']);

@Injectable()
export class ReportDefsService {
  constructor(private prisma: PrismaService) {}

  // ─── Metadata ─────────────────────────────────────────────────────

  entities() {
    return describeEntities();
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  async list(orgId: string, query: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const [data, total] = await Promise.all([
        tx.report.findMany({
          where: { organizationId: orgId },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
        }),
        tx.report.count({ where: { organizationId: orgId } }),
      ]);
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const row = await tx.report.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!row) throw new NotFoundException('Report not found');
      return row;
    });
  }

  async create(orgId: string, userId: string | null, dto: CreateReportDto) {
    this.validateDto(dto, /* requireName */ true);
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      return tx.report.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description ?? null,
          entityType: dto.entityType,
          filters: (dto.filters ?? []) as unknown as object,
          groupBy: dto.groupBy ?? null,
          aggregations: (dto.aggregations ?? []) as unknown as object,
          chartType: dto.chartType ?? 'table',
          createdById: userId ?? null,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateReportDto) {
    this.validateDto(dto, /* requireName */ false);
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.report.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Report not found');

      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.entityType !== undefined) data.entityType = dto.entityType;
      if (dto.filters !== undefined) data.filters = dto.filters as unknown as object;
      if (dto.groupBy !== undefined) data.groupBy = dto.groupBy;
      if (dto.aggregations !== undefined) {
        data.aggregations = dto.aggregations as unknown as object;
      }
      if (dto.chartType !== undefined) data.chartType = dto.chartType;

      return tx.report.update({ where: { id }, data });
    });
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.report.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Report not found');
      await tx.report.delete({ where: { id } });
    });
  }

  // ─── Execution ────────────────────────────────────────────────────

  async run(orgId: string, id: string) {
    const report = await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const result = await buildAndRun(tx, orgId, {
        entity: report.entityType,
        filters: this.parseJsonArray(report.filters) as ReportFilter[],
        groupBy: report.groupBy,
        aggregations: this.parseJsonArray(
          report.aggregations,
        ) as ReportAggregation[],
      });
      return {
        data: result.rows,
        meta: {
          ...result.meta,
          reportId: id,
          chartType: report.chartType,
          name: report.name,
        },
      };
    });
  }

  /**
   * Used by DashboardsService.findOneWithData() — executes a known-good
   * report row (already loaded inside the transaction) without re-fetching
   * it. Skipping the extra round-trip matters when a dashboard has many
   * widgets.
   */
  async runFromRow(tx: any, orgId: string, report: any) {
    const result = await buildAndRun(tx, orgId, {
      entity: report.entityType,
      filters: this.parseJsonArray(report.filters) as ReportFilter[],
      groupBy: report.groupBy,
      aggregations: this.parseJsonArray(
        report.aggregations,
      ) as ReportAggregation[],
    });
    return {
      data: result.rows,
      meta: {
        ...result.meta,
        reportId: report.id,
        chartType: report.chartType,
        name: report.name,
      },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private validateDto(
    dto: CreateReportDto | UpdateReportDto,
    requireName: boolean,
  ): void {
    if (requireName && (!dto.name || typeof dto.name !== 'string')) {
      throw new BadRequestException('"name" is required');
    }
    if (dto.entityType !== undefined) {
      if (typeof dto.entityType !== 'string' || !ENTITY_REGISTRY[dto.entityType]) {
        throw new BadRequestException(
          `"entityType" must be one of: ${Object.keys(ENTITY_REGISTRY).join(', ')}`,
        );
      }
    }
    if (dto.chartType !== undefined && !ALLOWED_CHART_TYPES.has(dto.chartType)) {
      throw new BadRequestException(
        '"chartType" must be one of: table, bar, line, pie',
      );
    }
    if (dto.filters !== undefined && !Array.isArray(dto.filters)) {
      throw new BadRequestException('"filters" must be an array');
    }
    if (dto.aggregations !== undefined && !Array.isArray(dto.aggregations)) {
      throw new BadRequestException('"aggregations" must be an array');
    }
  }

  private parseJsonArray(v: unknown): unknown[] {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}
