import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ClientsService } from '../clients/clients.service';
import { LeadsService } from '../leads/leads.service';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { TasksService } from '../tasks/tasks.service';
import {
  BULK_ERRORS_SAMPLE_SIZE,
  BULK_ROW_CAP,
  BulkEntityType,
  BulkResult,
  BulkResultFailure,
  BulkResultSuccess,
} from './bulk-api.dto';

/**
 * Wave H3 — Bulk API service.
 *
 * Per-row error isolation is the load-bearing invariant: a single bad
 * row in a 1000-row batch must not roll back the others. We deliberately
 * DO NOT wrap the loop in a single `$transaction` / `withOrganization`
 * — each row goes through the per-entity service's own `create` /
 * `update` / `delete`, which open their own short transactions. That
 * way:
 *
 *   - tenant invariants stay intact (the per-entity service always
 *     filters by `organizationId`),
 *   - per-row failures surface as catchable rejects,
 *   - successful rows commit immediately and stay committed.
 *
 * The `BulkOperation` audit row is written at request start
 * ('processing') and rewritten on completion with counts + first 50
 * row errors. If the whole batch crashes before per-row processing
 * begins (e.g. unknown `entityType`) the row is moved to 'failed'.
 *
 * Row cap is double-checked here even though the DTO layer enforces
 * the same limit — defense in depth in case a caller bypasses the DTO
 * (e.g. csv-import passing pre-built rows).
 */
@Injectable()
export class BulkService {
  private readonly logger = new Logger(BulkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly leads: LeadsService,
    private readonly opportunities: OpportunitiesService,
    private readonly tasks: TasksService,
  ) {}

  // ─── Public methods ─────────────────────────────────────────

  async bulkCreate(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    rows: Record<string, any>[],
  ): Promise<BulkResult> {
    this.assertRowsWithinCap(rows);
    const op = await this.startOperation(orgId, userId, 'bulk_create', entityType, rows.length);
    const succeeded: BulkResultSuccess[] = [];
    const failed: BulkResultFailure[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const created = await this.createOne(orgId, userId, entityType, rows[i]);
        succeeded.push({ index: i, id: (created as any)?.id ?? '' });
      } catch (err: any) {
        failed.push({ index: i, error: this.errorMessage(err) });
      }
    }

