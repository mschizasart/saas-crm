import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateRateDto, ListRatesQueryDto } from './fx.dto';

/**
 * Multi-currency core (Wave F3).
 *
 * Lookup ordering inside `getRate()`:
 *   1. Direct `from→to` rate for this org, most recent ≤ asOfDate.
 *      Inside the same date, `manual` source wins over `ecb` (admin
 *      override takes precedence).
 *   2. Inverse `to→from` rate → return `1 / rate`.
 *   3. Triangulate via EUR (the ECB pivot): `from→EUR` × `EUR→to`.
 *   4. Otherwise NotFoundException.
 *
 * `convert()` returns a Prisma.Decimal — callers chain `.toNumber()`
 * or `.toFixed(decimalPlaces)` themselves. Decimal is safer than
 * float for money maths, especially after the EUR triangulation
 * multiplies two ratios.
 *
 * `refreshFromEcb()` parses the ECB daily XML feed
 * (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)
 * with a regex — `fast-xml-parser` is not a project dependency and
 * the feed is tiny (~3 KB) so a regex is fine. ECB publishes the
 * file once per business day around 16:00 CET; a 15-second HTTP
 * timeout keeps a stalled feed from blocking the daily cron.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  // ECB daily reference rates — EUR-based, no API key, free.
  private readonly ECB_URL =
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

  // 15s ceiling — matches the comment in F3 spec.
  private readonly ECB_TIMEOUT_MS = 15_000;

  constructor(private prisma: PrismaService) {}

  // ─── Global currency reference ───────────────────────────────

  /** GLOBAL table — no org filter. Used by the FX settings page. */
  async listCurrencies() {
    return this.prisma.fxCurrency.findMany({
      orderBy: { code: 'asc' },
    });
  }

  // ─── Rate lookup ─────────────────────────────────────────────

  /**
   * Returns the multiplier you would apply to `from` to get `to`,
   * as a Prisma.Decimal for precision.
   *
   * Same-currency short-circuits to 1 without hitting the DB.
   */
  async getRate(
    orgId: string,
    from: string,
    to: string,
    asOfDate?: Date,
  ): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);

    const cutoff = asOfDate ?? new Date();

    // 1. Direct from→to rate. Manual overrides outrank ECB pulls
    //    within the same date (the ORDER BY puts manual first).
    const direct = await this.findLatestRate(orgId, from, to, cutoff);
    if (direct) return new Prisma.Decimal(direct.rate.toString());

    // 2. Inverse to→from rate → 1 / rate.
    const inverse = await this.findLatestRate(orgId, to, from, cutoff);
    if (inverse) {
      return new Prisma.Decimal(1).dividedBy(
        new Prisma.Decimal(inverse.rate.toString()),
      );
    }

    // 3. Triangulate via EUR (ECB's pivot currency). We need a
    //    from→EUR rate and a EUR→to rate. Each can come either as a
    //    direct row or as the inverse of an EUR→from / to→EUR row.
    //    Covering all four combinations means an ECB feed (which only
    //    stores EUR→XXX) still triangulates non-EUR pairs correctly.
    if (from !== 'EUR' && to !== 'EUR') {
      const [toEur, fromEur, eurFromInv, eurToInv] = await Promise.all([
        this.findLatestRate(orgId, from, 'EUR', cutoff),
        this.findLatestRate(orgId, 'EUR', to, cutoff),
        this.findLatestRate(orgId, 'EUR', from, cutoff),
        this.findLatestRate(orgId, to, 'EUR', cutoff),
      ]);

      const toEurRate = toEur
        ? new Prisma.Decimal(toEur.rate.toString())
        : eurFromInv
          ? new Prisma.Decimal(1).dividedBy(
              new Prisma.Decimal(eurFromInv.rate.toString()),
            )
          : null;

      const eurToTargetRate = fromEur
        ? new Prisma.Decimal(fromEur.rate.toString())
        : eurToInv
          ? new Prisma.Decimal(1).dividedBy(
              new Prisma.Decimal(eurToInv.rate.toString()),
            )
          : null;

      if (toEurRate && eurToTargetRate) {
        return toEurRate.times(eurToTargetRate);
      }
    }

    throw new NotFoundException(
      `No exchange rate available for ${from}→${to} on or before ${cutoff
        .toISOString()
        .slice(0, 10)}`,
    );
  }

  /**
   * Latest stored rate for (org, from, to) on or before `cutoff`.
   * Ordered by date DESC, then `source` so 'manual' > 'ecb' >
   * 'openexchange' within the same day (alphabetical ASC: manual
   * actually sorts AFTER ecb — see custom ORDER BY).
   */
  private async findLatestRate(
    orgId: string,
    from: string,
    to: string,
    cutoff: Date,
  ) {
    // Strip the time portion so a request at 09:00 UTC still picks
    // up a rate dated today (DATE column has no time component).
    const cutoffDate = new Date(
      Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()),
    );

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Use raw to express "manual wins on same date" — Prisma can't
      // express CASE-based ORDER BY without raw SQL.
      const rows = await tx.$queryRaw<
        Array<{ id: string; rate: string; date: Date; source: string }>
      >(Prisma.sql`
        SELECT "id", "rate"::text AS "rate", "date", "source"
        FROM "exchange_rates"
        WHERE "organizationId" = ${orgId}
          AND "fromCurrency" = ${from}
          AND "toCurrency" = ${to}
          AND "date" <= ${cutoffDate}::date
        ORDER BY "date" DESC,
                 CASE "source"
                   WHEN 'manual' THEN 0
                   WHEN 'ecb' THEN 1
                   WHEN 'openexchange' THEN 2
                   ELSE 3
                 END ASC
        LIMIT 1
      `);
      return rows[0] ?? null;
    });
  }

  // ─── Conversion ──────────────────────────────────────────────

  /**
   * Multiply `amount` by the from→to rate at `asOfDate` and round
   * to the `to` currency's decimal places. Returns a Prisma.Decimal.
   */
  async convert(
    orgId: string,
    amount: Prisma.Decimal | number | string,
    from: string,
    to: string,
    asOfDate?: Date,
  ): Promise<{
    from: string;
    to: string;
    amount: string;
    rate: string;
    converted: string;
    asOfDate: string;
  }> {
    const rate = await this.getRate(orgId, from, to, asOfDate);
    const amt = new Prisma.Decimal(amount.toString());
    const raw = amt.times(rate);

    // Look up the target currency's decimalPlaces for display rounding.
    // Falls back to 2 if the target isn't in the global table.
    const target = await this.prisma.fxCurrency.findUnique({
      where: { code: to },
      select: { decimalPlaces: true },
    });
    const dp = target?.decimalPlaces ?? 2;

    return {
      from,
      to,
      amount: amt.toString(),
      rate: rate.toString(),
      converted: raw.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP).toString(),
      asOfDate: (asOfDate ?? new Date()).toISOString().slice(0, 10),
    };
  }

  // ─── Manual override ─────────────────────────────────────────

  /**
   * Admin manual rate override. Validates both codes exist in the
   * global currency table and rate > 0 before insert. UNIQUE
   * constraint catches duplicate (org, from, to, date, source).
   */
  async createManualRate(orgId: string, _userId: string, dto: CreateRateDto) {
    if (dto.from === dto.to) {
      throw new BadRequestException(
        'from and to currencies must differ — same-currency rate is always 1',
      );
    }
    if (dto.rate <= 0) {
      throw new BadRequestException('rate must be > 0');
    }

    // Both currencies must be known. ECB feeds can introduce new
    // ones over time but a manual override should reference a code
    // we display.
    const [from, to] = await Promise.all([
      this.prisma.fxCurrency.findUnique({ where: { code: dto.from } }),
      this.prisma.fxCurrency.findUnique({ where: { code: dto.to } }),
    ]);
    if (!from) {
      throw new BadRequestException(`Unknown currency code: ${dto.from}`);
    }
    if (!to) {
      throw new BadRequestException(`Unknown currency code: ${dto.to}`);
    }

    // Manual rates are ALWAYS stored as source='manual'. Clients
    // cannot occupy the 'ecb' UNIQUE slot via this endpoint — only
    // refreshFromEcb writes ecb-source rows.
    const source = 'manual';
    const date = new Date(dto.date);

    return this.prisma.withOrganization(orgId, async (tx) => {
      try {
        return await tx.exchangeRate.create({
          data: {
            organizationId: orgId,
            fromCurrency: dto.from,
            toCurrency: dto.to,
            rate: new Prisma.Decimal(dto.rate),
            date,
            source,
          },
        });
      } catch (err: any) {
        // P2002 = unique constraint violation.
        if (err?.code === 'P2002') {
          throw new BadRequestException(
            `A ${source} rate for ${dto.from}→${dto.to} on ${dto.date} already exists`,
          );
        }
        throw err;
      }
    });
  }

  // ─── List rates (paged) ──────────────────────────────────────

  async listRates(orgId: string, query: ListRatesQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: Prisma.ExchangeRateWhereInput = { organizationId: orgId };
      if (query.from) where.fromCurrency = query.from;
      if (query.to) where.toCurrency = query.to;

      const [data, total] = await Promise.all([
        tx.exchangeRate.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        }),
        tx.exchangeRate.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  // ─── Manual rate delete (defense in depth) ───────────────────

  async deleteRate(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.exchangeRate.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Exchange rate not found');
      }
      // Defense-in-depth: organizationId in the where clause stops a
      // cross-tenant id from succeeding even if findFirst missed.
      // deleteMany lets us include non-unique fields in the where; we
      // assert count===1 and 404 otherwise.
      const result = await tx.exchangeRate.deleteMany({
        where: { id, organizationId: orgId },
      });
      if (result.count === 0) {
        throw new NotFoundException('Exchange rate not found');
      }
      return { deleted: true };
    });
  }

  // ─── ECB feed refresh ────────────────────────────────────────

  /**
   * Fetch the ECB daily XML feed once and return parsed (currency,
   * rate) pairs. Used by both the cron sweep (one fetch, many inserts)
   * and the manual `POST /fx/refresh-now` endpoint via refreshFromEcb.
   */
  async fetchEcbPairs(): Promise<Array<{ currency: string; rate: string }>> {
    const xml = await this.fetchEcbXml();
    return this.parseEcbXml(xml);
  }

  /**
   * Insert pre-parsed ECB pairs for a single org. Existing rows for
   * the same (org, from, to, date, source) are skipped via the UNIQUE
   * constraint catch — re-running mid-day is a no-op.
   */
  async insertPairsForOrg(
    orgId: string,
    pairs: Array<{ currency: string; rate: string }>,
  ): Promise<{ inserted: number }> {
    if (pairs.length === 0) {
      this.logger.warn(`ECB pairs for org ${orgId} are empty — nothing to insert`);
      return { inserted: 0 };
    }

    const today = new Date();
    const todayDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );

    let inserted = 0;
    await this.prisma.withOrganization(orgId, async (tx) => {
      for (const { currency, rate } of pairs) {
        try {
          await tx.exchangeRate.create({
            data: {
              organizationId: orgId,
              fromCurrency: 'EUR',
              toCurrency: currency,
              rate: new Prisma.Decimal(rate),
              date: todayDate,
              source: 'ecb',
            },
          });
          inserted++;
        } catch (err: any) {
          // P2002 = already inserted today — ignore.
          if (err?.code !== 'P2002') throw err;
        }
      }
    });

    return { inserted };
  }

  /**
   * Convenience wrapper used by the manual `POST /fx/refresh-now`
   * endpoint: fetch the feed and insert for one org in a single call.
   * The cron sweep calls `fetchEcbPairs` + `insertPairsForOrg` directly
   * so it doesn't refetch the feed per org.
   */
  async refreshFromEcb(orgId: string): Promise<{ inserted: number }> {
    const pairs = await this.fetchEcbPairs();
    return this.insertPairsForOrg(orgId, pairs);
  }

  // ─── ECB helpers ─────────────────────────────────────────────

  /**
   * Fetch the ECB XML with a 15s timeout. Uses the global `fetch`
   * (Node 18+, Fastify runtime). AbortController fires the timeout.
   */
  private async fetchEcbXml(): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.ECB_TIMEOUT_MS);
    try {
      const res = await fetch(this.ECB_URL, { signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`ECB fetch failed: HTTP ${res.status}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extract `(currency, rate)` pairs from the ECB daily XML.
   *
   * Sample:
   *   <Cube currency='USD' rate='1.0852'/>
   *   <Cube currency='JPY' rate='160.41'/>
   *
   * Regex is fine here — the feed is ~3 KB of well-formed XML
   * controlled by ECB. If they ever change the schema we'll notice
   * via the daily cron log showing `inserted: 0`.
   */
  private parseEcbXml(
    xml: string,
  ): Array<{ currency: string; rate: string }> {
    const out: Array<{ currency: string; rate: string }> = [];
    // Match `<Cube currency="USD" rate="1.0852"/>` with either quote style
    // and either attribute order.
    const re =
      /<Cube\b[^>]*\bcurrency=["']([A-Z]{3})["'][^>]*\brate=["']([0-9.]+)["'][^>]*\/?>/g;
    const reReverse =
      /<Cube\b[^>]*\brate=["']([0-9.]+)["'][^>]*\bcurrency=["']([A-Z]{3})["'][^>]*\/?>/g;

    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      out.push({ currency: m[1], rate: m[2] });
    }
    if (out.length === 0) {
      while ((m = reReverse.exec(xml)) !== null) {
        out.push({ currency: m[2], rate: m[1] });
      }
    }
    return out;
  }
}
