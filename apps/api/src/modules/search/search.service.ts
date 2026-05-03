import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Public response shape — UNCHANGED from the original per-table OR-search.
 *
 * The Cmd-K palette (apps/web/components/ui/command-palette.tsx) calls
 * `normalizeSearchResponse()` which already handles both:
 *   A. { results: [{ type, id, title, subtitle?, url }] }   ← preferred
 *   B. { leads: [...], clients: [...], invoices: [...], ...} ← legacy fallback
 *
 * We return BOTH shapes so any other consumer (mobile app, future widgets)
 * keeps working. `results` is the canonical shape; the per-type arrays
 * mirror the same rows for backwards compatibility.
 */
export interface SearchResultRow {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

interface FtsRow {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  url: string;
  rank: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Cross-record full-text search backed by `search_index` (migration 012).
   *
   * Strategy:
   *   - Combines two ranks:
   *       ts_rank(tsv, plainto_tsquery('simple', $q))  → relevance
   *       similarity(title, $q)                        → fuzzy / typo tolerance
   *     Final order is `ts_rank * 2 + similarity DESC`.
   *   - Pre-filters with the OR predicate
   *       (tsv @@ plainto_tsquery(...) OR title % $q)
   *     so the GIN indexes (tsv and title trigram) handle the heavy lifting
   *     and the rank arithmetic only runs over candidate rows.
   *   - Per-type cap is enforced in the service (not SQL) — keeps the SQL
   *     simple and the global LIMIT controls worst-case latency.
   *
   * @param orgId  current tenant
   * @param query  user input (≥ 2 chars, otherwise empty result)
   * @param limit  *per-type* cap returned to the client. Defaults to 10
   *               to match the legacy controller contract.
   */
  async search(orgId: string, query: string, limit = 10) {
    const q = (query ?? '').trim();
    if (q.length < 2) return this.emptyResponse();

    const GLOBAL_LIMIT = 30;
    let rows: FtsRow[] = [];
    try {
      // Run inside withOrganization so the `tenant_isolation` RLS policy
      // (migration 012) authorises the SELECT. The explicit
      // `organizationId = ${orgId}` is defence in depth — RLS already
      // restricts visible rows.
      rows = await this.prisma.withOrganization(orgId, (tx) =>
        tx.$queryRaw<FtsRow[]>`
          SELECT
            "entityType",
            "entityId",
            "title",
            "subtitle",
            "url",
            (
              ts_rank("tsv", plainto_tsquery('simple', ${q})) * 2
              + similarity("title", ${q})
            ) AS rank
          FROM "search_index"
          WHERE "organizationId" = ${orgId}
            AND (
              "tsv" @@ plainto_tsquery('simple', ${q})
              OR "title" % ${q}
            )
          ORDER BY rank DESC
          LIMIT ${GLOBAL_LIMIT}
        `,
      );
    } catch (err) {
      // Table missing (migration 012 not applied) or pg_trgm not installed —
      // log once and degrade to an empty response. The Cmd-K palette will
      // simply show "No matches"; the deploy checklist should run the
      // migration before flipping traffic.
      this.logger.warn(
        `FTS query failed, returning empty results: ${(err as Error).message}`,
      );
      return this.emptyResponse();
    }

    // Build canonical rows + per-type buckets in one pass.
    const buckets: Record<string, SearchResultRow[]> = {
      leads: [],
      clients: [],
      invoices: [],
      estimates: [],
      proposals: [],
      contracts: [],
      tickets: [],
      products: [],
    };
    const flat: SearchResultRow[] = [];

    for (const r of rows) {
      const out: SearchResultRow = {
        type: r.entityType,
        id: r.entityId,
        title: r.title,
        subtitle: r.subtitle ?? undefined,
        url: r.url,
      };
      const key = this.bucketKey(r.entityType);
      if (key && (buckets[key]?.length ?? 0) < limit) {
        buckets[key].push(out);
      }
      flat.push(out);
    }

    return {
      results: flat,
      ...buckets,
    };
  }

  private bucketKey(entityType: string): string | null {
    switch (entityType) {
      case 'lead':
        return 'leads';
      case 'client':
        return 'clients';
      case 'invoice':
        return 'invoices';
      case 'estimate':
        return 'estimates';
      case 'proposal':
        return 'proposals';
      case 'contract':
        return 'contracts';
      case 'ticket':
        return 'tickets';
      case 'product':
        return 'products';
      default:
        return null;
    }
  }

  private emptyResponse() {
    return {
      results: [] as SearchResultRow[],
      leads: [] as SearchResultRow[],
      clients: [] as SearchResultRow[],
      invoices: [] as SearchResultRow[],
      estimates: [] as SearchResultRow[],
      proposals: [] as SearchResultRow[],
      contracts: [] as SearchResultRow[],
      tickets: [] as SearchResultRow[],
      products: [] as SearchResultRow[],
    };
  }
}