    await this.completeOperation(orgId, op.id, succeeded, failed);
    return { operationId: op.id, total: rows.length, succeeded, failed };
  }

  async bulkUpdate(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    rows: Array<{ id: string } & Record<string, any>>,
  ): Promise<BulkResult> {
    this.assertRowsWithinCap(rows);
    const op = await this.startOperation(orgId, userId, 'bulk_update', entityType, rows.length);
    const succeeded: BulkResultSuccess[] = [];
    const failed: BulkResultFailure[] = [];

    for (let i = 0; i < rows.length; i++) {
      const { id, ...patch } = rows[i] ?? {};
      try {
        if (!id || typeof id !== 'string') {
          throw new BadRequestException('Missing id on update row');
        }
        await this.updateOne(orgId, userId, entityType, id, patch);
        succeeded.push({ index: i, id });
      } catch (err: any) {
        failed.push({ index: i, error: this.errorMessage(err) });
      }
    }

    await this.completeOperation(orgId, op.id, succeeded, failed);
    return { operationId: op.id, total: rows.length, succeeded, failed };
  }

  async bulkDelete(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    ids: string[],
  ): Promise<BulkResult> {
    this.assertRowsWithinCap(ids);
    const op = await this.startOperation(orgId, userId, 'bulk_delete', entityType, ids.length);
    const succeeded: BulkResultSuccess[] = [];
    const failed: BulkResultFailure[] = [];

    for (let i = 0; i < ids.length; i++) {
      try {
        await this.deleteOne(orgId, entityType, ids[i]);
        succeeded.push({ index: i, id: ids[i] });
      } catch (err: any) {
        failed.push({ index: i, error: this.errorMessage(err) });
      }
    }

    await this.completeOperation(orgId, op.id, succeeded, failed);
    return { operationId: op.id, total: ids.length, succeeded, failed };
  }

  // ─── Audit-row lifecycle ────────────────────────────────────

  /**
   * Open a 'processing' audit row at the start of every bulk request.
   * The CSV importer calls this with type='csv_import' instead.
   */
  async startOperation(
    orgId: string,
    userId: string | null,
    type: 'bulk_create' | 'bulk_update' | 'bulk_delete' | 'csv_import',
    entityType: BulkEntityType,
    totalRows: number,
  ) {
    return this.prisma.bulkOperation.create({
      data: {
        organizationId: orgId,
        type,
        entityType,
        totalRows,
        succeededRows: 0,
        failedRows: 0,
        errorsJson: [],
        status: 'processing',
        createdById: userId,
      },
    });
  }

  /**
   * Flush counts + a capped error sample to the audit row. Moves
   * status to 'completed' (even if every single row failed — the
   * batch *ran*; per-row failures are not a batch-level failure).
   *
   * `totalRows` is optional — when supplied (e.g. by csv-import after
   * the CSV is parsed and the actual row count is known) it overwrites
   * the placeholder zero written at startOperation time.
   */
  async completeOperation(
    orgId: string,
    operationId: string,
    succeeded: BulkResultSuccess[],
    failed: BulkResultFailure[],
    totalRows?: number,
  ) {
    const sample = failed.slice(0, BULK_ERRORS_SAMPLE_SIZE);
    await this.prisma.bulkOperation.update({
      where: { id: operationId, organizationId: orgId },
      data: {
        succeededRows: succeeded.length,
        failedRows: failed.length,
        errorsJson: sample as any,
        status: 'completed',
        completedAt: new Date(),
        ...(totalRows !== undefined ? { totalRows } : {}),
      },
    });
  }

  /**
   * Mark a batch as 'failed' — used when a pre-flight error stops
   * us before per-row processing begins (e.g. CSV parse error,
   * unknown entity type).
   */
  async failOperation(orgId: string, operationId: string, error: string) {
    await this.prisma.bulkOperation.update({
      where: { id: operationId, organizationId: orgId },
      data: {
        status: 'failed',
        errorsJson: [{ index: -1, error: error.slice(0, 2000) }] as any,
        completedAt: new Date(),
      },
    });
  }

  // ─── Past-runs read endpoints ───────────────────────────────

  async listOperations(
    orgId: string,
    query: { entity_type?: BulkEntityType; page?: number; limit?: number } = {},
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId };
    if (query.entity_type) where.entityType = query.entity_type;

    const [data, total] = await Promise.all([
      this.prisma.bulkOperation.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.bulkOperation.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOperation(orgId: string, id: string) {
    const op = await this.prisma.bulkOperation.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!op) throw new NotFoundException('Bulk operation not found');
    return op;
  }

  // ─── Per-entity dispatch ────────────────────────────────────
  //
  // Each entity service has its own signature quirks (some require a
  // createdBy arg, some don't; opportunities calls the method
  // `remove` instead of `delete`). The wrappers below normalise the
  // contract so the bulk loop can stay simple.

  private async createOne(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    row: any,
  ): Promise<{ id: string }> {
    switch (entityType) {
      case 'client':
        return this.clients.create(orgId, row, userId ?? '');
      case 'lead':
        return this.leads.create(orgId, row, userId ?? '');
      case 'opportunity':
        if (!userId) {
          throw new BadRequestException(
            'opportunity create requires an authenticated user',
          );
        }
        return this.opportunities.create(orgId, userId, row);
      case 'task':
        return this.tasks.create(orgId, row, userId ?? '');
      default:
        throw new BadRequestException(`Unknown entityType: ${entityType}`);
    }
  }

  private async updateOne(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    id: string,
    patch: any,
  ): Promise<any> {
    switch (entityType) {
      case 'client':
        return this.clients.update(orgId, id, patch, userId ?? undefined);
      case 'lead':
        return this.leads.update(orgId, id, patch, userId ?? undefined);
      case 'opportunity':
        return this.opportunities.update(orgId, id, patch);
      case 'task':
        return this.tasks.update(orgId, id, patch);
      default:
        throw new BadRequestException(`Unknown entityType: ${entityType}`);
    }
  }

  private async deleteOne(
    orgId: string,
    entityType: BulkEntityType,
    id: string,
  ): Promise<any> {
    switch (entityType) {
      case 'client':
        return this.clients.delete(orgId, id);
      case 'lead':
        return this.leads.delete(orgId, id);
      case 'opportunity':
        return this.opportunities.remove(orgId, id);
      case 'task':
        return this.tasks.delete(orgId, id);
      default:
        throw new BadRequestException(`Unknown entityType: ${entityType}`);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private assertRowsWithinCap(rows: unknown[]): void {
    if (!Array.isArray(rows)) {
      throw new BadRequestException('rows must be an array');
    }
    if (rows.length === 0) {
      throw new BadRequestException('rows must not be empty');
    }
    if (rows.length > BULK_ROW_CAP) {
      throw new BadRequestException(
        `Row cap exceeded: max ${BULK_ROW_CAP} per request, got ${rows.length}`,
      );
    }
  }

  /**
   * Compact stringifier for per-row errors so we don't persist 50 kB
   * stack traces in `errors_json`. Caps at 500 chars.
   */
  private errorMessage(err: any): string {
    const msg =
      typeof err === 'string'
        ? err
        : err?.response?.message
        ? Array.isArray(err.response.message)
          ? err.response.message.join('; ')
          : String(err.response.message)
        : err?.message ?? 'Unknown error';
    return String(msg).slice(0, 500);
  }
}
