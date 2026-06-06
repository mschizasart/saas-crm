import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

type Period = 'month' | 'quarter';

interface ForecastBucket {
  period: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
  wonAmount: number;
  openAmount: number;
}

interface OwnerForecast {
  ownerId: string;
  ownerName: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
  wonAmount: number;
  openAmount: number;
}

/**
 * Weighted forecast computations.
 *
 * For each opportunity in the window:
 *   - totalAmount    += amount
 *   - weightedAmount += amount * stage.probability / 100
 *   - wonAmount      += amount   (only when stage.isWon)
 *   - openAmount     += amount   (only when !stage.isWon && !stage.isLost)
 *
 * Aggregation is in JS rather than SQL so we can reuse the same loop
 * for both groupings (by period / by owner) and so Prisma's `Decimal`
 * type round-trip is explicit.
 */
@Injectable()
export class ForecastsService {
  constructor(private prisma: PrismaService) {}

  /** Sum the per-bucket numbers and round to 2dp. */
  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** Convert a Prisma Decimal (Decimal.js-like) to a JS number. */
  private toNum(v: unknown): number {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    // Prisma Decimal has .toNumber() and .toString()
    const asObj = v as { toNumber?: () => number };
    if (typeof asObj.toNumber === 'function') return asObj.toNumber();
    const n = Number(String(v));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Inclusive start-of-window: midnight on the 1st of this month.
   * Exclusive end-of-window: midnight on the 1st of `start + months`.
   */
  private windowBounds(months: number): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1),
    );
    return { start, end };
  }

  private bucketKey(date: Date, period: Period): string {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth(); // 0-11
    if (period === 'month') {
      return `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    const q = Math.floor(m / 3) + 1;
    return `${y}-Q${q}`;
  }

  // ─── Weighted forecast grouped by period ────────────────────

  async weighted(orgId: string, period: Period, months: number) {
    if (period !== 'month' && period !== 'quarter') {
      throw new BadRequestException("period must be 'month' or 'quarter'");
    }
    if (!Number.isFinite(months) || months < 1 || months > 36) {
      throw new BadRequestException('months must be between 1 and 36');
    }

    const { start, end } = this.windowBounds(months);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const opps = await tx.opportunity.findMany({
        where: {
          organizationId: orgId,
          closeDate: { gte: start, lt: end },
        },
        select: {
          amount: true,
          closeDate: true,
          stage: { select: { probability: true, isWon: true, isLost: true } },
        },
      });

      // Accumulate in integer cents to avoid float drift on large sums.
      // Convert back to dollars on the way out.
      const buckets = new Map<string, ForecastBucket>();
      for (const opp of opps) {
        const key = this.bucketKey(opp.closeDate, period);
        const amount = this.toNum(opp.amount);
        const probability = this.toNum(opp.stage.probability);
        const amountCents = Math.round(amount * 100);
        const weightedCents = Math.round((amount * probability) / 100 * 100);
        const isWon = !!opp.stage.isWon;
        const isLost = !!opp.stage.isLost;

        let b = buckets.get(key);
        if (!b) {
          b = {
            period: key,
            count: 0,
            totalAmount: 0,
            weightedAmount: 0,
            wonAmount: 0,
            openAmount: 0,
          };
          buckets.set(key, b);
        }
        b.count += 1;
        b.totalAmount += amountCents;
        b.weightedAmount += weightedCents;
        if (isWon) b.wonAmount += amountCents;
        if (!isWon && !isLost) b.openAmount += amountCents;
      }

      // Pre-populate empty buckets so the chart has the full window.
      const result: ForecastBucket[] = [];
      const cursor = new Date(start);
      while (cursor < end) {
        const key = this.bucketKey(cursor, period);
        const existing = buckets.get(key);
        if (existing) {
          if (!result.find((r) => r.period === key)) result.push(existing);
        } else if (!result.find((r) => r.period === key)) {
          result.push({
            period: key,
            count: 0,
            totalAmount: 0,
            weightedAmount: 0,
            wonAmount: 0,
            openAmount: 0,
          });
        }
        // step forward by 1 month always — the bucketKey collapses to
        // the same quarter key for the next 2 months so dedup above
        // takes care of it.
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }

      return result.map((b) => ({
        period: b.period,
        count: b.count,
        totalAmount: b.totalAmount / 100,
        weightedAmount: b.weightedAmount / 100,
        wonAmount: b.wonAmount / 100,
        openAmount: b.openAmount / 100,
      }));
    });
  }

  // ─── Weighted forecast grouped by owner ──────────────────────

  async byOwner(orgId: string, months: number) {
    if (!Number.isFinite(months) || months < 1 || months > 36) {
      throw new BadRequestException('months must be between 1 and 36');
    }

    const { start, end } = this.windowBounds(months);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const opps = await tx.opportunity.findMany({
        where: {
          organizationId: orgId,
          closeDate: { gte: start, lt: end },
        },
        select: {
          amount: true,
          ownerId: true,
          owner: { select: { firstName: true, lastName: true, email: true } },
          stage: { select: { probability: true, isWon: true, isLost: true } },
        },
      });

      // Accumulate in integer cents to avoid float drift on large sums.
      const buckets = new Map<string, OwnerForecast>();
      for (const opp of opps) {
        const amount = this.toNum(opp.amount);
        const probability = this.toNum(opp.stage.probability);
        const amountCents = Math.round(amount * 100);
        const weightedCents = Math.round((amount * probability) / 100 * 100);
        const isWon = !!opp.stage.isWon;
        const isLost = !!opp.stage.isLost;
        const ownerName =
          opp.owner
            ? `${opp.owner.firstName ?? ''} ${opp.owner.lastName ?? ''}`.trim() ||
              opp.owner.email
            : 'Unassigned';

        let b = buckets.get(opp.ownerId);
        if (!b) {
          b = {
            ownerId: opp.ownerId,
            ownerName,
            count: 0,
            totalAmount: 0,
            weightedAmount: 0,
            wonAmount: 0,
            openAmount: 0,
          };
          buckets.set(opp.ownerId, b);
        }
        b.count += 1;
        b.totalAmount += amountCents;
        b.weightedAmount += weightedCents;
        if (isWon) b.wonAmount += amountCents;
        if (!isWon && !isLost) b.openAmount += amountCents;
      }

      return Array.from(buckets.values())
        .map((b) => ({
          ...b,
          totalAmount: b.totalAmount / 100,
          weightedAmount: b.weightedAmount / 100,
          wonAmount: b.wonAmount / 100,
          openAmount: b.openAmount / 100,
        }))
        .sort((a, b) => b.weightedAmount - a.weightedAmount);
    });
  }
}
