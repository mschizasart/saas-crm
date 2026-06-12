import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parse as parseCsvSync } from 'csv-parse/sync';
import {
  BULK_ROW_CAP,
  BulkEntityType,
  BulkResult,
} from './bulk-api.dto';
import { BulkService } from './bulk.service';

/**
 * Wave H3 — CSV → bulk-create bridge.
 *
 * The flow:
 *   1. Parse CSV with `csv-parse/sync` (already a project dep — see
 *      clients.service.ts which uses it the same way). Handles BOM,
 *      quoted commas, CRLF.
 *   2. If `hasHeader` (default true) the first row is treated as
 *      column headers; subsequent rows are mapped header→value.
 *      Header names must be in the per-entity allow-list — anything
 *      else makes the whole request 400 BEFORE we touch the DB.
 *   3. Build the create payload, pass the whole list to
 *      `BulkService.bulkCreate(...)`, return its result.
 *
 * The CSV parser path is `csv-parse/sync` (declared in
 * `apps/api/package.json` and already used by `clients.service` and
 * `leads.service`'s `importFromCsv`). NO regex-based fallback —
 * the dependency is always present in this monorepo.
 *
 * Unknown column rejection:
 *   We accept the union of declared columns per entity (lower-cased,
 *   trimmed). The `id` column is allowed for forwards-compat with
 *   bulk-update CSVs but is dropped from create payloads.
 *   Any column outside the allow-list trips a 400 with the list of
 *   bad columns — same contract as the existing CSV importers.
 */
@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);

  constructor(private readonly bulk: BulkService) {}

  /**
   * Per-entity create-DTO field allow-list. These are the columns
   * the CSV header is checked against. Pulled from the live
   * `CreateXxxDto` interfaces in each entity service.
   *
   * NOTE: kept in sync manually with the per-entity DTOs. If you
   * add a field to `CreateClientDto` and want it CSV-importable,
   * add it here too.
   */
  private static readonly ALLOWED_COLUMNS: Record<BulkEntityType, readonly string[]> = {
    client: [
      'id', // tolerated, dropped from payload (see note above)
      'company',
      'groupId',
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'website',
      'phone',
      'vat',
      'currencyId',
      'defaultLanguage',
      'billingStreet',
      'billingCity',
      'billingState',
      'billingZip',
      'billingCountry',
    ],
    lead: [
      'id',
      'name',
      'email',
      'phone',
      'company',
      'position',
      'website',
      'address',
      'city',
      'state',
      'zipCode',
      'country',
      'description',
      'budget',
      'currency',
      'status',
      'source',
      'assignedToId',
    ],
    opportunity: [
      'id',
      'name',
      'clientId',
      'leadId',
      'ownerId',
      'stageId',
      'amount',
      'currency',
      'closeDate',
      'description',
      'source',
    ],
    task: [
      'id',
      'name',
      'description',
      'status',
      'priority',
      'assignedToId',
      'projectId',
      'dueDate',
      'startDate',
      'estimatedHours',
    ],
  };

  async importCsv(
    orgId: string,
    userId: string | null,
    entityType: BulkEntityType,
    csvBuffer: Buffer,
    hasHeader = true,
  ): Promise<BulkResult> {
    // Pre-flight: open a 'processing' audit row so failed parses
    // still leave a trace. We won't actually use its id for per-row
    // results — those go through `bulkCreate` which opens its own
    // 'bulk_create' row — but we DO close it before delegating so
    // it doesn't sit half-finished if parse blows up.
    const importOp = await this.bulk.startOperation(
      orgId,
      userId,
      'csv_import',
      entityType,
      0,
    );

    let records: Array<Record<string, string>>;
    try {
      records = this.parseCsv(csvBuffer, hasHeader, entityType);
    } catch (err: any) {
      await this.bulk.failOperation(
        orgId,
        importOp.id,
        err?.message ?? 'CSV parse failed',
      );
      throw err;
    }

    if (records.length === 0) {
      await this.bulk.completeOperation(orgId, importOp.id, [], [], 0);
      return {
        operationId: importOp.id,
        total: 0,
        succeeded: [],
        failed: [],
      };
    }

    if (records.length > BULK_ROW_CAP) {
      await this.bulk.failOperation(
        orgId,
        importOp.id,
        `CSV row cap exceeded: max ${BULK_ROW_CAP}, got ${records.length}`,
      );
      throw new BadRequestException(
        `CSV row cap exceeded: max ${BULK_ROW_CAP} per request, got ${records.length}`,
      );
    }

    // Build create payloads — drop the optional `id` column.
    const payloads = records.map((r) => {
      const { id: _drop, ...rest } = r as any;
      void _drop;
      return rest;
    });

    // Delegate to bulkCreate. It opens its own 'bulk_create' audit
    // row — the user therefore sees TWO rows for a CSV import:
    //   1. csv_import (this one) → completed, total=N
    //   2. bulk_create (the inner) → completed, total=N w/ errors
    // That's intentional: the csv_import row captures "user uploaded
    // a file at T" and the bulk_create row captures the per-row
    // execution. Both are scoped by (org, user) on the list endpoint.
    const result = await this.bulk.bulkCreate(orgId, userId, entityType, payloads);

    // Mirror the inner counts onto the csv_import row so the
    // "Bulk Imports" page can show both runs equivalently.
    // Pass `records.length` as totalRows — startOperation was called
    // with 0 before the CSV was parsed, so we need to backfill it now.
    await this.bulk.completeOperation(
      orgId,
      importOp.id,
      result.succeeded,
      result.failed,
      records.length,
    );

    return result;
  }

  // ─── CSV parsing ────────────────────────────────────────────

  private parseCsv(
    csvBuffer: Buffer,
    hasHeader: boolean,
    entityType: BulkEntityType,
  ): Array<Record<string, string>> {
    let raw: any;
    try {
      raw = parseCsvSync(csvBuffer, {
        // Don't auto-map columns when `hasHeader=false` — the parser
        // returns arrays of cells in that mode.
        columns: hasHeader
          ? (header: string[]) => header.map((h) => h.trim())
          : false,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });
    } catch (err: any) {
      throw new BadRequestException(`CSV parse failed: ${err.message}`);
    }

    if (!hasHeader) {
      // Without a header, we can't reliably map columns to DTO
      // fields. Refuse with a hint instead of silently building
      // junk payloads.
      throw new BadRequestException(
        'hasHeader=false is not supported — please include a header row matching the entity DTO field names',
      );
    }

    const records = raw as Array<Record<string, string>>;

    // Validate columns against the allow-list. `csv-parse/sync`
    // returns rows as objects keyed by the header values verbatim,
    // so we can inspect the first row's keys for the column set.
    const allowed = new Set(CsvImportService.ALLOWED_COLUMNS[entityType]);
    const firstKeys = records.length > 0 ? Object.keys(records[0]) : [];
    const unknown = firstKeys.filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown CSV column(s) for entityType="${entityType}": ${unknown.join(', ')}. ` +
          `Allowed: ${Array.from(allowed).join(', ')}`,
      );
    }

    // Strip empty-string cells so the entity service's `??`
    // defaults kick in (otherwise we'd send `phone: ""` and the DB
    // would store an empty string instead of NULL).
    return records.map((r) => {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        if (v != null && String(v).trim() !== '') clean[k] = String(v).trim();
      }
      return clean;
    });
  }
}
