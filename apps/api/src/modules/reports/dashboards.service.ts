/**
 * CRUD + composition for dashboards (Wave D2).
 *
 * A dashboard is a named collection of report widgets, each placed on
 * a grid via `position: { x, y, w, h }`. `findOneWithData` returns the
 * dashboard PLUS every widget's executed report data in parallel.
 *
 * Tenant scoping: `prisma.withOrganization(orgId, …)` is used for every
 * call, AND `where: { organizationId: orgId }` is always added. Each
 * widget's report runs through the same hardened `buildAndRun` path as
 * a standalone report — the security guarantees compose.
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ReportDefsService } from './report-defs.service';
import {
  CreateDashboardDto,
  UpdateDashboardDto,
  CreateWidgetDto,
  UpdateWidgetDto,
  WidgetPositionDto,
} from './reports.dto';

type WidgetPosition = WidgetPositionDto;

@Injectable()
export class DashboardsService {
  constructor(
    private prisma: PrismaService,
    private reportDefs: ReportDefsService,
  ) {}

  // ─── Dashboard CRUD ───────────────────────────────────────────────

  async list(orgId: string, query: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25)));
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const [data, total] = await Promise.all([
        tx.dashboard.findMany({
          where: { organizationId: orgId },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: limit,
          include: { _count: { select: { widgets: true } } },
        }),
        tx.dashboard.count({ where: { organizationId: orgId } }),
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
      const row = await tx.dashboard.findFirst({
        where: { id, organizationId: orgId },
        include: {
          widgets: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!row) throw new NotFoundException('Dashboard not found');
      return row;
    });
  }

  /**
   * Load the dashboard + all widgets, then execute every widget's report
   * concurrently. Each `runFromRow` call goes through the hardened
   * `buildAndRun` path so the whitelist/RLS guarantees compose.
   */
  async findOneWithData(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const dashboard = await tx.dashboard.findFirst({
        where: { id, organizationId: orgId },
        include: { widgets: { orderBy: { createdAt: 'asc' } } },
      });
      if (!dashboard) throw new NotFoundException('Dashboard not found');

      // Pre-fetch all referenced reports in one query (one trip vs N).
      const reportIds = dashboard.widgets.map((w: any) => w.reportId);
      const reports = reportIds.length
        ? await tx.report.findMany({
            where: { id: { in: reportIds }, organizationId: orgId },
          })
        : [];
      const reportById = new Map<string, any>(
        reports.map((r: any) => [r.id, r]),
      );

      // Run all widget reports in PARALLEL. Individual failures are
      // captured so one bad widget doesn't take down the whole dashboard.
      const widgetsWithData = await Promise.all(
        dashboard.widgets.map(async (w: any) => {
          const report = reportById.get(w.reportId);
          if (!report) {
            return {
              id: w.id,
              reportId: w.reportId,
              title: w.title,
              position: w.position,
              data: null,
              meta: null,
              error: 'Report not found or out of org scope',
            };
          }
          try {
            const result = await this.reportDefs.runFromRow(tx, orgId, report);
            return {
              id: w.id,
              reportId: w.reportId,
              title: w.title ?? report.name,
              position: w.position,
              data: result.data,
              meta: result.meta,
              error: null,
            };
          } catch (err: any) {
            return {
              id: w.id,
              reportId: w.reportId,
              title: w.title ?? report.name,
              position: w.position,
              data: null,
              meta: null,
              error: err?.message ?? 'Failed to run report',
            };
          }
        }),
      );

      return {
        dashboard: {
          id: dashboard.id,
          name: dashboard.name,
          description: dashboard.description,
          layout: dashboard.layout,
          createdAt: dashboard.createdAt,
          updatedAt: dashboard.updatedAt,
        },
        widgets: widgetsWithData,
      };
    });
  }

  async create(orgId: string, userId: string | null, dto: CreateDashboardDto) {
    if (!dto.name || typeof dto.name !== 'string') {
      throw new BadRequestException('"name" is required');
    }
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      return tx.dashboard.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description ?? null,
          layout: (dto.layout ?? []) as unknown as object,
          createdById: userId ?? null,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateDashboardDto) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.dashboard.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Dashboard not found');

      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.layout !== undefined) data.layout = dto.layout as unknown as object;

      return tx.dashboard.update({ where: { id }, data });
    });
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.dashboard.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Dashboard not found');
      await tx.dashboard.delete({ where: { id } });
    });
  }

  // ─── Widget CRUD ──────────────────────────────────────────────────

  async addWidget(orgId: string, dashboardId: string, dto: CreateWidgetDto) {
    if (!dto.reportId || typeof dto.reportId !== 'string') {
      throw new BadRequestException('"reportId" is required');
    }
    const position = this.normalizePosition(dto.position);

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const dashboard = await tx.dashboard.findFirst({
        where: { id: dashboardId, organizationId: orgId },
      });
      if (!dashboard) throw new NotFoundException('Dashboard not found');
      // CRITICAL: confirm the report belongs to the SAME org. Without
      // this check, a malicious caller could attach a foreign org's
      // report as a widget on their own dashboard.
      const report = await tx.report.findFirst({
        where: { id: dto.reportId, organizationId: orgId },
      });
      if (!report) {
        throw new NotFoundException('Report not found in this organization');
      }
      return tx.dashboardWidget.create({
        data: {
          organizationId: orgId,
          dashboardId,
          reportId: dto.reportId,
          title: dto.title ?? null,
          position: position as unknown as object,
        },
      });
    });
  }

  async updateWidget(
    orgId: string,
    dashboardId: string,
    widgetId: string,
    dto: UpdateWidgetDto,
  ) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const widget = await tx.dashboardWidget.findFirst({
        where: {
          id: widgetId,
          dashboardId,
          organizationId: orgId,
        },
      });
      if (!widget) throw new NotFoundException('Widget not found');

      const data: Record<string, unknown> = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.position !== undefined) {
        data.position = this.normalizePosition(dto.position) as unknown as object;
      }
      return tx.dashboardWidget.update({ where: { id: widgetId }, data });
    });
  }

  async removeWidget(
    orgId: string,
    dashboardId: string,
    widgetId: string,
  ): Promise<void> {
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      const widget = await tx.dashboardWidget.findFirst({
        where: {
          id: widgetId,
          dashboardId,
          organizationId: orgId,
        },
      });
      if (!widget) throw new NotFoundException('Widget not found');
      await tx.dashboardWidget.delete({ where: { id: widgetId } });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Validate + clamp a widget grid position. We reject anything that
   * doesn't look like {x:number, y:number, w:number, h:number} with
   * non-negative integers in a reasonable range.
   */
  private normalizePosition(p?: WidgetPosition): WidgetPosition {
    if (!p) return { x: 0, y: 0, w: 6, h: 4 };
    if (typeof p !== 'object') {
      throw new BadRequestException(
        'position must be an object {x,y,w,h} of numbers',
      );
    }
    const { x, y, w, h } = p as any;
    for (const [name, v] of [
      ['x', x],
      ['y', y],
      ['w', w],
      ['h', h],
    ] as const) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) {
        throw new BadRequestException(
          `position.${name} must be a finite non-negative number ≤ 1000`,
        );
      }
    }
    // Width/height of 0 is degenerate — clamp to at least 1.
    return {
      x: Math.floor(x),
      y: Math.floor(y),
      w: Math.max(1, Math.floor(w)),
      h: Math.max(1, Math.floor(h)),
    };
  }
}
